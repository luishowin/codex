"""Measure the image population before choosing a storage policy.

Answers: how big are the stored images, how many does a guide actually
reference, and what would each policy cost on disk?
"""
from __future__ import annotations

import io
import random
import statistics
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from libzim.reader import Archive
from PIL import Image

from codex.adapters import pick_adapter
from codex.build import archive_meta

a = Archive(sys.argv[1])
adapter = pick_adapter(archive_meta(a))


def human(n):
    for u in ("B", "KB", "MB", "GB"):
        if abs(n) < 1024:
            return f"{n:,.1f}{u}"
        n /= 1024
    return f"{n:,.1f}TB"


# --- 1. what do stored images look like?
rng = random.Random(11)
sizes, dims = [], []
n_img = 0
for i in rng.sample(range(a.all_entry_count), 40000):
    if n_img >= 600:
        break
    e = a._get_entry_by_id(i)
    if e.is_redirect:
        continue
    it = e.get_item()
    if not it.mimetype.startswith("image/"):
        continue
    n_img += 1
    sizes.append(it.size)
    if len(dims) < 150:
        try:
            im = Image.open(io.BytesIO(bytes(it.content)))
            dims.append(im.size)
        except Exception:
            pass

sizes.sort()
print(f"--- {n_img:,} sampled images in archive")
print(f"  median {human(statistics.median(sizes))}   mean {human(sum(sizes)/len(sizes))}")
print(f"  p90 {human(sizes[int(len(sizes)*.9)])}   max {human(sizes[-1])}")
if dims:
    ws = sorted(d[0] for d in dims)
    hs = sorted(d[1] for d in dims)
    print(f"  median dims  {ws[len(ws)//2]} x {hs[len(hs)//2]}")
    big = sum(1 for w, h in dims if max(w, h) > 640)
    print(f"  over 640px   {big}/{len(dims)} ({big/len(dims):.0%})")

# --- 2. how many images does a document reference?
counts_by_kind: dict[str, list[int]] = {}
KIND = {0: "article", 1: "guide", 2: "device"}
checked = 0
for i in rng.sample(range(a.all_entry_count), 40000):
    if checked >= 400:
        break
    e = a._get_entry_by_id(i)
    if e.is_redirect or adapter.skip_path(e.path):
        continue
    it = e.get_item()
    if not it.mimetype.startswith("text/html"):
        continue
    raw = bytes(it.content).decode("utf-8", "replace")
    doc = adapter.parse(raw, e.path, e.title)
    if doc is None or not adapter.should_keep(doc):
        continue
    checked += 1
    counts_by_kind.setdefault(KIND.get(doc.kind, "?"), []).append(len(doc.images))

print(f"\n--- images referenced per document ({checked} docs)")
for k, v in sorted(counts_by_kind.items()):
    v.sort()
    print(f"  {k:<8} n={len(v):<4} median={v[len(v)//2]:<4} "
          f"mean={sum(v)/len(v):<6.1f} p90={v[int(len(v)*.9)]:<4} max={v[-1]}")

# --- 3. what would transcoding buy?
print("\n--- transcode test (source -> WebP q80)")
for cap in (320, 480, 640):
    tot_src = tot_out = 0
    k = 0
    for i in rng.sample(range(a.all_entry_count), 20000):
        if k >= 40:
            break
        e = a._get_entry_by_id(i)
        if e.is_redirect:
            continue
        it = e.get_item()
        if not it.mimetype.startswith("image/"):
            continue
        try:
            blob = bytes(it.content)
            im = Image.open(io.BytesIO(blob))
            im.thumbnail((cap, cap))
            buf = io.BytesIO()
            im.convert("RGB").save(buf, "WEBP", quality=80, method=4)
        except Exception:
            continue
        k += 1
        tot_src += len(blob)
        tot_out += buf.tell()
    if k:
        print(f"  cap {cap}px: {human(tot_src/k)} -> {human(tot_out/k)} per image "
              f"({tot_out/max(tot_src,1):.0%})")
