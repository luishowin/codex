"""Second probe: find the real content region and learn the libzim iteration API."""
import sys
from libzim.reader import Archive
from selectolax.lexbor import LexborHTMLParser

path = sys.argv[1]
a = Archive(path)

print("--- Archive API surface")
print([m for m in dir(a) if not m.startswith("__")])

# How do we iterate only the user-facing articles?
for name in ("iter_articles", "iter_efficient_order", "iter_by_path", "iter_by_title"):
    fn = getattr(a, name, None)
    print(f"  {name}: {'YES' if fn else 'no'}")

e0 = a._get_entry_by_id(a.all_entry_count // 2)
print("\n--- Entry API surface")
print([m for m in dir(e0) if not m.startswith("_")])
print("--- Item API surface")
print([m for m in dir(e0.get_item()) if not m.startswith("_")]
      if not e0.is_redirect else "<redirect>")
print(f"has_new_namespace_scheme = {a.has_new_namespace_scheme}")

target = sys.argv[2] if len(sys.argv) > 2 else None
if target is None:
    # find a guide page by scanning entry ids
    for i in range(a.all_entry_count):
        e = a._get_entry_by_id(i)
        if e.path.startswith("Guide/") and not e.is_redirect:
            target = e.path
            break

print(f"\n=== CONTENT STRUCTURE: {target}")
raw = bytes(a.get_entry_by_path(target).get_item().content).decode("utf-8", "replace")
print(f"raw bytes: {len(raw):,}")

tree = LexborHTMLParser(raw)
title_node = tree.css_first("title")
print(f"<title>: {title_node.text() if title_node else None}")

# What top-level structural containers exist, and how big is each?
print("\n--- candidate content containers (id / class -> text length)")
seen = []
for sel in ("#main", "#mainBody", "#page", "article", "main", ".guide-container",
            ".wiki-container", "#contentArea", ".content", "#mw-content-text", "section"):
    for n in tree.css(sel):
        t = n.text(separator=" ", strip=True)
        seen.append((sel, n.attributes.get("id"), n.attributes.get("class"), len(t)))
for s in seen[:25]:
    print(f"  {s[0]:<18} id={str(s[1])[:22]:<24} class={str(s[2])[:34]:<36} textlen={s[3]:,}")

body = tree.css_first("body")
full_text = body.text(separator=" ", strip=True) if body else ""
print(f"\nwhole-body text length: {len(full_text):,}  (ratio to raw: {len(full_text)/len(raw):.1%})")

print("\n--- headings in document order")
for h in tree.css("h1, h2, h3")[:30]:
    print(f"  <{h.tag}> {h.text(strip=True)[:90]}")

print("\n--- first 1200 chars of body text")
print(full_text[:1200])
