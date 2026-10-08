"""Probe Wikipedia ZIM article structure (uses the small 100-article ZIM for speed)."""
import sys
from libzim.reader import Archive
from selectolax.lexbor import LexborHTMLParser

a = Archive(sys.argv[1])
print(f"entries={a.all_entry_count:,} articles={a.article_count:,} media={a.media_count:,}")
print(f"new_namespace={a.has_new_namespace_scheme}")

cands = []
for i in range(a.all_entry_count):
    e = a._get_entry_by_id(i)
    if e.is_redirect:
        continue
    it = e.get_item()
    if it.mimetype.startswith("text/html"):
        cands.append((it.size, e.path))
cands.sort(reverse=True)
print(f"\nhtml entries: {len(cands):,}; largest:")
for s, p in cands[:8]:
    print(f"  {s:>9,}  {p}")

size, target = cands[min(2, len(cands) - 1)]
raw = bytes(a.get_entry_by_path(target).get_item().content).decode("utf-8", "replace")
tree = LexborHTMLParser(raw)
print(f"\n=== {target}  raw={len(raw):,}")

print("--- container candidates")
for sel in ("#mw-content-text", ".mw-parser-output", "#content", "main", "article",
            "section", "body", "details", ".mw-body-content"):
    ns = tree.css(sel)
    if ns:
        print(f"  {sel:<22} count={len(ns):<4} textlen={sum(len(n.text(strip=True)) for n in ns):,}")

print("\n--- noise classes worth stripping (sampled)")
for sel in ("table.infobox", ".navbox", ".reflist", ".mw-references-wrap", "sup.reference",
            ".thumb", ".hatnote", ".metadata", "style", "script", ".mw-editsection",
            "#mw-navigation", ".noprint", ".portal", ".sistersitebox", "figure", "table"):
    ns = tree.css(sel)
    if ns:
        print(f"  {sel:<22} count={len(ns):<4} textlen={sum(len(n.text(strip=True)) for n in ns):,}")

print("\n--- headings")
for h in tree.css("h1,h2,h3,h4")[:20]:
    print(f"  <{h.tag}> {h.text(strip=True)[:80]}")

body = tree.css_first("body")
print(f"\nraw body text: {len(body.text(strip=True)):,} ({len(body.text(strip=True))/len(raw):.1%})")

# link shape
links = tree.css("a[href]")
print(f"\n--- {len(links):,} links; first 12 hrefs")
for l in links[:12]:
    print(f"  {l.attributes.get('href')}")
