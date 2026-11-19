#!/usr/bin/env python3
"""Quality scorecard for the shelf: what looks broken, and what is safe to drop.

Codex repair is a per-corpus job, so it needs a per-corpus number. This reads
each roll read-only and reports the pathologies that actually turned up in the
shipped film, with samples and a title list -- "gibberish" is not actionable
until you know whether it is 8 documents or 800.

    python app/tools/audit.py                    # every roll on the shelf
    python app/tools/audit.py --codex mdn -v     # one roll, with samples
    python app/tools/audit.py --json > audit.json

The four measured diseases:

    capture   zimit replay shells (``runner.html?uuid=`` and no prose) and
              pages crawled from another host (MDN carries 8 off-site pages)
    titles    a title that is a URL or a 40-hex capture id instead of a name
    leads     a lead that opens with a language switcher (ready.gov: 84%)
    thin      documents with almost no words at all

What it will *not* do: call a repeated title junk. A shelf of books has a
"Chapter 1", a "Glossary" and a "Table of Contents" in every book -- that is
structure, not noise, and the contents view exists to show it. Repeats are
reported so they can be read, never proposed for deletion.

Two honesty rules, because the counts here justify deletions later:

* `would drop` counts only what is unambiguous: replay shells and off-host
  pages. Everything else is `strip` (leads) or `review` (thin docs, titles).
* Nothing is sampled silently. A large roll is read up to `--limit` rows and
  the report says so.
"""
from __future__ import annotations

import argparse
import json
import re
import sqlite3
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from codex import paths  # noqa: E402
from codex.artifacts import (SHELL_WORDS, host_of, looks_like_shell,  # noqa: E402
                             strip_language_switcher, title_key, title_kind)

SHORT_LEAD = 40        # characters; below this a lead is not a sentence
THIN_DOC = 40          # words; below this a document is a fragment
DEFAULT_LIMIT = 200_000  # rows read per roll before the report says "sampled"


def language_hits(lead: str) -> int:
    """Kept for the samples: 1 when the lead opens with a language picker.

    The metric is the same function the builder uses, not a second regex that
    could count a page listing its own translations as page furniture.
    """
    return 1 if strip_language_switcher(lead or "") != (lead or "") else 0


def is_shell(path: str, words: int) -> bool:
    """Kept as a name here because the audit reports it; one implementation."""
    return looks_like_shell(path, words)


def _open(db: Path) -> sqlite3.Connection:
    return sqlite3.connect(f"file:{db}?mode=ro", uri=True)


def analyse(db: Path, limit: int | None = DEFAULT_LIMIT) -> dict:
    """One roll's scorecard. Streams the table; never holds the corpus."""
    con = _open(db)
    try:
        total = con.execute("SELECT COUNT(*) FROM doc").fetchone()[0]
        cap = min(limit, total) if limit else total
        cur = con.execute(
            "SELECT id, title, lead, word_count, kind, path, context_id "
            "FROM doc ORDER BY id LIMIT ?", (cap,))

        counts = Counter()
        samples: dict[str, list] = {}
        hosts = Counter()
        titles = Counter()
        drop_ids: set[int] = set()
        hosted_ids: dict[int, str] = {}
        words_total = 0
        anchors = sections = 0
        hosted = 0
        modal = ""
        off_ids: set[int] = set()

        def note(kind: str, sample: str) -> None:
            counts[kind] += 1
            if len(samples.setdefault(kind, [])) < 6:
                samples[kind].append(sample[:120])

        for doc_id, title, lead, wc, kind, path, ctx in cur:
            wc = wc or 0
            words_total += wc
            if kind == 2:
                anchors += 1
            if ctx is not None:
                sections += 1

            h = host_of(path)
            if h:
                hosts[h] += 1
                hosted += 1
                hosted_ids[doc_id] = h
            k = title_key(title)
            if k:
                titles[k] += 1

            tk = title_kind(title)
            if tk:
                note(tk, f"{doc_id}  {title}")
            if (lead or "").strip() == "":
                note("no-lead", f"{doc_id}  {title}")
            elif len(lead.strip()) < SHORT_LEAD:
                note("short-lead", f"{doc_id}  {title}  ::  {lead.strip()[:60]}")
            if language_hits(lead) >= 1:
                note("furniture-lead", f"{doc_id}  {title}")
            if wc < THIN_DOC:
                note("thin-doc", f"{doc_id}  {wc}w  {title}")
            if is_shell(path, wc):
                note("shell", f"{doc_id}  {wc}w  {title}")
                drop_ids.add(doc_id)

        # Off-site documents only mean something for a capture whose paths
        # really are URLs. On a plain roll they are article names that happen
        # to contain a dot, and calling those "off-host" would be a lie.
        if cap and hosts and hosted / cap >= 0.5:
            modal = hosts.most_common(1)[0][0]
            off_ids = {i for i, h in hosted_ids.items() if h != modal}
            few = list(off_ids)[:6]
            if few:
                qs = ",".join("?" * len(few))
                for doc_id, p, title in con.execute(
                        f"SELECT id, path, title FROM doc WHERE id IN ({qs})", few):
                    samples.setdefault("off-host", []).append(
                        f"{doc_id}  {host_of(p)}  {title}"[:120])
    finally:
        con.close()

    off_host = len(off_ids)
    repeated = [(t, n) for t, n in titles.most_common(8) if n > 3]
    repeated_total = sum(1 for n in titles.values() if n > 3)

    return {
        "codex": db.name[:-len(".codex.db")],
        "docs": total,
        "read": cap,
        "sampled": cap < total,
        "words": words_total,
        "avg_words": round(words_total / cap) if cap else 0,
        "structure": {"anchors": anchors, "sections": sections},
        "counts": {
            "url-title": counts["url"],
            "host-title": counts["host"],
            "capture-id-title": counts["capture-id"],
            "no-lead": counts["no-lead"],
            "short-lead": counts["short-lead"],
            "furniture-lead": counts["furniture-lead"],
            "thin-doc": counts["thin-doc"],
            "shell": counts["shell"],
            "off-host": off_host,
        },
        "modal_host": modal,
        "repeated_titles": repeated,
        "repeated_total": repeated_total,
        "would_drop": len(drop_ids | off_ids),
        "samples": samples,
    }


