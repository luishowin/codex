#!/usr/bin/env python
"""Phase 2 and 3: fetch the approved manifest, encode it, build art.db.

    .venv/Scripts/python.exe tools/art_build.py
    .venv/Scripts/python.exe tools/art_build.py --report      # inspect only

Downloads are cached under <root>/_work/art_cache, so a rerun after editing
the manifest re-encodes from disk and touches the network only for images it has
not seen. The cache is the expensive thing here -- ~100 serial requests against a
rate limiter -- and throwing it away to change a JPEG quality setting would be
absurd.

Everything the daemon needs ends up in a single detachable file. It is never
ATTACHed to a Searcher connection and `codex/search.py` is not involved: the
binding table is a few hundred rows and the daemon holds it in a dict, so no
pinned query plan changes and no built codex needs migrating.
"""
from __future__ import annotations

import argparse
import io
import json
import sqlite3
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

from PIL import Image

import art_commons as ac

from codex.paths import data_dir, work_dir

MANIFEST = str(work_dir() / "art_manifest.json")
CACHE = work_dir() / "art_cache"
OUT = str(data_dir() / "art.db")
SHEET = str(work_dir() / "art_contact_sheet.html")

HERO_EDGE, HERO_Q = 1600, 82
THUMB_EDGE, THUMB_Q = 400, 70
MAX_HERO_BYTES = 500 * 1024
TOTAL_BUDGET_MB = 100

# Quality first, then size. Measured on real 1600px fetches, q82 lands at
# 134-345 KB for 2.4-2.8 MP, so the ladder below is a guard rail rather than a
# routine path -- but the 500 KB cap is an invariant, not an aspiration.
LADDER = ((1600, 82), (1600, 76), (1600, 70), (1400, 76), (1200, 76), (1000, 72))

BUILD_STATUSES = ("ok", "review", "flagged")

SCHEMA = """
CREATE TABLE IF NOT EXISTS art (
    id          INTEGER PRIMARY KEY,
    slug        TEXT NOT NULL UNIQUE,   -- 'gram-negative-bacteria'
    subject     TEXT NOT NULL,          -- 'Gram-negative bacteria'
    discipline  TEXT NOT NULL,
    width       INTEGER NOT NULL,
    height      INTEGER NOT NULL,
    hero        BLOB NOT NULL,          -- WebP, long edge 1600
    thumb       BLOB NOT NULL,          -- WebP, long edge 400
    -- Upstream format, kept so the resolution floor stays auditable: SVG is
    -- exempt from it (vector rasterises crisply at any width, so the pixel
    -- count of one render says nothing), and without this column a small SVG
    -- and a small photograph are indistinguishable after encoding.
    source_mime TEXT NOT NULL DEFAULT '',
    -- Credit is not decoration. Everything here is CC BY / CC BY-SA / PD, and
    -- the BY licences require visible attribution wherever the image is shown,
    -- which is why the reader renders these and why they are NOT NULL.
    artist      TEXT NOT NULL,
    credit      TEXT,
    licence     TEXT NOT NULL,
    licence_url TEXT,
    source_file TEXT NOT NULL,
    source_url  TEXT NOT NULL,
    description TEXT,
    fetched_at  TEXT NOT NULL
);

-- One image, many documents. `Bacteria` is a document in wikipedia,
-- wikipedia-medicine and medlineplus; storing the picture once and binding it
-- three times is the whole reason this file is shared rather than per-codex.
CREATE TABLE IF NOT EXISTS binding (
    codex  TEXT    NOT NULL,
    doc_id INTEGER NOT NULL,
    art_id INTEGER NOT NULL REFERENCES art(id),
    PRIMARY KEY (codex, doc_id)
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS idx_binding_art ON binding(art_id);

CREATE TABLE IF NOT EXISTS art_meta (key TEXT PRIMARY KEY, value TEXT);
"""


def cache_path(entry: dict) -> Path:
    ext = {"image/jpeg": ".jpg", "image/png": ".png", "image/svg+xml": ".png",
           "image/webp": ".webp", "image/gif": ".gif", "image/tiff": ".tif"}
    return CACHE / (entry["slug"] + ext.get(entry.get("mime", ""), ".bin"))


