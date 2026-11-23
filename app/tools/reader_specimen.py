"""Cut the two-book review cassette from explicitly selected sources."""
from __future__ import annotations

import argparse
from contextlib import closing
import hashlib
import json
import sqlite3
import sys
import tempfile
import zlib
from pathlib import Path
from urllib.parse import unquote, urlsplit

from rebuild_deep import main as build_deep
from libzim.reader import Archive
from selectolax.lexbor import LexborHTMLParser

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from codex.adapters import WikipediaAdapter
from codex.model import block_text as plain
from codex.schema import CORE_SQL, CORE_INDEXES, FTS_QUICK_SQL

# Transcribed in the order of the index under review. Paths retain source identity.
ENTRIES = {
    "A_29-Cent_Robbery": "American silent short film released in 1910.",
    "A_2nd_Hand_Lover": "Kannada-language romance film directed by Raghav Marasur.",
    "A_2Pac_Tribute:_Dare_2_Struggle": "Tribute album dedicated to Tupac Shakur.",
    "A_3_Minute_Hug": "Documentary directed by Everardo González.",
    "A_4_App": "Live album by Anastacia.",
    "A_44-Calibre_Mystery": "Silent Western film featuring Harry Carey.",
    "A_50_Singles:_Live_Selection": "Live concert DVD by Ayumi Hamasaki.",
    "A_5120": "East German office computer produced by Robotron from 1982.",
    "A_A_Dhand": "British crime writer whose novels are set in Bradford.",
    "A_Aa": "Telugu-language romantic comedy directed by Trivikram Srinivas.",
    "A_Aa_E_Ee": "Indic vowel sounds and a guide to films sharing the name.",
    "A_Aa_E_Ee_(2009_Tamil_film)": "Tamil-language romantic drama directed by Sabapathy Dekshinamurthy.",
    "A_Aa_E_Ee_(2009_Telugu_film)": "Telugu-language film directed by Srinivasa Reddy.",
    "A_Aa_(soundtrack)": "Soundtrack to the 2016 film A Aa.",
    "A_Alao": "Village in Nong District, Savannakhet Province, Laos.",
    "A_Album": "Debut album by the Japanese group KinKi Kids.",
    "A_(cuneiform)": "A cuneiform sign used in Akkadian writing.",
    "Kelvin": "The SI unit of thermodynamic temperature.",
    "Impossible_trident": "An impossible object that appears to have both two and three prongs.",
}

TAGS = set("p h2 h3 h4 h5 h6 ul ol li table caption thead tbody tfoot tr th td em i b strong sup sub blockquote br code pre dl dt dd a cite".split())
JUNK = ("script, style, nav, .navbox, .side-box, .sidebar, .metadata, .ambox, "
        ".gallery, .mw-editsection, .mw-cite-backlink, .noprint, .hatnote, "
        ".shortdescription, .mw-empty-elt, .sistersitebox, .authority-control, "
        ".catlinks, .navbar, figure, .thumb, .mw-references-columns .reflist-talk")


def nodes(element, link_paths):
    """Encode only text and book semantics. No source CSS, script or arbitrary attributes."""
    for n in element.iter(include_text=True):
        tag = n.tag
        if tag == "-text":
            yield n.text()
            continue
        if tag.startswith("-"):
            continue
        children = list(nodes(n, link_paths))
        attrs = n.attributes
        if tag not in TAGS:
            yield from children
            continue
        item = {"tag": tag, "children": children}
        if attrs.get("id"):
            item["anchor"] = attrs["id"]
        if tag == "a":
            href = attrs.get("href") or ""
            if href.startswith("#") and len(href) > 1:
                item["ref"] = unquote(href[1:])
            elif urlsplit(href).scheme in ("http", "https"):
                item["url"] = href
            elif href and not href.startswith(("/", "#")):
                item["path"] = unquote(href.partition("#")[0]).removeprefix("./")
        if tag == "a" and item.get("path") and link_paths is not None and item["path"] not in link_paths:
            yield from children
            continue
        for key in ("rowspan", "colspan"):
            if tag in ("th", "td") and (attrs.get(key) or "").isdigit():
                item[key] = int(attrs[key])
        yield item