def fmt(n: int) -> str:
    return f"{n:,}"


def report(a: dict, verbose: bool) -> str:
    c = a["counts"]
    size = f"{fmt(a['read'])} docs" + (" (sampled)" if a["sampled"] else "")
    out = [f"== {a['codex']:20} {size} · {a['avg_words']} words avg · "
           f"{a['structure']['anchors']} anchors / {a['structure']['sections']} sections"]

    titles = c["url-title"] + c["host-title"] + c["capture-id-title"]
    out.append(f"   titles   {fmt(c['url-title'])} url · {fmt(c['host-title'])} host · "
               f"{fmt(c['capture-id-title'])} capture-id · "
               f"{fmt(a['repeated_total'])} repeated")
    out.append(f"   leads    {fmt(c['no-lead'])} empty · {fmt(c['short-lead'])} short · "
               f"{fmt(c['furniture-lead'])} furniture")
    out.append(f"   docs     {fmt(c['thin-doc'])} thin (<{THIN_DOC}w)")
    out.append(f"   capture  {fmt(c['shell'])} replay shells · "
               f"{fmt(c['off-host'])} off-host (modal {a['modal_host'] or 'n/a'})")
    review = c["thin-doc"] + titles
    out.append(f"   would    drop {fmt(a['would_drop'])} (shells + off-host) · "
               f"strip {fmt(c['furniture-lead'])} leads · review {fmt(review)}")

    if a["repeated_titles"]:
        top = ", ".join(f"{t!r} x{n}" for t, n in a["repeated_titles"][:4])
        out.append(f"   repeats  {top}")
    if verbose:
        for kind, rows in sorted(a["samples"].items()):
            out.append(f"   {kind}:")
            for row in rows:
                out.append(f"     {row}")
    return "\n".join(out)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--codex", action="append", default=[],
                    help="limit to a roll name (repeatable)")
    ap.add_argument("--data", type=Path, default=paths.data_dir())
    ap.add_argument("--limit", type=int, default=DEFAULT_LIMIT,
                    help=f"read at most this many rows per roll (default {DEFAULT_LIMIT:,}; 0 = all)")
    ap.add_argument("--all", action="store_true",
                    help="include rolls hidden from the shelf")
    ap.add_argument("--json", action="store_true")
    ap.add_argument("-v", "--verbose", action="store_true",
                    help="print sample rows for every category")
    a = ap.parse_args()

    hidden = set() if a.all else paths.hidden_rolls()
    wanted = set(a.codex)
    rolls = [p for p in sorted(a.data.glob("*.codex.db"))
             if not p.name.endswith("-deep.db")
             and p.name[:-len(".codex.db")] not in hidden
             and (not wanted or p.name[:-len(".codex.db")] in wanted)]
    if not rolls:
        print("no rolls found", file=sys.stderr)
        return 1

    results = [analyse(p, a.limit or None) for p in rolls]
    if a.json:
        print(json.dumps({"codexes": results}, indent=1, ensure_ascii=False))
        return 0
    for r in results:
        print(report(r, a.verbose))
    bad = [r for r in results if r["would_drop"]]
    if bad:
        print(f"\n{len(bad)} roll(s) carry documents safe to drop on the next rebuild: "
              + ", ".join(f"{r['codex']} ({r['would_drop']})" for r in bad))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