def fetch_all(entries: list[dict]) -> tuple[dict[str, Path], bool]:
    """(cached files by slug, whether the run was cut short by rate limiting)."""
    CACHE.mkdir(parents=True, exist_ok=True)
    got, n_new, blocked = {}, 0, False
    todo = [e for e in entries if not cache_path(e).exists()]
    if todo:
        print(f"fetching {len(todo)} images, {ac.MIN_INTERVAL:.0f}s apart "
              f"(~{len(todo) * ac.MIN_INTERVAL / 60:.0f} min) ...", flush=True)
    for e in entries:
        p = cache_path(e)
        if not p.exists():
            if blocked:
                continue
            try:
                body = ac.polite_get(e["thumb_url"])
            except ac.RateLimited as exc:
                print(f"\n  !! {exc}", file=sys.stderr, flush=True)
                blocked = True
                continue
            except ac.FetchError as exc:
                print(f"  !! {e['slug']}: {exc}", file=sys.stderr, flush=True)
                continue
            p.write_bytes(body)
            n_new += 1
            print(f"  {n_new:>3}/{len(todo)}  {e['slug']:<34} "
                  f"{len(body)/1024:>6.0f} KB", flush=True)
        got[e["slug"]] = p
    missing = len(entries) - len(got)
    if not todo:
        print(f"all {len(got)} images already cached")
    elif missing:
        print(f"\n  {len(got)} cached, {missing} still missing -- rerun to resume")
    return got, blocked


def encode(src: Path) -> tuple[bytes, bytes, int, int]:
    """(hero, thumb, width, height). Steps down until the hero fits the cap."""
    im = Image.open(src)
    if im.mode in ("RGBA", "LA", "P"):
        # WebP carries alpha, but a transparent PNG over the reader's dark theme
        # renders as a black-on-black diagram. Flatten onto white.
        flat = Image.new("RGB", im.size, (255, 255, 255))
        im = im.convert("RGBA")
        flat.paste(im, mask=im.split()[-1])
        im = flat
    else:
        im = im.convert("RGB")

    for edge, q in LADDER:
        work = im.copy()
        work.thumbnail((edge, edge), Image.LANCZOS)
        buf = io.BytesIO()
        work.save(buf, format="WEBP", quality=q, method=6)
        if buf.tell() <= MAX_HERO_BYTES:
            hero, w, h = buf.getvalue(), work.width, work.height
            break
    else:
        raise ValueError(f"{src.name}: cannot reach {MAX_HERO_BYTES} bytes")

    t = im.copy()
    t.thumbnail((THUMB_EDGE, THUMB_EDGE), Image.LANCZOS)
    tbuf = io.BytesIO()
    t.save(tbuf, format="WEBP", quality=THUMB_Q, method=6)
    return hero, tbuf.getvalue(), w, h


def build(entries: list[dict], files: dict[str, Path], out: str) -> None:
    Path(out).unlink(missing_ok=True)
    con = sqlite3.connect(out, isolation_level=None)
    con.executescript(SCHEMA)
    con.execute("BEGIN")
    skipped = []
    for e in entries:
        src = files.get(e["slug"])
        if src is None:
            skipped.append((e["slug"], "not fetched"))
            continue
        try:
            hero, thumb, w, h = encode(src)
        except Exception as exc:
            skipped.append((e["slug"], f"{type(exc).__name__}: {exc}"))
            continue
        cur = con.execute(
            "INSERT INTO art(slug, subject, discipline, width, height, hero, "
            "thumb, source_mime, artist, credit, licence, licence_url, "
            "source_file, source_url, description, fetched_at) "
            "VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (e["slug"], e["subject"], e["discipline"], w, h, hero, thumb,
             e.get("mime", ""), e.get("artist") or "Unknown", e.get("credit", ""),
             e.get("licence", ""), e.get("licence_url", ""),
             e.get("file", ""), e.get("source_url", ""),
             e.get("description", ""), time.strftime("%Y-%m-%dT%H:%M:%S")))
        art_id = cur.lastrowid
        con.executemany(
            "INSERT OR REPLACE INTO binding(codex, doc_id, art_id) VALUES(?,?,?)",
            [(b["codex"], b["doc_id"], art_id) for b in e.get("bindings", [])])
    con.execute(
        "INSERT INTO art_meta(key, value) VALUES('built_at', ?), "
        "('hero_edge', ?), ('hero_quality', ?), ('thumb_edge', ?), "
        "('max_hero_bytes', ?), ('builder', 'art_build')",
        (time.strftime("%Y-%m-%dT%H:%M:%S"), str(HERO_EDGE), str(HERO_Q),
         str(THUMB_EDGE), str(MAX_HERO_BYTES)))
    con.execute("COMMIT")
    con.execute("VACUUM")
    con.close()
    for slug, why in skipped:
        print(f"  !! skipped {slug}: {why}", file=sys.stderr)