def article(raw, selector, link_paths=None):
    dom = LexborHTMLParser(raw)
    root = dom.css_first(selector)
    if root is None:
        raise ValueError(f"missing source content {selector}")
    # Keep one exact representation of each formula. The fallback image,
    # hidden MathML and annotation otherwise repeat the same expression.
    WikipediaAdapter._mathml_to_latex(root)
    for n in root.css(JUNK):
        n.decompose()
    # Suppress layout tables, keep real data tables and fact boxes.
    for table in root.css("table"):
        if selector != "article" and not ({"wikitable", "infobox", "tracklist"} & set((table.attributes.get("class") or "").split())):
            table.decompose()
    for slot in root.css('p span[typeof="mw:File"]'):
        if not slot.text(strip=True) and slot.css_first("img") is None:
            slot.replace_with("[illustration unavailable]")
    for n in root.css("img"):
        # Mathematical notation may be carried by the image alternative.
        alt = n.attributes.get("alt") or ""
        if alt.strip():
            n.replace_with(alt)
    blocks = [v for v in nodes(root, link_paths) if isinstance(v, dict)]
    # A fact box can be long. Give the opening prose first place in the reader.
    first_p = next((i for i, b in enumerate(blocks) if b["tag"] == "p" and plain(b).strip()), None)
    if first_p is not None and first_p > 0 and all(b["tag"] == "table" for b in blocks[:first_p]):
        end = first_p
        while end < len(blocks) and blocks[end]["tag"] == "p":
            end += 1
        blocks = blocks[first_p:end] + blocks[:first_p] + blocks[end:]
    # A gallery heading can survive the pictures it introduced. Drop empty
    # sections from the end backwards so consecutive empty headings disappear.
    kept = []
    for block in reversed(blocks):
        if not plain(block).strip():
            continue
        if block["tag"] in {"h2", "h3", "h4", "h5", "h6"} and (
                not kept or (kept[-1]["tag"] in {"h2", "h3", "h4", "h5", "h6"}
                             and kept[-1]["tag"] <= block["tag"])):
            continue
        kept.append(block)
    return list(reversed(kept))


def book(folder, slug, title, source, date, rows):
    path = folder / (slug + ".codex.db")
    with closing(sqlite3.connect(path)) as con, con:
        con.executescript(CORE_SQL + CORE_INDEXES + FTS_QUICK_SQL)
        digest = hashlib.sha256(json.dumps([title, source, date]).encode())
        for i, (key, heading, desc, blocks, credit) in enumerate(rows, 1):
            body = json.dumps([{"k": "rich", "blocks": blocks}], ensure_ascii=False, separators=(",", ":")).encode()
            digest.update(json.dumps([key, heading, desc, credit], sort_keys=True).encode() + body)
            con.execute("INSERT INTO doc(id,path,title,lead,word_count,body,meta) VALUES(?,?,?,?,?,?,?)",
                        (i, key, heading, desc, len(" ".join(map(plain, blocks)).split()), zlib.compress(body), json.dumps(credit)))
        edition = digest.hexdigest()[:16]
        meta = {"title": title, "article_format": "2", "schema_version": "1", "body_codec": "zlib",
                "built_at": edition, "documents": str(len(rows)), "source_dir": source, "zim_date": date, "language": "eng"}
        con.executemany("INSERT INTO codex_meta VALUES(?,?)", meta.items())
        con.execute("INSERT INTO fts_quick(fts_quick) VALUES('rebuild')")
    return {"id": slug, "file": path.name}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("zim", type=Path)
    parser.add_argument("tea", type=Path)
    parser.add_argument("out", type=Path)
    args = parser.parse_args()
    archive = Archive(args.zim)
    rows = []
    for path, desc in ENTRIES.items():
        entry = archive.get_entry_by_path(path)
        raw = bytes(entry.get_item().content)
        heading = LexborHTMLParser(raw).css_first("h1").text(strip=False).strip()
        credit = {"source": "English Wikipedia contributors", "source_id": path, "url": "https://en.wikipedia.org/wiki/" + path,
                  "licence": "CC BY-SA 4.0", "licence_url": "https://creativecommons.org/licenses/by-sa/4.0/",
                  "image_note": path in {"A_(cuneiform)", "Impossible_trident"}}
        rows.append((path, heading, desc, article(raw, ".mw-parser-output", ENTRIES), credit))
    tea = article(args.tea.read_bytes(), "article", set())
    args.out.parent.mkdir(parents=True, exist_ok=True)
    if args.out.exists():
        parser.error("Choose a new output folder for this edition.")
    with tempfile.TemporaryDirectory(dir=args.out.parent) as temp:
        folder = Path(temp) / "cassette"
        folder.mkdir()
        wiki = book(folder, "wikipedia", "Wikipedia", args.zim.name, "June 2026 · Specimen", rows)
        sample = book(folder, "tea", "Reading specimens", args.tea.name, "Design specimen", [
            ("Tea", "Tea", "Leaves, brewing methods and the history of tea.", tea,
             {"source": "Supplied tea article, adapted from Grokipedia", "source_id": args.tea.name, "url": "https://grokipedia.com/page/Tea"})])
        for item in (wiki, sample):
            core = folder / item["file"]
            build_deep(str(core))
            deep = core.with_suffix("").with_suffix(".codex-deep.db")
            with closing(sqlite3.connect(deep)) as con:
                con.execute("PRAGMA journal_mode=DELETE")
        manifest = {"version": 1, "id": "reading-room", "title": "The reading room", "books": [wiki, sample]}
        (folder / "cassette.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf8")
        folder.rename(args.out)


if __name__ == "__main__":
    main()
