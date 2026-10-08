#!/usr/bin/env python3
"""Codex site data generator: reads the real corpus DBs (read-only) and
emits site/corpora.json plus captured demo-query outputs for the terminal demo."""
import glob
import json
import os
import sqlite3
import time

CODEX_DIR = "/run/media/luishowin/MX500/codex"
OUT = "/home/luishowin/Desktop/codex-site"

DEMO_QUERIES = [
    ("ifixit", "soldering"),
    ("mdn", "javascript promise"),
    ("wikipedia-medicine", "acetaminophen"),
    ("nhs-medicines", "ibuprofen"),
    ("military-medicine", "tourniquet"),
    ("ready-gov", "hurricane evacuation kit"),
]


def human(n):
    if n >= 1_000_000_000:
        return f"{n/1_000_000_000:.2f} B"
    if n >= 1_000_000:
        return f"{n/1_000_000:.1f} M"
    if n >= 1_000:
        return f"{n/1_000:.0f} k"
    return str(n)


def db_stats(path):
    con = sqlite3.connect(f"file:{path}?mode=ro", uri=True, timeout=30)
    try:
        meta = dict(con.execute("SELECT key, value FROM codex_meta"))
        n_docs = con.execute("SELECT COUNT(*) FROM doc").fetchone()[0]
        n_words = con.execute("SELECT COALESCE(SUM(word_count),0) FROM doc").fetchone()[0]
        n_leads = con.execute(
            "SELECT COUNT(*) FROM doc WHERE lead IS NULL OR lead=''").fetchone()[0]
        return meta, n_docs, n_words, n_leads
    finally:
        con.close()


def run_query(dbname, q):
    path = os.path.join(CODEX_DIR, f"{dbname}.codex.db")
    con = sqlite3.connect(f"file:{path}?mode=ro", uri=True, timeout=30)
    try:
        t0 = time.perf_counter()
        rows = con.execute(
            "SELECT title, lead FROM fts_quick WHERE fts_quick MATCH ? ORDER BY rank LIMIT 3",
            (q,),
        ).fetchall()
        ms = (time.perf_counter() - t0) * 1000
        return [{"title": r[0], "lead": (r[1] or "")[:140]} for r in rows], ms
    finally:
        con.close()


def main():
    corpora = []
    totals = {"docs": 0, "words": 0, "bytes": 0}
    for path in sorted(glob.glob(os.path.join(CODEX_DIR, "*.codex.db"))):
        name = os.path.basename(path).replace(".codex.db", "")
        t0 = time.time()
        try:
            meta, n_docs, n_words, n_leads = db_stats(path)
        except Exception as e:
            print(f"  SKIP {name}: {e}")
            continue
        deep = path.replace(".codex.db", ".codex-deep.db")
        size = os.path.getsize(path) + (os.path.getsize(deep) if os.path.exists(deep) else 0)
        corpora.append({
            "name": name,
            "title": meta.get("title", name),
            "adapter": meta.get("adapter", "generic"),
            "zim": meta.get("source_zim", ""),
            "docs": n_docs,
            "words": n_words,
            "leads_missing": n_leads,
            "bytes": size,
        })
        totals["docs"] += n_docs
        totals["words"] += n_words
        totals["bytes"] += size
        print(f"  {name:22s} {n_docs:>11,} docs  {size/1e9:6.2f} GB  ({time.time()-t0:4.1f}s)")

    # art.db
    art_path = os.path.join(CODEX_DIR, "art.db")
    art = {"name": "art", "docs": 0, "bytes": os.path.getsize(art_path)}
    try:
        con = sqlite3.connect(f"file:{art_path}?mode=ro", uri=True)
        art["docs"] = con.execute("SELECT COUNT(*) FROM art").fetchone()[0]
        con.close()
    except Exception as e:
        print(f"  SKIP art.db: {e}")
    totals["bytes"] += art["bytes"]

    # demo queries
    demos = {}
    for dbname, q in DEMO_QUERIES:
        try:
            results, ms = run_query(dbname, q)
            demos[q] = {"codex": dbname, "ms": round(ms, 1), "rows": results}
            print(f"  Q: {q!r:38s} -> {len(results)} rows in {ms:6.1f} ms")
        except Exception as e:
            print(f"  Q {q!r} FAILED: {e}")

    payload = {
        "generated": time.strftime("%Y-%m-%d %H:%M"),
        "corpus_dir": CODEX_DIR,
        "totals": totals,
        "corpora": sorted(corpora, key=lambda c: -c["docs"]),
        "art": art,
        "demos": demos,
    }
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, "corpora.json"), "w") as f:
        json.dump(payload, f, indent=1)
    print(f"\nTotals: {totals['docs']:,} docs, {human(totals['words'])} words, "
          f"{totals['bytes']/1e9:.1f} GB")
    print(f"Wrote {os.path.join(OUT, 'corpora.json')}")


if __name__ == "__main__":
    main()