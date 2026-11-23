"""Read portable cassettes on demand, without retaining handles to removable media."""
from __future__ import annotations

import json
import re
import sqlite3
from contextlib import closing
from pathlib import Path

from .search import Searcher

IDENT = re.compile(r"[A-Za-z0-9_-]{1,100}\Z")


def manifests(root):
    """Discover relative book files. Ambiguous cassette identities cannot be mounted."""
    found = {}
    conflicts = set()
    for file in sorted(root.glob("*/cassette.json")):
        try:
            value = json.loads(file.read_text(encoding="utf8"))
            ident = value["id"]
            if value["version"] != 1 or not IDENT.fullmatch(ident) or ident == "shelf":
                continue
            books = {}
            for entry in value["books"]:
                key = entry["id"]
                rel = Path(entry["file"])
                path = (file.parent / rel).resolve()
                if (not IDENT.fullmatch(key) or key in books or rel.is_absolute()
                        or not path.is_relative_to(file.parent.resolve()) or not path.name.endswith(".codex.db")):
                    raise ValueError("invalid book")
                if path.is_file():
                    books[key] = path
            if ident in found:
                conflicts.add(ident)
            found[ident] = (str(value["title"]), books)
        except (OSError, ValueError, TypeError, KeyError):
            continue
    return {key: item for key, item in found.items() if key not in conflicts}


def describe(key, raw, count):
    return {"id": key, "title": raw.get("title") or key,
            "edition": f"{raw.get('built_at', '')}|{count}", "count": count,
            "date": raw.get("zim_date", ""), "source": raw.get("source_zim") or raw.get("source_dir", "")}


def descriptor(key, searcher):
    raw = dict(searcher.con.execute("SELECT key,value FROM codex_meta"))
    if raw.get("article_format", "1") not in {"1", "2"}:
        raise ValueError("unsupported article format")
    # New editions record their count so mounting large books stays inexpensive.
    count = int(raw["documents"]) if "documents" in raw else searcher.con.execute("SELECT count(*) FROM doc").fetchone()[0]
    return describe(key, raw, count)


def request(params, root, loaded, raw, meta):
    packs = manifests(root)
    pack, key = params.get("cassette"), params.get("book")
    legacy = {name: describe(name, raw[name], m["docs"]) for name, m in meta.items() if name in raw}
    if not pack:
        library = []
        for ident, (title, files) in packs.items():
            books = []
            for name, path in files.items():
                try:
                    with closing(Searcher(str(path))) as searcher:
                        books.append(descriptor(name, searcher))
                except (sqlite3.Error, OSError, ValueError):
                    continue
            library.append({"id": ident, "title": title, "books": books})
        if legacy:
            library.append({"id": "shelf", "title": "Reference shelf", "books": list(legacy.values())})
        return {"cassettes": library}, 200
    if pack == "shelf" and key in legacy:
        path = loaded[key].core_path
    else:
        path = packs.get(pack, ("", {}))[1].get(key)
    if path is None:
        return {"error": "This book is currently unavailable."}, 404
    try:
        with closing(Searcher(str(path))) as s:
            info = legacy[key] if pack == "shelf" else descriptor(key, s)
            if params.get("edition") != info["edition"]:
                return {"error": "This location belongs to another edition."}, 409
            if "path" in params:
                row = s.con.execute("SELECT id FROM doc WHERE path=?", (params["path"],)).fetchone()
                if row is None:
                    return {"error": "No entry in this edition"}, 404
                return s.get(row[0]), 200
            if params.get("q"):
                return {"items": s.search(params["q"], limit=80)}, 200
            if pack == "shelf" or "letter" in params:
                entries = s.browse(params.get("letter", "A"), limit=100, after=params.get("after", ""))
            else:
                # The specimen's editorial sequence is its insertion order.
                start = int(params.get("start", 0))
                entries = [dict(r) for r in s.con.execute(
                    "SELECT path,title,lead AS snippet FROM doc ORDER BY id LIMIT 100 OFFSET ?", (start,))]
            return {"items": entries}, 200
    except (sqlite3.Error, OSError, ValueError):
        return {"error": "This book could not be read."}, 400
