"""The codex build pipeline.

Streams a ZIM archive into a codex without ever materialising it on disk. The
source is opened read-only and never modified.

    pass 0  sample + train the shared zstd dictionary
    pass 1  extract, compress, write doc rows and the outbound edge file
    pass 2  resolve edges, drop dead ends, PageRank, write importance + related
    pass 3  build the FTS indexes

Passes 1-3 each checkpoint, so an interrupted overnight run resumes rather than
restarting.
"""
from __future__ import annotations

import hashlib
import json
import multiprocessing as mp
import os
import struct
import sys
import time
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import zstandard as zstd
from libzim.reader import Archive

from .adapters import pick_adapter
from .model import Doc
from .schema import (BUILD_PRAGMAS, apply_pragmas, get_meta, init_core,
                     init_core_indexes, init_deep, init_fts_quick, set_meta,
                     SCHEMA_VERSION)

# (src_id, dst_path_hash) written during extraction; resolved in pass 2.
EDGE_DTYPE = np.dtype([("src", "<u4"), ("dst", "<u8")])
EDGE_STRUCT = struct.Struct("<IQ")
DICT_SIZE = 112 * 1024
# Level 15, not 19. Measured over 584 real Wikipedia articles against a trained
# dictionary: 19 costs 0.94 ms/doc and stores 31.05% of the JSON, 15 costs
# 0.55 ms/doc and stores 31.19% -- about 30 MB more on a 7.9 GB body store, for
# 4% off the wall time of the longest pass. Override with --zstd-level.
ZSTD_LEVEL = 15
CHUNK = 2000          # entry ids per worker task
CHECKPOINT_EVERY = 50_000
CHECKPOINT_SECONDS = 120.0   # ...or this long, whichever comes first
PROGRESS_EVERY = 60.0        # seconds between progress lines


def path_hash(path: str) -> int:
    """Stable 64-bit path hash.

    Python's built-in hash() is randomised per process and therefore useless
    across worker boundaries; blake2b is stable and fast enough at this size.
    """
    return int.from_bytes(
        hashlib.blake2b(path.encode("utf-8", "surrogatepass"), digest_size=8).digest(),
        "little",
    )


def archive_meta(a: Archive) -> dict:
    meta = {}
    for k in a.metadata_keys:
        if k.startswith("Illustration"):
            continue
        try:
            meta[k] = bytes(a.get_metadata(k)).decode("utf-8", "replace")
        except Exception:
            pass
    return meta


# --------------------------------------------------------------------------
# worker
# --------------------------------------------------------------------------

_W: dict = {}


def _worker_init(zim_path: str, zdict_bytes: bytes | None,
                 level: int = ZSTD_LEVEL) -> None:
    """Each process gets its own Archive handle and compressor."""
    a = Archive(zim_path)
    _W["archive"] = a
    adapter = pick_adapter(archive_meta(a))
    # Adapters that need an archive-wide index (a table of contents, a path map)
    # build it once per worker rather than once per entry.
    adapter.prepare(a)
    _W["adapter"] = adapter
    if zdict_bytes:
        d = zstd.ZstdCompressionDict(zdict_bytes)
        _W["cctx"] = zstd.ZstdCompressor(level=level, dict_data=d)
    else:
        _W["cctx"] = None


def _extract_one(a: Archive, adapter, i: int) -> tuple[str, object] | None:
    """Return ('doc', payload) | ('redirect', payload) | None."""
    try:
        e = a._get_entry_by_id(i)
    except Exception:
        return None
    path = e.path
    if adapter.skip_path(path):
        return None
    try:
        if e.is_redirect:
            target = e.get_redirect_entry().path
            return ("redirect", (path, target))
        item = e.get_item()
        if not item.mimetype.startswith("text/html"):
            return None
        raw = bytes(item.content).decode("utf-8", "replace")
        # The body is not always in the entry we are standing on. A crawled
        # single-page app stores a routing stub here and the prose in a sibling
        # JSON entry, so the adapter gets to say where to actually read from.
        raw = adapter.source_for(a, e, raw)
        if raw is None:
            return None
    except Exception:
        return None

    try:
        doc = adapter.parse(raw, path, e.title)
    except Exception:
        return None
    if doc is None or not adapter.should_keep(doc):
        return None
    return ("doc", doc)


