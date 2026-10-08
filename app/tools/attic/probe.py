"""Reconnaissance probe: what is actually inside a ZIM archive?

Read-only. Reports entry mix, namespace/MIME distribution, and dumps a couple of
sample article bodies so we can see the real HTML shape before writing a parser.
"""
import sys
import collections
from libzim.reader import Archive

path = sys.argv[1]
a = Archive(path)

print(f"=== {path}")
print(f"  entry_count      = {a.entry_count:,}")
print(f"  all_entry_count  = {a.all_entry_count:,}")
print(f"  article_count    = {a.article_count:,}")
print(f"  media_count      = {a.media_count:,}")
print(f"  has_fulltext_idx = {a.has_fulltext_index}")
print(f"  has_title_idx    = {a.has_title_index}")
print(f"  main_entry       = {a.main_entry.path if a.has_main_entry else None}")
print(f"  uuid             = {a.uuid}")

print("\n--- metadata")
for k in a.metadata_keys:
    try:
        v = bytes(a.get_metadata(k)).decode("utf-8", "replace")
    except Exception as e:
        v = f"<{e}>"
    if len(v) > 160:
        v = v[:160] + "..."
    print(f"  {k}: {v}")

# Sample the entry space to learn the mime/namespace mix without a full scan.
N = a.all_entry_count
step = max(1, N // 30000)
mimes = collections.Counter()
redirects = 0
sampled = 0
html_paths = []

for i in range(0, N, step):
    try:
        e = a._get_entry_by_id(i)
    except Exception:
        continue
    sampled += 1
    if e.is_redirect:
        redirects += 1
        continue
    try:
        m = e.get_item().mimetype
    except Exception:
        m = "<err>"
    mimes[m] += 1
    if m.startswith("text/html") and len(html_paths) < 400:
        html_paths.append(e.path)

print(f"\n--- sampled {sampled:,} of {N:,} entries (every {step})")
print(f"  redirects: {redirects:,} ({redirects/max(sampled,1)*100:.1f}%)")
for m, c in mimes.most_common():
    print(f"  {c/max(sampled,1)*100:6.2f}%  {c:>6,}  {m}")

print(f"\n--- sample html paths")
for p in html_paths[:15]:
    print(f"  {p}")

# Dump one real article body so we can see the markup we must strip.
if html_paths:
    target = html_paths[len(html_paths) // 2]
    item = a.get_entry_by_path(target).get_item()
    raw = bytes(item.content).decode("utf-8", "replace")
    print(f"\n--- BODY SAMPLE: {target}  ({len(raw):,} bytes)")
    print(raw[:3000])
