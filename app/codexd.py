#!/usr/bin/env python3
"""codexd - the warm search daemon.

Holds SQLite handles open so queries never pay connection or page-cache cost.
Everything else in the system is a client of this: the Windows hotkey launcher,
the browser UI, the Pi on the LAN, the TUI, and the MCP server.

    codexd.py [--codex PATH ...] [--port 8765] [--host 127.0.0.1]

Binds to loopback by default. Pass --host 0.0.0.0 to serve a Pi to the LAN --
there is no authentication, so only do that on a network you trust.
"""
from __future__ import annotations

import argparse
import glob
import json
import mimetypes
import socketserver
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

sys.path.insert(0, str(Path(__file__).resolve().parent))

from codex import cassette, merge, reader
from codex.art import ArtStore
from codex.paths import (art_db_path, codex_globs, data_dir, hidden_rolls,
                         shelf_path, source_weights)
from codex.search import Searcher

HERE = Path(__file__).resolve().parent
WEB = HERE / "web"

# Presentation only: what a codex's top-level containers should be called.
# A book for the manual and curriculum sources, a device for iFixit, a neutral
# word for anything that later turns out to have containers.
UNITS = {"milmed": "book", "libretexts": "book", "ifixit": "device"}

CODEXES: dict[str, Searcher] = {}
META: dict[str, dict] = {}
# codex_meta as stored, kept so a shelf manifest never has to re-read the file
# to learn what the daemon already read at load time.
RAW: dict[str, dict] = {}

# Rolls present on disk but deliberately not on the shelf (data/shelf.json).
# Reported by /api/health so "missing" and "hidden" are never confused.
HIDDEN: set[str] = set()

# /api/library assembled once, because summing word_count over 7M rows is not
# a per-request cost. Invalidated whenever a roll is loaded or unloaded.
LIBRARY: dict[bool, dict] = {}

# Human overrides for the cross-codex merge (data/shelf.json -> weights).
# Empty by default; the merge derives its own weights from specialisation.
WEIGHTS: dict[str, float] = {}

# The curated image layer, or None when art.db is absent. Every use is guarded;
# a missing file costs nothing but the pictures.
ART: ArtStore | None = None

# Long-lived so its threads keep their per-codex SQLite handles warm. A pool
# per request would pay thread creation on every keystroke, and throw away the
# connection each thread had just opened.
POOL = ThreadPoolExecutor(max_workers=16, thread_name_prefix="codex")


def _size(path) -> int:
    try:
        return Path(path).stat().st_size
    except OSError:
        return 0


def _load_one(path: str) -> str | None:
    """Load one .codex.db roll, at boot or at runtime. Returns its name.

    Reloading an already-loaded name closes the old handle first, so a
    rebuilt roll can be swapped in without restarting the projector.
    """
    if not path.endswith(".codex.db"):
        return None
    name = Path(path).name.replace(".codex.db", "")
    try:
        s = Searcher(path)
    except Exception as exc:
        print(f"  !! {name}: {exc}", file=sys.stderr)
        return None
    old = CODEXES.pop(name, None)
    if old is not None:
        try:
            old.close()
        except Exception:
            pass
    CODEXES[name] = s
    row = dict(s.con.execute("SELECT key, value FROM codex_meta").fetchall())
    n = s.con.execute("SELECT COUNT(*) FROM doc").fetchone()[0]
    words = s.con.execute("SELECT SUM(word_count) FROM doc").fetchone()[0]
    RAW[name] = row
    META[name] = {
        "name": name, "docs": n, "deep": s.has_deep,
        "title": row.get("title", name),
        "source": row.get("source_zim", "") or row.get("source_dir", ""),
        "date": row.get("zim_date", ""),
        "built": row.get("built_at", ""),
        "words": words or 0,
        "body_codec": row.get("body_codec", ""),
        "compress_level": (row.get("compress_level", "")
                           or row.get("zstd_level", "")),
        "schema": row.get("schema_version", ""),
        "adapter": row.get("adapter", ""),
        "language": row.get("language", ""),
        # Lets the UI show what the archive cost against what it came
        # from -- the single most telling number about a codex.
        "source_bytes": int(row.get("source_bytes") or 0),
        "core_bytes": _size(s.core_path),
        "deep_bytes": _size(s.deep_path) if s.deep_path else 0,
    }
    print(f"  loaded {name}: {n:,} docs, deep={s.has_deep}")
    return name