def _worker_chunk(args: tuple[int, int]) -> list[tuple]:
    """Parse a contiguous range of entry ids. Returns rows ready for SQLite."""
    lo, hi = args
    a = _W["archive"]
    adapter = _W["adapter"]
    cctx = _W["cctx"]
    out: list[tuple] = []

    for i in range(lo, hi):
        got = _extract_one(a, adapter, i)
        if got is None:
            continue
        tag, payload = got
        if tag == "redirect":
            out.append(("R", payload[0], payload[1]))
            continue

        doc: Doc = payload
        body_json = json.dumps([s.as_json() for s in doc.sections],
                               ensure_ascii=False, separators=(",", ":")
                               ).encode("utf-8")
        body = cctx.compress(body_json) if cctx else body_json
        meta = json.dumps(doc.meta, ensure_ascii=False,
                          separators=(",", ":")) if doc.meta else None
        link_hashes = [path_hash(p) for p in doc.links]
        out.append(("D", doc.path, doc.title, doc.kind, doc.word_count,
                    doc.lead, body, meta, link_hashes, doc.flags))
    return out


def _sample_chunk(args: tuple[int, int]) -> list[bytes]:
    """Pass 0: collect body JSON for dictionary training."""
    lo, hi = args
    a, adapter = _W["archive"], _W["adapter"]
    out = []
    for i in range(lo, hi):
        got = _extract_one(a, adapter, i)
        if got is None or got[0] != "doc":
            continue
        doc: Doc = got[1]
        b = json.dumps([s.as_json() for s in doc.sections],
                       ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        if len(b) > 128:
            out.append(b)
    return out


# --------------------------------------------------------------------------
# driver
# --------------------------------------------------------------------------

@dataclass
class BuildPaths:
    core: Path
    deep: Path
    edges: Path
    workdir: Path


def plan_paths(out_dir: str, name: str, scratch: str | None) -> BuildPaths:
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    # The edge file is large and transient; keep it off the volume holding the
    # source archive so the two do not compete for free space.
    work = Path(scratch) if scratch else out / "_work"
    work.mkdir(parents=True, exist_ok=True)
    return BuildPaths(core=out / f"{name}.codex.db",
                      deep=out / f"{name}.codex-deep.db",
                      edges=work / f"{name}.edges.bin",
                      workdir=work)


def log(msg: str) -> None:
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


def _gb(n: float) -> str:
    return f"{n/2**30:,.1f} GB"


def preflight(zim_path: str, n_entries: int, paths: "BuildPaths",
              level: int = ZSTD_LEVEL, sample: int = 400) -> dict:
    """Sample the archive to project output size, then check the disk can hold it.

    Measured rather than assumed: keep rate, links per document and compressed
    bytes per document all move by more than 2x between sources, so a hardcoded
    model would be wrong for every archive but the one it was fitted to. A
    twenty-second sample in front of a five-hour run is free.

    Returns {} when nothing could be sampled; the caller treats that as "no
    projection available" rather than as a failure.
    """
    import random
    import shutil

    a = Archive(zim_path)
    adapter = pick_adapter(archive_meta(a))
    adapter.prepare(a)
    rng = random.Random(1234)
    ids = rng.sample(range(n_entries), min(n_entries, sample * 30))
    cctx = zstd.ZstdCompressor(level=level)

    n_seen = n_docs = n_links = 0
    body_bytes = lead_bytes = 0
    for i in ids:
        if n_docs >= sample:
            break
        n_seen += 1
        got = _extract_one(a, adapter, i)
        if got is None or got[0] != "doc":
            continue
        doc = got[1]
        blob = json.dumps([s.as_json() for s in doc.sections],
                          ensure_ascii=False, separators=(",", ":")
                          ).encode("utf-8")
        body_bytes += len(cctx.compress(blob))
        lead_bytes += len(doc.lead.encode("utf-8", "replace"))
        n_links += len(doc.links)
        n_docs += 1

    if not n_docs:
        return {}

    est_docs = int(n_entries * (n_docs / max(n_seen, 1)))
    per_doc_core = (body_bytes + lead_bytes) / n_docs + 120  # +path/title/row
    est_core = est_docs * per_doc_core
    # fts_deep is contentless with detail=none, so it stores a term dictionary
    # and doclists rather than any text. Measured against finished builds it
    # lands at 13% of the core file on Wikipedia and 17% on iFixit; 35% leaves
    # headroom without demanding disk that will never be touched.
    est_deep = est_core * 0.35
    est_edges = est_docs * (n_links / n_docs) * EDGE_STRUCT.size
    # A 400-doc sample lands the document count within about 10% (measured
    # -1.0% to -8.8% across five archives), and it errs low -- the wrong
    # direction for a space check -- so carry a margin.
    margin = 1.15
    # VACUUM rewrites the core into a temporary copy before replacing it, so
    # the peak is two cores plus the deep file.
    need_out = (est_core + est_deep + est_core) * margin
    need_work = (est_edges + est_edges * 0.7) * margin

    out = {"docs": est_docs, "links_per_doc": n_links / n_docs,
           "core": est_core, "deep": est_deep, "edges": est_edges,
           "need_out": need_out, "need_work": need_work,
           "free_out": shutil.disk_usage(paths.core.parent).free,
           "free_work": shutil.disk_usage(paths.workdir).free}
    log(f"preflight: sampled {n_docs} docs from {n_seen:,} entries "
        f"-> est. {est_docs:,} documents, {out['links_per_doc']:,.1f} links each")
    log(f"  projected  core {_gb(est_core)}   deep {_gb(est_deep)}   "
        f"edge file {_gb(est_edges)}")
    log(f"  needs      {_gb(need_out)} on {paths.core.parent} "
        f"(free {_gb(out['free_out'])}), incl. room for VACUUM to copy the core")
    log(f"             {_gb(need_work)} on {paths.workdir} "
        f"(free {_gb(out['free_work'])})")
    return out


def train_dictionary(zim_path: str, n_entries: int, workers: int,
                     sample_target: int = 12000,
                     level: int = ZSTD_LEVEL) -> bytes:
    """Pass 0: train a shared zstd dictionary on a spread-out sample."""
    log(f"pass 0: sampling for dictionary training (target {sample_target:,} docs)")
    # Spread the sample across the whole archive so it is not biased toward one
    # alphabetical region.
    stride = max(1, n_entries // max(sample_target * 6, 1))
    ranges = [(i, min(i + 40, n_entries))
              for i in range(0, n_entries, max(stride * 40, 40))]

    samples: list[bytes] = []
    with mp.Pool(workers, initializer=_worker_init,
                 initargs=(zim_path, None, level)) as pool:
        for got in pool.imap_unordered(_sample_chunk, ranges, chunksize=4):
            samples.extend(got)
            if len(samples) >= sample_target:
                break

    if len(samples) < 64:
        log(f"  only {len(samples)} samples; skipping dictionary")
        return b""
    # Train at the level the bodies will be compressed at, so the dictionary is
    # tuned for the encoder that will actually use it.
    #
    # This is single-threaded and roughly linear in sample bytes -- about 85s
    # per 70 MB -- so it looks like a hang after the parallel sampling above.
    # Resist the urge to feed it less: measured on held-out Wikipedia bodies,
    # training on 4 MB instead of 71 MB costs 5.1% on every compressed body
    # thereafter, which is far more than the couple of minutes it saves.
    mb = sum(len(s) for s in samples) / 1e6
    log(f"  training on {len(samples):,} docs / {mb:,.0f} MB "
        f"(single-threaded, ~{mb*85/70:,.0f}s)")
    zd = zstd.train_dictionary(DICT_SIZE, samples, level=level)
    raw = zd.as_bytes()
    log(f"  trained on {len(samples):,} docs -> {len(raw)/1024:,.0f} KB dictionary")
    return raw


def _hms(seconds: float) -> str:
    seconds = max(int(seconds), 0)
    h, rem = divmod(seconds, 3600)
    m, s = divmod(rem, 60)
    return f"{h:d}h{m:02d}m" if h else f"{m:d}m{s:02d}s"


def _rewind_edges(con, edges_path: Path) -> None:
    """Discard edges written past the last committed checkpoint.

    Edges are now durable *before* the transaction that accounts for them, so a
    crash in between leaves the file longer than the watermark. Appending to it
    as-is would double up the edges for those documents.
    """
    raw = get_meta(con).get("edge_bytes")
    if raw is None:
        # A codex checkpointed by a build predating this field. It has no record
        # of how far the edge file was accounted for, and truncating to zero
        # would throw away a perfectly good one, so leave it alone.
        log("  no edge_bytes watermark (older build); appending without rewind")
        return
    recorded = int(raw or 0)
    if not edges_path.exists():
        return
    actual = edges_path.stat().st_size
    if actual > recorded:
        log(f"  edge file is {actual - recorded:,} bytes past the last "
            f"checkpoint; rewinding to {recorded:,}")
        with open(edges_path, "r+b") as ef:
            ef.truncate(recorded)


def extract_pass(con, zim_path: str, n_entries: int, workers: int,
                 edges_path: Path, zdict_bytes: bytes, resume_from: int = 0,
                 level: int = ZSTD_LEVEL) -> int:
    """Pass 1: extract every document, compress, and stream out the edge file."""
    log(f"pass 1: extracting from entry {resume_from:,} of {n_entries:,} "
        f"across {workers} workers (zstd level {level})")

    ranges = [(i, min(i + CHUNK, n_entries))
              for i in range(resume_from, n_entries, CHUNK)]
    n_docs = n_redirect = n_flagged = 0
    doc_rows: list[tuple] = []
    red_rows: list[tuple] = []
    next_id = con.execute("SELECT COALESCE(MAX(id), 0) FROM doc").fetchone()[0] + 1
    t0 = time.perf_counter()
    done_entries = resume_from
    last_t, last_docs, last_entries = t0, 0, resume_from
    last_flush = t0

    edge_buf = bytearray()
    if resume_from:
        _rewind_edges(con, edges_path)
    mode = "ab" if resume_from else "wb"
    with open(edges_path, mode) as ef, \
            mp.Pool(workers, initializer=_worker_init,
                    initargs=(zim_path, zdict_bytes or None, level)) as pool:

        for got in pool.imap(_worker_chunk, ranges, chunksize=1):
            done_entries += CHUNK
            for row in got:
                if row[0] == "R":
                    red_rows.append((row[1], row[2]))
                    n_redirect += 1
                    continue
                (_, path, title, kind, wc, lead, body, meta, link_hashes,
                 flags) = row
                doc_id = next_id
                next_id += 1
                doc_rows.append((doc_id, path, title, kind, wc, lead, body,
                                 meta, flags))
                for h in link_hashes:
                    edge_buf += EDGE_STRUCT.pack(doc_id, h)
                n_docs += 1
                if flags:
                    n_flagged += 1

            now = time.perf_counter()
            # Checkpoint on either trigger. Count alone is not enough: it is
            # 50,000 *kept* documents, so a stretch of archive that keeps
            # little can run for a long time with nothing durable behind it,
            # and everything since the last checkpoint is lost on a crash.
            if (len(doc_rows) >= CHECKPOINT_EVERY
                    or (doc_rows and now - last_flush >= CHECKPOINT_SECONDS)):
                _flush(con, doc_rows, red_rows, ef, edge_buf,
                       done_entries, n_entries)
                doc_rows, red_rows, edge_buf = [], [], bytearray()
                last_flush = now

            # Progress is reported on its own timer, and as an instantaneous
            # rate: a cumulative average hides a slowdown completely.
            if now - last_t >= PROGRESS_EVERY:
                scanned = min(done_entries, n_entries)
                inst = (n_docs - last_docs) / (now - last_t)
                entry_rate = (done_entries - last_entries) / (now - last_t)
                eta = (n_entries - scanned) / max(entry_rate, 1e-9)
                log(f"  {scanned/n_entries*100:5.1f}%  {n_docs:,} docs  "
                    f"{n_redirect:,} redirects  {inst:,.0f} docs/s "
                    f"(avg {n_docs/max(now-t0,1e-9):,.0f})  "
                    f"eta {_hms(eta)} -> "
                    f"{time.strftime('%a %H:%M', time.localtime(time.time()+eta))}")
                last_t, last_docs, last_entries = now, n_docs, done_entries

        _flush(con, doc_rows, red_rows, ef, edge_buf, n_entries, n_entries)

    log(f"  extracted {n_docs:,} docs, {n_redirect:,} redirects in "
        f"{(time.perf_counter()-t0)/60:,.1f} min")
    log(f"  {n_flagged:,} docs ({n_flagged/max(n_docs,1):.1%}) flagged "
        f"image-dependent")
    return n_docs


def _flush(con, doc_rows, red_rows, ef, edge_buf, done, total) -> None:
    """Checkpoint. Edges reach the disk *before* the rows that reference them.

    `resume_entry` means "every entry below this is fully accounted for", so
    everything it covers has to be durable by the time it is committed. The
    edge write used to happen after the COMMIT, which meant a crash in the gap
    left up to 50,000 documents with no outbound links at all -- no error, no
    warning, just a quietly worse graph five hours later.
    """
    if edge_buf:
        ef.write(edge_buf)
        ef.flush()
        os.fsync(ef.fileno())
    con.execute("BEGIN")
    if doc_rows:
        con.executemany(
            "INSERT INTO doc(id, path, title, kind, word_count, lead, body, "
            "meta, flags) VALUES(?,?,?,?,?,?,?,?,?)", doc_rows)
    if red_rows:
        # from_path is the PK; a ZIM can contain duplicate redirect sources.
        con.executemany(
            "INSERT OR IGNORE INTO redirect_raw(from_path, to_path) VALUES(?,?)",
            red_rows)
    set_meta(con, resume_entry=str(min(done, total)), edge_bytes=str(ef.tell()))
    con.execute("COMMIT")
