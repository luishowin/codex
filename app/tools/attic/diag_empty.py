"""Diagnose why most sampled documents extract almost no text."""
from __future__ import annotations

import collections
import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from libzim.reader import Archive
from selectolax.lexbor import LexborHTMLParser

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

rng = random.Random(1234)
ids = rng.sample(range(a.all_entry_count), 20000)

prefix_words = collections.defaultdict(list)
low_samples = []
n = 0
for i in ids:
    if n >= 1200:
        break
    e = a._get_entry_by_id(i)
    if e.is_redirect:
        continue
    it = e.get_item()
    if not it.mimetype.startswith("text/html"):
        continue
    raw = bytes(it.content).decode("utf-8", "replace")
    doc = adapter.parse(raw, e.path, e.title)
    n += 1
    prefix = e.path.split("/", 1)[0] if "/" in e.path else "(root)"
    wc = doc.word_count if doc else -1
    prefix_words[prefix].append((wc, len(raw)))
    if doc is not None and wc < 20 and len(low_samples) < 6 and len(raw) > 8000:
        low_samples.append((e.path, raw, doc))

print(f"sampled {n} html docs\n")
print(f"{'prefix':<22}{'count':>7}{'median words':>14}{'median raw':>12}")
for p, vals in sorted(prefix_words.items(), key=lambda kv: -len(kv[1])):
    ws = sorted(v[0] for v in vals)
    rs = sorted(v[1] for v in vals)
    print(f"{p:<22}{len(vals):>7}{ws[len(ws)//2]:>14,}{rs[len(rs)//2]:>12,}")

print("\n=== low-yield samples (big HTML, tiny extraction)")
for path, raw, doc in low_samples[:3]:
    print(f"\n--- {path}  raw={len(raw):,} words={doc.word_count} "
          f"sections={len(doc.sections)} lead={len(doc.lead)}")
    tree = LexborHTMLParser(raw)
    for sel in ("#mainBody", "#main", "body", ".wiki-content", "#wiki-content",
                ".page-content", "main", "article", "#content"):
        node = tree.css_first(sel)
        if node is not None:
            print(f"    {sel:<16} textlen={len(node.text(strip=True)):,}")
    body = tree.css_first("body")
    if body:
        print(f"    RAW BODY TEXT (first 300): "
              f"{body.text(separator=' ', strip=True)[:300]!r}")