def discover(patterns: list[str], hidden: set[str] | None = None) -> list[str]:
    """Expand patterns to codex paths, minus rolls hidden from the shelf.

    An explicitly-passed ``--codex`` is never filtered: ``hidden`` is a
    default-shelf policy, not a security control. That also keeps the tests
    and one-off runs honest -- ask for ifixit, get ifixit.
    """
    hidden = hidden or set()
    found = []
    for pattern in patterns:
        for p in sorted(glob.glob(pattern)):
            name = Path(p).name
            if name.endswith(".codex.db") and name[:-len(".codex.db")] in hidden:
                continue
            found.append(p)
    return found


def load_codexes(paths: list[str], hidden: set[str] | None = None) -> None:
    for p in discover(paths, hidden):
        _load_one(p)


def library(all_rolls: bool = False) -> dict:
    """The shelf, cached.

    The shelf is what the projector is actually serving, so the default is the
    loaded set -- not every file on disk. ``?all=1`` adds the rest of the data
    directory, which is how a client can offer to insert a roll that is present
    but not playing.

    Words per roll is the expensive part, so the daemon's own load counts are
    handed over as a pre-filled cache; only rolls it never loaded are read, and
    only the first time ``?all=1`` is asked for.
    """
    if all_rolls not in LIBRARY:
        seed = {name: (RAW[name], META[name]["docs"], META[name]["words"])
                for name in META}
        LIBRARY[all_rolls] = cassette.build(
            data_dir(),
            Path(art_db_path()),
            only=None if all_rolls else set(META),
            max_hash=None,
            generated_by="codexd",
            generated_at=datetime.now(timezone.utc).isoformat(timespec="seconds"),
            summaries=seed,
        )
    return LIBRARY[all_rolls]


def _search_one(name: str, q: str, limit: int, deep: bool) -> dict:
    s = CODEXES[name]
    try:
        page = s.search_page(q, limit=limit, deep=deep)
    except Exception as exc:
        print(f"  !! search {name}: {exc}", file=sys.stderr)
        return {"hits": [], "total": 0, "capped": False, "codex": name,
                "docs": 0, "titles": 0}
    page["codex"] = name
    page["docs"] = META.get(name, {}).get("docs", 0)
    # Specialisation probe for the merge. Only asked when there is something
    # to rank: a codex with no hits contributes nothing to fuse.
    page["titles"] = s.title_matches(q) if page["hits"] else 0
    for h in page["hits"]:
        h["codex"] = name
    return page


def search_all(q: str, limit: int, deep: bool, only: str | None) -> dict:
    """Query every loaded codex, then fuse the pages (see codex/merge.py).

    Fanned out rather than looped. Each codex is an independent SQLite file and
    Searcher hands every thread its own connection, so there is nothing to
    serialise -- and a sequential loop would make each added source lengthen
    every query. One slow codex no longer delays the others, and no longer
    blocks unrelated clients the way the old global lock did.

    The merge is where the sources are made comparable: raw scores are ranked
    within one codex, so they are weighted by how specialised each codex is
    for this query and de-duplicated by title before the page is cut.
    """
    targets = [only] if only and only in CODEXES else list(CODEXES)
    if len(targets) == 1:
        pages = [_search_one(targets[0], q, limit, deep)]
    else:
        pages = list(POOL.map(lambda n: _search_one(n, q, limit, deep), targets))

    page = merge.merge(pages, limit, WEIGHTS)
    # After the merge and the truncation, so this costs one dict lookup per hit
    # actually being returned rather than per candidate considered.
    if ART is not None:
        ART.annotate(page["hits"])
    return page


def _browse_one(name: str, prefix: str, limit: int, after: str) -> list:
    try:
        hits = CODEXES[name].browse(prefix, limit=limit, after=after)
    except Exception as exc:
        print(f"  !! browse {name}: {exc}", file=sys.stderr)
        return []
    for h in hits:
        h["codex"] = name
    return hits


