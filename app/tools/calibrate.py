"""M0 calibration: measure real extraction and compression ratios on a ZIM.

Samples HTML entries across the whole archive, runs the real adapter over each,
and measures raw bytes -> extracted text -> zstd-with-trained-dictionary. Reports
throughput so the full-corpus runtime can be extrapolated from measurement rather
than guesswork.

Usage: calibrate.py <archive.zim> [sample_size]
"""
from __future__ import annotations

import json
import random
import statistics
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import zstandard as zstd
from libzim.reader import Archive

from codex.adapters import pick_adapter
from codex.model import KIND_NAMES

SAMPLE = int(sys.argv[2]) if len(sys.argv) > 2 else 3000


def human(n: float) -> str:
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if abs(n) < 1024:
            return f"{n:,.1f}{unit}"
        n /= 1024
    return f"{n:,.1f}PB"


def main(path: str) -> None:
    a = Archive(path)
    meta = {}
    for k in a.metadata_keys:
        if k.startswith("Illustration"):
            continue
        try:
            meta[k] = bytes(a.get_metadata(k)).decode("utf-8", "replace")
        except Exception:
            pass

    adapter = pick_adapter(meta)
    adapter.prepare(a)
    zim_size = Path(path).stat().st_size

    print(f"=== {Path(path).name}")
    print(f"  on-disk           {human(zim_size)}")
    print(f"  entries           {a.all_entry_count:,}  (articles {a.article_count:,}, "
          f"media {a.media_count:,})")
    print(f"  adapter           {adapter.name}")
    print(f"  sampling          {SAMPLE:,} html entries\n")

    rng = random.Random(1234)
    ids = rng.sample(range(a.all_entry_count), min(a.all_entry_count, SAMPLE * 12))

    raw_total = text_total = 0
    n_html = n_docs = n_redirect = n_fail = 0
    n_skip_path = n_stub = 0
    kinds: dict[int, int] = {}
    link_total = 0
    bodies: list[bytes] = []
    ratios: list[float] = []
    word_counts: list[int] = []

    t0 = time.perf_counter()
    parse_time = 0.0

    ids_consumed = 0
    for i in ids:
        if n_docs >= SAMPLE:
            break
        ids_consumed += 1
        try:
            e = a._get_entry_by_id(i)
        except Exception:
            continue
        if e.is_redirect:
            n_redirect += 1
            continue
        if adapter.skip_path(e.path):
            n_skip_path += 1
            continue
        try:
            item = e.get_item()
            if not item.mimetype.startswith("text/html"):
                continue
            n_html += 1
            raw = bytes(item.content).decode("utf-8", "replace")
            # Same indirection the build uses: an archive may keep its prose in
            # a sibling entry. Without this the projection reads routing stubs
            # and cheerfully predicts a corpus of nothing.
            raw = adapter.source_for(a, e, raw)
            if raw is None:
                n_stub += 1
                continue
        except Exception:
            n_fail += 1
            continue

        t1 = time.perf_counter()
        try:
            doc = adapter.parse(raw, e.path, e.title)
        except Exception:
            n_fail += 1
            continue
        parse_time += time.perf_counter() - t1

        if doc is None:
            continue
        if not adapter.should_keep(doc):
            n_stub += 1
            continue

        # What actually gets stored: the lead plain in the doc row, the sections
        # as a compressed JSON blob. Measure both.
        body_json = json.dumps([s.as_json() for s in doc.sections],
                               ensure_ascii=False, separators=(",", ":")).encode()
        lead_bytes = len(doc.lead.encode("utf-8", "replace"))
        raw_total += len(raw.encode("utf-8", "replace"))
        text_total += len(body_json) + lead_bytes
        bodies.append(body_json)
        ratios.append(len(body_json) / max(len(raw), 1))
        word_counts.append(doc.word_count)
        link_total += len(doc.links)
        kinds[doc.kind] = kinds.get(doc.kind, 0) + 1
        n_docs += 1

    wall = time.perf_counter() - t0
    if not bodies:
        print("!! no documents extracted - adapter needs work for this archive")
        return

    print(f"--- extraction ({n_docs:,} kept docs from {n_html:,} html entries)")
    print(f"  rejected          {n_skip_path:,} by path, {n_stub:,} as stubs/dead-ends, "
          f"{n_redirect:,} redirects, {n_fail} failures")
    keep_rate = n_docs / max(n_docs + n_stub + n_skip_path, 1)
    print(f"  keep rate         {keep_rate:.1%} of non-redirect entries")
    print(f"  raw html          {human(raw_total)}")
    print(f"  extracted text    {human(text_total)}   "
          f"({text_total/raw_total:.2%} of raw)")
    print(f"  median doc ratio  {statistics.median(ratios):.2%}")
    print(f"  median words/doc  {statistics.median(word_counts):,.0f}")
    print(f"  mean links/doc    {link_total/n_docs:,.1f}")
    print(f"  kinds             " + ", ".join(
        f"{KIND_NAMES.get(k, k)}={v:,}" for k, v in sorted(kinds.items())))

    # --- compression: per-document vs shared trained dictionary
    print(f"\n--- compression ({len(bodies):,} bodies)")
    plain = zstd.ZstdCompressor(level=19)
    t1 = time.perf_counter()
    solo = sum(len(plain.compress(b)) for b in bodies)
    solo_time = time.perf_counter() - t1
    print(f"  zstd-19 per-doc   {human(solo)}   ({solo/text_total:.2%} of text, "
          f"{text_total/max(solo,1):.2f}x)")

    train_set = [b for b in bodies if len(b) > 128][:20000]
    dict_size = 0
    if len(train_set) >= 64:
        try:
            zdict = zstd.train_dictionary(112 * 1024, train_set, level=19)
            dict_size = len(zdict.as_bytes())
            dc = zstd.ZstdCompressor(level=19, dict_data=zdict)
            withdict = sum(len(dc.compress(b)) for b in bodies)
            print(f"  zstd-19 + dict    {human(withdict)}   "
                  f"({withdict/text_total:.2%} of text, {text_total/max(withdict,1):.2f}x)")
            print(f"  dictionary gain   {(solo-withdict)/max(solo,1):+.1%} vs per-doc"
                  f"   (dict itself {human(dict_size)})")
            best = withdict
        except Exception as exc:
            print(f"  dictionary training failed: {exc}")
            best = solo
    else:
        best = solo

    # --- extrapolation to the whole archive
    # Derive the document count from the measured keep rate over a uniform random
    # sample of entry ids, not from article_count -- the filter changes the total.
    est_docs = int(a.all_entry_count * (n_docs / max(ids_consumed, 1)))
    scale = est_docs / n_docs
    est_body = best * scale
    # FTS5 detail=none runs ~25-35% of indexed text; lead index is far smaller.
    est_fts = text_total * scale * 0.30
    est_total = est_body + est_fts

    print(f"\n--- extrapolation to full archive")
    print(f"  est. documents    {est_docs:,}  (scale x{scale:,.1f})")
    print(f"  est. body blobs   {human(est_body)}")
    print(f"  est. deep FTS     {human(est_fts)}  (at 30% of text)")
    print(f"  est. codex total  {human(est_total)}   "
          f"vs {human(zim_size)} source  =  {zim_size/max(est_total,1):.1f}x smaller")

    docs_per_s = n_docs / max(wall, 1e-9)
    parse_per_s = n_docs / max(parse_time, 1e-9)
    print(f"\n--- throughput (single core)")
    print(f"  end-to-end        {docs_per_s:,.0f} docs/s  "
          f"(read+parse, wall {wall:,.1f}s)")
    print(f"  parse only        {parse_per_s:,.0f} docs/s")
    print(f"  compress          {len(bodies)/max(solo_time,1e-9):,.0f} docs/s at level 19")
    eta_1 = est_docs / max(docs_per_s, 1e-9)
    print(f"  est. 1 core       {eta_1/3600:,.2f} h for {est_docs:,} docs")
    # Scaling is NOT linear, and assuming it was is what produced the original
    # 2.10 h projection for a run that actually needs about five. Measured on a
    # 6-core/12-thread Ryzen 5 5600U against the real worker shape:
    #   4w 212 docs/s | 6w 283 | 8w 320 | 10w 384 | 12w 370
    # i.e. 10 workers is the plateau and delivers ~5.6x one core, not 10x.
    print(f"  est. 10 workers   {eta_1/5.6/3600:,.2f} h  "
          f"(measured 5.6x for 10 workers on 6 physical cores, not 10x)")
    print(f"  NOTE: this is pass 1 only. Add pass 2 (graph), pass 3 (indexes)")
    print(f"        and VACUUM -- roughly another hour at Wikipedia scale.")


if __name__ == "__main__":
    main(sys.argv[1])
