#!/usr/bin/env python3
"""Codex site server (stdlib only).

Serves this folder statically and adds a live full-text search over the real
corpus DBs. Nothing ever leaves the machine.

Usage:
    python3 serve.py [--port 8766] [--codex /path/to/codex-dir]

Endpoints:
    /                the site
    /api/health      {ok, corpora: N, docs: N}
    /api/corpora     corpora.json (generated from the DBs)
    /api/search?q=   FTS over title+lead across every *.codex.db
                     (optional &codex=NAME to restrict, &limit=N)
"""
import argparse
import glob
import json
import os
import re
import sqlite3
import time
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

DEFAULT_CODEX_DIR = "/run/media/luishowin/MX500/codex"
SITE_DIR = os.path.dirname(os.path.abspath(__file__))

MAX_RESULTS = 12
DB_TIMEOUT = 20.0  # seconds per codex, per request

def safe_query(q: str) -> str:
    """Strip FTS5 syntax characters from user input; allow '*' only as the
    trailing prefix marker (prefix-expand the last term, per the corpus docs)."""
    q = q.strip()
    if not q:
        return ""
    prefix = q.endswith("*")
    tokens = re.findall(r"[A-Za-z0-9'\-]+", q)
    if not tokens:
        return ""
    out = " ".join(tokens)
    if prefix:
        out += "*"
    return out

class Corpus:
    def __init__(self, codex_dir):
        self.dir = codex_dir
        self.dbs = sorted(glob.glob(os.path.join(codex_dir, "*.codex.db")))
        self.ready = bool(self.dbs)

    def names(self):
        return [os.path.basename(p).replace(".codex.db", "") for p in self.dbs]

    def search(self, q, codex=None, limit=MAX_RESULTS):
        fts = safe_query(q)
        if not fts:
            return None
        targets = [codex] if codex else self.names()
        results = []
        t0 = time.perf_counter()
        hit_codexes = set()
        for name in targets:
            path = os.path.join(self.dir, name + ".codex.db")
            if not os.path.exists(path):
                continue
            try:
                con = sqlite3.connect(f"file:{path}?mode=ro", uri=True, timeout=DB_TIMEOUT)
                try:
                    rows = con.execute(
                        "SELECT title, lead FROM fts_quick WHERE fts_quick MATCH ? "
                        "ORDER BY rank LIMIT ?",
                        (fts, max(limit, 3)),
                    ).fetchall()
                finally:
                    con.close()
            except sqlite3.OperationalError:
                continue  # DB busy (opened by the daemon): skip it
            for title, lead in rows:
                results.append({
                    "codex": name,
                    "title": title,
                    "lead": (lead or "").strip()[:220],
                })
                hit_codexes.add(name)
            if len(results) >= limit:
                break
        ms = (time.perf_counter() - t0) * 1000
        return {
            "q": q,
            "fts": fts,
            "ms": round(ms, 1),
            "codexes": len(hit_codexes),
            "results": results[:limit],
        }

class Handler(BaseHTTPRequestHandler):
    corpus = None  # set before serving

    def log_message(self, fmt, *args):  # quieter
        pass

    def _json(self, obj, code=200):
        body = json.dumps(obj, indent=1).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _static(self, path):
        if path in ("/", ""):
            path = "/index.html"
        fpath = os.path.normpath(os.path.join(SITE_DIR, path.lstrip("/")))
        if not fpath.startswith(SITE_DIR) or not os.path.isfile(fpath):
            self.send_error(404, "not found")
            return
        ctype = {
            ".html": "text/html; charset=utf-8",
            ".css": "text/css",
            ".js": "application/javascript",
            ".json": "application/json",
            ".woff2": "font/woff2",
            ".svg": "image/svg+xml",
        }.get(os.path.splitext(fpath)[1], "application/octet-stream")
        with open(fpath, "rb") as f:
            body = f.read()
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path, params = parsed.path, urllib.parse.parse_qs(parsed.query)

        if path == "/api/health":
            if not self.corpus.ready:
                self._json({"ok": False, "error": f"no *.codex.db under {self.corpus.dir}"}, 503)
            else:
                self._json({"ok": True, "corpora": len(self.corpus.dbs),
                            "codex_dir": self.corpus.dir})
            return

        if path == "/api/corpora":
            f = os.path.join(SITE_DIR, "corpora.json")
            if os.path.isfile(f):
                self._static("/corpora.json")
            else:
                self._json({"error": "corpora.json missing: run gen_codex_data.py"}, 503)
            return

        if path == "/api/search":
            if not self.corpus.ready:
                self._json({"ok": False, "error": f"no *.codex.db under {self.corpus.dir}"}, 503)
                return
            q = (params.get("q") or [""])[0]
            codex = (params.get("codex") or ["all"])[0]
            if codex == "all":
                codex = None
            out = self.corpus.search(q, codex=codex)
            if out is None:
                self._json({"ok": False, "error": "empty or unsafe query"}, 400)
                return
            out["ok"] = True
            self._json(out)
            return

        self._static(path)

def main():
    ap = argparse.ArgumentParser(description="Codex site + local search server")
    ap.add_argument("--port", type=int, default=8766)
    ap.add_argument("--codex", default=os.environ.get("CODEX_DIR", DEFAULT_CODEX_DIR))
    args = ap.parse_args()

    Handler.corpus = Corpus(args.codex)
    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    n = len(Handler.corpus.dbs)
    print(f"Codex site:  http://127.0.0.1:{args.port}/")
    print(f"Corpus:      {args.codex}  ({n} codexes)")
    if not n:
        print("WARNING: no *.codex.db found: search API will return 503.")
    print("Ctrl+C to stop.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nbye")

if __name__ == "__main__":
    main()