"""Why do iFixit redirects fail to resolve to documents?"""
from __future__ import annotations

import collections
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from libzim.reader import Archive

from codex.adapters import pick_adapter
from codex.build import archive_meta

a = Archive(sys.argv[1])
adapter = pick_adapter(archive_meta(a))

src_prefix = collections.Counter()
dst_prefix = collections.Counter()
dst_mime = collections.Counter()
samples = []

n = 0
for i in range(0, a.all_entry_count, max(1, a.all_entry_count // 60000)):
    try:
        e = a._get_entry_by_id(i)
    except Exception:
        continue
    if not e.is_redirect:
        continue
    n += 1
    try:
        tgt = e.get_redirect_entry()
    except Exception:
        continue
    sp = e.path.split("/", 1)[0] if "/" in e.path else "(root)"
    dp = tgt.path.split("/", 1)[0] if "/" in tgt.path else "(root)"
    src_prefix[sp] += 1
    dst_prefix[dp] += 1
    try:
        dst_mime[tgt.get_item().mimetype] += 1
    except Exception:
        dst_mime["<redirect-to-redirect>"] += 1
    if len(samples) < 12:
        samples.append((e.path, tgt.path))

print(f"sampled {n:,} redirects\n")
print("--- source prefix")
for k, v in src_prefix.most_common(10):
    print(f"  {v:>7,}  {k}")
print("\n--- target prefix")
for k, v in dst_prefix.most_common(10):
    print(f"  {v:>7,}  {k}")
print("\n--- target mimetype")
for k, v in dst_mime.most_common(10):
    print(f"  {v:>7,}  {k}")
print("\n--- samples (source -> target)")
for s, t in samples:
    skipped = " [SRC SKIPPED]" if adapter.skip_path(s) else ""
    print(f"  {s[:58]}\n    -> {t[:58]}{skipped}")