def report(out: str) -> None:
    con = sqlite3.connect(f"file:{out}?mode=ro", uri=True)
    n, mb, max_kb, min_mp = con.execute(
        "SELECT COUNT(*), SUM(LENGTH(hero)+LENGTH(thumb))/1048576.0, "
        "MAX(LENGTH(hero))/1024.0, MIN(width*height)/1e6 FROM art").fetchone()
    print(f"\n{n} images   {mb:.1f} MB of {TOTAL_BUDGET_MB} MB budget   "
          f"largest hero {max_kb:.0f} KB   smallest {min_mp:.2f} MP")
    print(f"  file on disk: {Path(out).stat().st_size / 1048576:.1f} MB")
    print("\n  by licence")
    for lic, k in con.execute(
            "SELECT licence, COUNT(*) FROM art GROUP BY licence ORDER BY 2 DESC"):
        print(f"    {lic or '(none)':<28} {k}")
    print("\n  bindings by codex")
    for codex, k in con.execute(
            "SELECT codex, COUNT(*) FROM binding GROUP BY codex ORDER BY 2 DESC"):
        print(f"    {codex:<24} {k}")
    orphans = con.execute("SELECT COUNT(*) FROM binding b "
                          "LEFT JOIN art a ON a.id=b.art_id "
                          "WHERE a.id IS NULL").fetchone()[0]
    noart = con.execute("SELECT COUNT(*) FROM art a WHERE NOT EXISTS("
                        "SELECT 1 FROM binding b WHERE b.art_id=a.id)").fetchone()[0]
    print(f"\n  orphan bindings {orphans}   images bound to nothing {noart}")
    con.close()


def contact_sheet(out: str, path: str, manifest: dict) -> None:
    """A local, offline page for eyeballing what actually got stored.

    Filenames only go so far: `Cinchona alkaloids.svg` and a photograph of the
    tree are indistinguishable in a log line and obvious side by side.
    """
    import base64
    status = {e["slug"]: e["status"] for e in manifest["subjects"]}
    notes = {e["slug"]: "; ".join(e.get("notes", [])) for e in manifest["subjects"]}
    con = sqlite3.connect(f"file:{out}?mode=ro", uri=True)
    cards = []
    for slug, subject, disc, w, h, thumb, artist, lic, src in con.execute(
            "SELECT slug, subject, discipline, width, height, thumb, artist, "
            "licence, source_url FROM art ORDER BY discipline, slug"):
        b64 = base64.b64encode(thumb).decode()
        flag = status.get(slug, "?")
        cards.append(
            f'<figure class="{flag}"><img src="data:image/webp;base64,{b64}" '
            f'alt="{subject}" loading="lazy">'
            f'<figcaption><b>{subject}</b><span class="d">{disc}</span>'
            f'<span class="m">{w}&times;{h} &middot; {w*h/1e6:.1f} MP</span>'
            f'<span class="m">{artist[:44]} &middot; {lic}</span>'
            f'<span class="n">{notes.get(slug,"")[:150]}</span>'
            f'<a href="{src}">source</a></figcaption></figure>')
    con.close()
    Path(path).write_text(f"""<!doctype html><meta charset=utf-8>
<title>codex art contact sheet</title><style>
body{{background:#14161a;color:#e7e9ee;font:13px/1.45 system-ui,sans-serif;margin:24px}}
h1{{font-size:17px;font-weight:600}}
.grid{{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:18px}}
figure{{margin:0;background:#1c1f26;border:1px solid #2b2f38;border-radius:8px;overflow:hidden}}
figure.review{{border-color:#8a6d1f}} figure.flagged{{border-color:#7a3b3b}}
img{{width:100%;height:170px;object-fit:cover;display:block;background:#000}}
figcaption{{padding:9px 11px;display:flex;flex-direction:column;gap:2px}}
.d{{color:#7fd1b9;font-size:11px}} .m{{color:#98a0b0;font-size:11px}}
.n{{color:#c9a227;font-size:11px}} a{{color:#6aa9ff;font-size:11px}}
</style><h1>codex art &mdash; {len(cards)} images
<span style="color:#c9a227">(amber border = needs your eye)</span></h1>
<div class=grid>{''.join(cards)}</div>""", encoding="utf-8")
    print(f"  contact sheet: {path}")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--manifest", default=MANIFEST)
    ap.add_argument("--out", default=OUT)
    ap.add_argument("--report", action="store_true",
                    help="report on an existing art.db and exit")
    args = ap.parse_args()

    if args.report:
        report(args.out)
        return 0

    manifest = json.loads(Path(args.manifest).read_text(encoding="utf-8"))
    entries = [e for e in manifest["subjects"]
               if e.get("status") in BUILD_STATUSES and e.get("thumb_url")]
    dropped = len(manifest["subjects"]) - len(entries)
    print(f"{len(entries)} images to build ({dropped} dropped in the manifest)")

    files, blocked = fetch_all(entries)
    if not files:
        print("nothing to build", file=sys.stderr)
        return 1
    print(f"\nencoding {len(files)} images ...", flush=True)
    t0 = time.time()
    build(entries, files, args.out)
    print(f"  built {args.out} in {time.time() - t0:.1f}s")
    report(args.out)
    contact_sheet(args.out, SHEET, manifest)
    # Building from a partial cache is deliberately allowed -- a usable art.db
    # now beats no art.db until the cooldown expires -- but say so plainly.
    return 2 if blocked else 0


if __name__ == "__main__":
    raise SystemExit(main())
