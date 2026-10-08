"""What exactly is the Wikipedia adapter rejecting? Are we dropping real articles?"""
from __future__ import annotations

import collections
import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from libzim.reader import Archive

from codex.adapters import pick_adapter

a = Archive(sys.argv[1])
meta = {}
for k in a.metadata_keys:
    if not k.startswith("Illustration"):
        try:
            meta[k] = bytes(a.get_metadata(k)).decode("utf-8", "replace")
        except Exception:
            pass
adapter = pick_adapter(meta)
print(f"adapter={adapter.name} min_words={adapter.min_words}\n")

rng = random.Random(7)
n_ids = min(a.all_entry_count, 40000)
ids = rng.sample(range(a.all_entry_count), n_ids)

rejected = []
kept_words = []
mime_of_rejected = collections.Counter()
n_html = 0
for i in ids:
    if n_html >= 1500:
        break
    e = a._get_entry_by_id(i)
    if e.is_redirect:
        continue
    it = e.get_item()
    if not it.mimetype.startswith("text/html"):
        continue
    n_html += 1
    raw = bytes(it.content).decode("utf-8", "replace")
    doc = adapter.parse(raw, e.path, e.title)
    if doc is None:
        rejected.append((e.path, len(raw), -1, 0))
        continue
    if not adapter.should_keep(doc):
        rejected.append((e.path, len(raw), doc.word_count, len(doc.links)))
    else:
        kept_words.append(doc.word_count)

print(f"html sampled: {n_html:,}  kept: {len(kept_words):,}  rejected: {len(rejected):,}")

print("\n--- rejected: size distribution of the source HTML")
buckets = collections.Counter()
for _, rawlen, _, _ in rejected:
    if rawlen < 2000:
        buckets["<2KB"] += 1
    elif rawlen < 10000:
        buckets["2-10KB"] += 1
    elif rawlen < 50000:
        buckets["10-50KB"] += 1
    else:
        buckets[">50KB"] += 1
for k in ("<2KB", "2-10KB", "10-50KB", ">50KB"):
    print(f"  {k:<10} {buckets.get(k,0):,}")

print("\n--- 20 rejected samples (path, raw bytes, words, links)")
rejected.sort(key=lambda r: -r[1])
for p, rawlen, wc, nl in rejected[:20]:
    print(f"  {rawlen:>8,}b w={wc:<6} l={nl:<4} {p[:70]}")

if kept_words:
    kept_words.sort()
    print(f"\nkept word counts: min={kept_words[0]:,} "
          f"p50={kept_words[len(kept_words)//2]:,} max={kept_words[-1]:,}")