def browse_all(prefix: str, limit: int, after: str,
               only: str | None) -> dict:
    """Alphabetical browse across every loaded codex, merged by title."""
    targets = [only] if only and only in CODEXES else list(CODEXES)
    if len(targets) == 1:
        groups = [_browse_one(targets[0], prefix, limit, after)]
    else:
        groups = list(POOL.map(
            lambda n: _browse_one(n, prefix, limit, after), targets))
    hits = [h for g in groups for h in g]
    hits.sort(key=lambda h: (h["title"].lower(), h["title"]))
    return {"hits": hits[:limit], "prefix": prefix}


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *a):  # quiet by default
        pass

    def _send(self, code: int, body: bytes, ctype: str,
              cache: str = "no-store") -> None:
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", cache)
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionAbortedError):
            pass

    def _json(self, obj, code: int = 200) -> None:
        self._send(code, json.dumps(obj, ensure_ascii=False).encode("utf-8"),
                   "application/json; charset=utf-8")

    def do_GET(self) -> None:
        u = urlparse(self.path)
        qs = parse_qs(u.query)
        one = lambda k, d=None: (qs.get(k) or [d])[0]

        if u.path in ("/", "/index.html"):
            return self._static("index.html" if CODEXES else "reader/index.html")
        if u.path.startswith("/static/"):
            return self._static(u.path[len("/static/"):])
        # Permalink for one document. Serves the same UI shell; the client
        # reads ?codex=&id= on boot and opens the reader directly, so a
        # middle- or Ctrl-clicked hit lands on the article in a new tab.
        if u.path == "/read":
            return self._static("index.html")

        if u.path == "/reader":
            return self._static("reader/index.html")
        if u.path == "/api/reader":
            result, status = reader.request(
                {k: v[0] for k, v in qs.items()}, data_dir() / "cassettes", CODEXES, RAW, META)
            return self._json(result, status)

        if u.path == "/api/health":
            return self._json({"ok": True, "api": 1,
                               "codexes": list(META.values()),
                               "hidden": sorted(HIDDEN),
                               "shelf": str(shelf_path()),
                               "art": ART.stats() if ART else None})

        # The shelf: one manifest per roll, in the shape of SPEC.md section 3.
        # ``?all=1`` adds rolls that shelf policy keeps off the projector so a
        # client can offer to insert them; the default is what is served.
        if u.path == "/api/library":
            all_rolls = one("all") in ("1", "true", "yes")
            return self._json(library(all_rolls))

        # Image bytes. Content is immutable for a given slug -- a different
        # picture means a rebuilt art.db -- so unlike the API responses above
        # these are safe to cache hard.
        if u.path.startswith("/art/"):
            if ART is None:
                return self._json({"error": "no art.db loaded"}, 404)
            name = u.path[len("/art/"):]
            kind = "hero"
            if name.endswith(".thumb.webp"):
                kind, slug = "thumb", name[:-len(".thumb.webp")]
            elif name.endswith(".webp"):
                slug = name[:-len(".webp")]
            else:
                return self._json({"error": "not found"}, 404)
            body = ART.blob(slug, kind)
            if body is None:
                return self._json({"error": "not found"}, 404)
            return self._send(200, body, "image/webp",
                              cache="public, max-age=31536000, immutable")

        # Credit metadata for one document. Kept off /api/doc so the document
        # payload shape is unchanged; the reader fires this concurrently.
        if u.path == "/api/art":
            if ART is None:
                return self._json({"error": "no art.db loaded"}, 404)
            slug, name, doc_id = one("slug"), one("codex"), one("id")
            rec = (ART.by_slug(slug) if slug
                   else ART.for_doc(name, int(doc_id))
                   if name and doc_id and doc_id.isdigit() else None)
            if rec is None:
                return self._json({"error": "not found"}, 404)
            return self._json(rec)

        if u.path == "/api/search":
            q = one("q", "")
            if not q:
                return self._json({"hits": [], "ms": 0.0, "total": 0,
                                   "capped": False, "per_codex": {},
                                   "weights": {}, "q": ""})
            limit = max(1, min(int(one("n", "12")), 100))
            deep = one("deep", "0") in ("1", "true", "yes")
            t0 = time.perf_counter()
            page = search_all(q, limit, deep, one("codex"))
            page.update(ms=round((time.perf_counter() - t0) * 1000, 2),
                        deep=deep, q=q)
            return self._json(page)

        if u.path == "/api/browse":
            prefix = (one("prefix", "") or "")[:1].upper()
            if not prefix or (prefix != "#" and not "A" <= prefix <= "Z"):
                return self._json({"hits": [], "prefix": prefix})
            limit = max(1, min(int(one("n", "50") or 50), 200))
            page = browse_all(prefix, limit, one("after", "") or "",
                              one("codex"))
            return self._json(page)

        if u.path == "/api/index":
            name = one("codex", "")
            if name not in CODEXES:
                return self._json({"error": "unknown codex"}, 404)
            s = CODEXES[name]
            root = one("root", "") or ""
            if root:
                if not root.isdigit():
                    return self._json({"error": "root must be a document id"}, 400)
                page = s.children(int(root))
                if page is None:
                    return self._json({"error": "not found"}, 404)
                return self._json({"codex": name, **page})
            try:
                n = int(one("n", "500") or 500)
            except ValueError:
                n = 500
            page = s.contents((one("prefix", "") or "")[:1].upper() or None,
                              one("after", "") or "", max(1, min(n, 500)))
            page["unit"] = UNITS.get(META.get(name, {}).get("adapter", ""), "entry")
            return self._json({"codex": name, **page})

        if u.path == "/api/shelf":
            letter = (one("letter", "") or "")[:1].upper()
            if not letter or (letter != "#" and not "A" <= letter <= "Z"):
                return self._json({"letter": letter, "items": []})
            items = (ART.shelf(letter, set(CODEXES))
                     if ART is not None else [])
            return self._json({"letter": letter, "items": items})

        if u.path == "/api/doc":
            name, doc_id = one("codex"), one("id")
            if name not in CODEXES or not doc_id:
                return self._json({"error": "unknown codex or id"}, 404)
            s = CODEXES[name]
            doc = s.get(int(doc_id))
            if doc is None:
                return self._json({"error": "not found"}, 404)
            doc["related"] = s.related(int(doc_id))
            doc["codex"] = name
            return self._json(doc)

        return self._json({"error": "not found"}, 404)

    def do_POST(self) -> None:
        # Roll management: swap film while the projector runs. Same trust
        # model as the rest of the API (loopback by default, no auth) --
        # `path` may point at any readable .codex.db on the machine.
        u = urlparse(self.path)
        qs = parse_qs(u.query)
        one = lambda k, d=None: (qs.get(k) or [d])[0]

        if u.path == "/api/load":
            raw = one("path", "") or ""
            loaded = []
            for p in sorted(glob.glob(raw)):
                name = _load_one(p)
                if name is not None:
                    loaded.append(name)
            LIBRARY.clear()
            return self._json({"loaded": loaded,
                               "codexes": sorted(CODEXES)})

        if u.path == "/api/unload":
            name = one("codex", "") or ""
            s = CODEXES.pop(name, None)
            if s is None:
                return self._json({"error": "not loaded"}, 404)
            try:
                s.close()
            except Exception:
                pass
            META.pop(name, None)
            RAW.pop(name, None)
            LIBRARY.clear()
            return self._json({"unloaded": name,
                               "codexes": sorted(CODEXES)})

        return self._json({"error": "not found"}, 404)

    def _static(self, rel: str) -> None:
        target = (WEB / rel).resolve()
        # Never serve outside the web directory.
        if not str(target).startswith(str(WEB.resolve())) or not target.is_file():
            return self._json({"error": "not found"}, 404)
        ctype = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
        if ctype.startswith("text/") or ctype.endswith(("javascript", "json")):
            ctype += "; charset=utf-8"
        self._send(200, target.read_bytes(), ctype)


