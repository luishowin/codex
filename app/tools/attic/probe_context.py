"""Where does a guide record which device it belongs to?"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from libzim.reader import Archive
from selectolax.lexbor import LexborHTMLParser

a = Archive(sys.argv[1])
for target in ("Guide/Safety+Precautions/130143",
               "Guide/Battery+Disconnect/107830"):
    if not a.has_entry_by_path(target):
        print(f"missing {target}")
        continue
    raw = bytes(a.get_entry_by_path(target).get_item().content).decode("utf-8", "replace")
    tree = LexborHTMLParser(raw)
    print(f"\n=== {target}")
    t = tree.css_first("title")
    print(f"  <title>: {t.text() if t else None!r}")
    for sel in (".breadcrumbs", ".breadcrumb", "nav.breadcrumbs", "#breadcrumbs",
                ".guide-breadcrumbs", "[itemprop=breadcrumb]", ".chakra-breadcrumb",
                ".deviceTitle", ".guide-device", ".device-name"):
        for n in tree.css(sel):
            txt = " ".join(n.text(separator=" | ", strip=True).split())
            if txt:
                print(f"  {sel:<24} {txt[:130]!r}")
    print("  meta tags:")
    for m in tree.css("meta"):
        nm = m.attributes.get("property") or m.attributes.get("name") or ""
        if any(k in nm.lower() for k in ("title", "device", "og:")):
            print(f"    {nm} = {str(m.attributes.get('content'))[:100]!r}")
    # anchors that point at a Device page are the strongest signal
    devs = []
    for x in tree.css("a[href]"):
        h = x.attributes.get("href") or ""
        if "Device/" in h:
            d = h.split("Device/")[-1].split("#")[0]
            if d and d not in devs:
                devs.append(d)
    print(f"  Device/ links (first 6): {devs[:6]}")
