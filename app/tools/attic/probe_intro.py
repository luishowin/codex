"""Find the selector that isolates a guide's Introduction prose."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from libzim.reader import Archive
from selectolax.lexbor import LexborHTMLParser

a = Archive(sys.argv[1])
target = "Guide/iPhone+12+Battery+Replacement/139393"
for cand in (target, "Guide/MacBook+Pro+Screen+Replacement/1"):
    if a.has_entry_by_path(cand):
        target = cand
        break
else:
    for i in range(a.all_entry_count):
        e = a._get_entry_by_id(i)
        if e.path.startswith("Guide/") and not e.is_redirect:
            if e.get_item().size > 200000:
                target = e.path
                break

print(f"=== {target}")
raw = bytes(a.get_entry_by_path(target).get_item().content).decode("utf-8", "replace")
tree = LexborHTMLParser(raw)

intro = tree.css_first("#guide-intro")
if intro is None:
    print("no #guide-intro")
    sys.exit(0)

print("--- direct children of #guide-intro")
for ch in intro.iter(include_text=False):
    t = ch.text(separator=" ", strip=True)
    print(f"  <{ch.tag}> id={ch.attributes.get('id')} "
          f"class={str(ch.attributes.get('class'))[:46]}  len={len(t)}")
    print(f"      {t[:110]!r}")

print("\n--- candidate intro-prose selectors")
for sel in (".guide-introduction", ".introduction", "#guide-introduction",
            ".guide-intro-text", ".wiki-text", ".guide-summary",
            "#guide-intro .prose", "#guide-intro p"):
    ns = tree.css(sel)
    if ns:
        joined = " ".join(n.text(separator=" ", strip=True) for n in ns)
        print(f"  {sel:<26} n={len(ns)} len={len(joined)}")
        print(f"      {joined[:200]!r}")

print("\n--- headings inside #guide-intro, with what follows")
for h in intro.css("h1,h2,h3"):
    nxt = h.next
    print(f"  <{h.tag}> {h.text(strip=True)[:40]!r} -> next=<{nxt.tag if nxt else None}> "
          f"{(nxt.text(separator=' ', strip=True)[:120] if nxt else '')!r}")