def main() -> int:
    p = argparse.ArgumentParser(prog="codexd")
    p.add_argument("--codex", action="append", default=[],
                   help="path or glob to a .codex.db (repeatable)")
    p.add_argument("--port", type=int, default=8765)
    p.add_argument("--host", default="127.0.0.1")
    p.add_argument("--art", default=None,
                   help="path to art.db; absent file simply disables images "
                        f"(default: {art_db_path()})")
    args = p.parse_args()

    patterns = args.codex or codex_globs()
    hidden = set() if args.codex else hidden_rolls()
    if args.art is None:
        args.art = str(art_db_path())
    global HIDDEN
    HIDDEN = hidden
    global WEIGHTS
    WEIGHTS = source_weights()
    if WEIGHTS:
        print(f"  merge weights: {', '.join(f'{k}={v:g}' for k, v in sorted(WEIGHTS.items()))}")
    print(f"codexd: loading from {patterns}")
    if hidden:
        print(f"  shelf: {len(hidden)} roll(s) on disk but not loaded: "
              f"{', '.join(sorted(hidden))}")
    load_codexes(patterns, hidden)
    if args.codex and not CODEXES:
        print("no requested codexes loaded", file=sys.stderr)
        return 1

    global ART
    ART = ArtStore.open_if_present(args.art)
    if ART is None:
        print(f"  no art.db at {args.art} (images disabled)")
    else:
        st = ART.stats()
        print(f"  loaded art: {st['images']} images, {st['bindings']} bindings, "
              f"{st['file_bytes'] / 1048576:.1f} MB")

    socketserver.TCPServer.allow_reuse_address = True
    srv = ThreadingHTTPServer((args.host, args.port), Handler)
    srv.daemon_threads = True
    total = sum(m["docs"] for m in META.values())
    print(f"codexd: {len(CODEXES)} codex(es), {total:,} documents")
    print(f"codexd: http://{args.host}:{args.port}/")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\ncodexd: stopping")
    return 0


if __name__ == "__main__":
    sys.exit(main())
