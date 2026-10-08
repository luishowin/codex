"""Dry-run the hygiene rules against the live corpus and show before/after.

Nothing is written. This exists so the excision rules can be eyeballed on real
sentences before a rebuild bakes them in.
"""
from __future__ import annotations

import json
import sqlite3
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import zstandard as zstd

from codex.hygiene import clean_text, _DEPENDENT
from codex.paths import data_dir

db = sqlite3.connect(
    f"file:{data_dir() / 'ifixit.codex.db'}?mode=ro", uri=True)
zd = zstd.ZstdCompressionDict(
    db.execute("SELECT dict FROM zdict WHERE id=1").fetchone()[0])
dctx = zstd.ZstdDecompressor(dict_data=zd)

LIMIT = int(sys.argv[1]) if len(sys.argv) > 1 else 3000

changed = dropped_all = flagged = scanned = 0
examples: list[tuple[str, str]] = []
flag_examples: list[str] = []

for _id, body in db.execute(
        "SELECT id, body FROM doc WHERE body IS NOT NULL "
        "ORDER BY importance DESC LIMIT ?", (LIMIT,)):
    try:
        secs = json.loads(dctx.decompress(body))
    except Exception:
        continue
    scanned += 1
    doc_flagged = False
    for s in secs:
        t = s.get("t") or ""
        if not t:
            continue
        cleaned, dep = clean_text(t)
        doc_flagged = doc_flagged or dep
        if cleaned != t:
            changed += 1
            if not cleaned.strip():
                dropped_all += 1
            if len(examples) < 14 and len(t) < 400:
                examples.append((t, cleaned))
        if dep and len(flag_examples) < 6:
            for line in cleaned.split("\n"):
                if _DEPENDENT.search(line) and len(line) < 220:
                    flag_examples.append(line)
                    break
    flagged += doc_flagged

print(f"scanned {scanned:,} documents")
print(f"  sections modified      {changed:,}")
print(f"  sections emptied       {dropped_all:,}")
print(f"  documents flagged      {flagged:,} ({flagged/max(scanned,1):.1%})")

print("\n=== BEFORE / AFTER")
for before, after in examples:
    b = " ".join(before.split())[:190]
    a = " ".join(after.split())[:190]
    if b == a:
        continue
    print(f"\n  -  {b}")
    print(f"  +  {a}")

print("\n=== KEPT AND FLAGGED (image-dependent, deliberately not rewritten)")
for line in flag_examples:
    print(f"  ! {' '.join(line.split())[:180]}")
