"""Third probe: find a content-rich guide and design extraction rules against it."""
import sys
from libzim.reader import Archive
from selectolax.lexbor import LexborHTMLParser

a = Archive(sys.argv[1])

# Find the biggest Guide page in a scan window -- the richest content we can find.
best = []
for i in range(0, min(a.all_entry_count, 120000)):
    e = a._get_entry_by_id(i)
    if e.is_redirect:
        continue
    p = e.path
    if not p.startswith("Guide/"):
        continue
    it = e.get_item()
    if it.mimetype.startswith("text/html"):
        best.append((it.size, p))
best.sort(reverse=True)
print(f"scanned window; found {len(best):,} guides. Top sizes:")
for s, p in best[:5]:
    print(f"  {s:>9,}  {p}")

for _, target in best[:1]:
    raw = bytes(a.get_entry_by_path(target).get_item().content).decode("utf-8", "replace")
    tree = LexborHTMLParser(raw)
    print(f"\n=== {target}\nraw={len(raw):,}")

    # Strip the obvious non-content furniture, then look at what remains.
    for sel in ("head", "script", "style", "noscript", "nav", "footer", "header",
                "#banner", ".comments", "#comments", ".chakra-modal__content",
                ".footer", "#footer", ".site-footer", ".navigation"):
        for n in tree.css(sel):
            n.decompose()

    body = tree.css_first("body")
    txt = body.text(separator="\n", strip=True) if body else ""
    print(f"after strip: text={len(txt):,} ({len(txt)/len(raw):.1%} of raw)")
    print("\n--- structural sections present")
    for sel in ("#guide-intro", ".guide-container", "#guide-steps", ".stepLine",
                ".step", ".guide-step", "#main", "#mainBody"):
        ns = tree.css(sel)
        if ns:
            print(f"  {sel:<20} count={len(ns):<4} textlen={sum(len(n.text(strip=True)) for n in ns):,}")

    print("\n--- headings")
    for h in tree.css("h1,h2,h3,h4")[:25]:
        cls = str(h.attributes.get("class"))[:30]
        print(f"  <{h.tag}> [{cls}] {h.text(strip=True)[:80]}")

    print("\n--- extracted text (first 2500)")
    print(txt[:2500])
