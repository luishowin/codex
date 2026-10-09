#!/usr/bin/env python3
"""codexctl - build and inspect codex archives.

    codexctl build  <source.zim|source-dir> [--out DIR] [--name NAME] [--workers N]
    codexctl info   <codex.db>
    codexctl search <codex.db> <query> [--deep] [-n N]
"""
from __future__ import annotations

import argparse
import multiprocessing as mp
import os
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from libzim.reader import Archive

from codex import build as B
from codex.ingest import pick_ingester
from codex.paths import data_dir
from codex.schema import (BUILD_PRAGMAS, SCHEMA_VERSION,
                          apply_pragmas, get_meta, init_core, set_meta)
import sqlite3


def human(n: float) -> str:
    for u in ("B", "KB", "MB", "GB", "TB"):
        if abs(n) < 1024:
            return f"{n:,.1f}{u}"
        n /= 1024
    return f"{n:,.1f}PB"


def cmd_build(args) -> int:
    src = Path(args.source)
    if not src.exists():
        print(f"no such source: {src}", file=sys.stderr)
        return 2
    if src.is_dir():
        return cmd_build_stream(args)

    name = args.name or src.stem
    paths = B.plan_paths(args.out, name, args.scratch)
    workers = args.workers or max(1, (os.cpu_count() or 4) - 2)
    level = (args.compress_level if args.compress_level is not None
             else B.ZLIB_LEVEL)

    a = Archive(str(src))
    meta = B.archive_meta(a)
    n_entries = a.all_entry_count
    adapter = B.pick_adapter(meta)

    B.log(f"source   {src.name}  ({human(src.stat().st_size)})")
    B.log(f"entries  {n_entries:,}   adapter {adapter.name}   workers {workers}"
          f"   zlib {level}")
    B.log(f"core     {paths.core}")
    B.log(f"deep     {paths.deep}")
    B.log(f"scratch  {paths.workdir}")

    fresh = not paths.core.exists()
    if fresh and not args.no_preflight:
        est = B.preflight(str(src), n_entries, paths, level=level)
        short = [f"{p} needs {B._gb(need)} but has {B._gb(free)} free"
                 for p, need, free in (
                     (paths.core.parent, est.get("need_out", 0), est.get("free_out", 1)),
                     (paths.workdir, est.get("need_work", 0), est.get("free_work", 1)))
                 if need > free]
        if short:
            for msg in short:
                print(f"preflight: {msg}", file=sys.stderr)
            print("This build would run out of disk part way through. Free space, "
                  "move --out/--scratch, or pass --no-preflight to proceed anyway.",
                  file=sys.stderr)
            return 2

    con = sqlite3.connect(str(paths.core), isolation_level=None)
    apply_pragmas(con, BUILD_PRAGMAS)
    init_core(con)

    state = get_meta(con)
    resume_entry = int(state.get("resume_entry", "0") or 0)

    set_meta(con,
             schema_version=SCHEMA_VERSION,
             source_zim=src.name,
             source_uuid=str(a.uuid),
             source_bytes=src.stat().st_size,
             adapter=adapter.name,
             title=meta.get("Title", ""),
             language=meta.get("Language", ""),
             zim_date=meta.get("Date", ""),
             body_codec="zlib",
             compress_level=level,
             built_by="codexctl")

    # --- pass 1: extract
    if resume_entry >= n_entries and not fresh:
        B.log(f"pass 1: already complete ({resume_entry:,} entries), skipping")
    else:
        B.extract_pass(con, str(src), n_entries, workers, paths.edges,
                       resume_from=resume_entry, level=level)

    n_docs = con.execute("SELECT COUNT(*) FROM doc").fetchone()[0]
    if n_docs == 0:
        B.log("no documents extracted - aborting")
        return 1

    n_docs = B.finish_build(con, paths, state=state, no_deep=args.no_deep,
                            force_graph=args.force_graph)
    if n_docs == 0:
        B.log("no documents extracted - aborting")
        return 1

    core_sz = paths.core.stat().st_size
    deep_sz = paths.deep.stat().st_size if paths.deep.exists() else 0
    total = core_sz + deep_sz
    src_sz = src.stat().st_size
    B.log("")
    B.log(f"DONE  {n_docs:,} documents")
    B.log(f"  core   {human(core_sz)}")
    B.log(f"  deep   {human(deep_sz)}")
    B.log(f"  total  {human(total)}  vs  {human(src_sz)} source  "
          f"=  {src_sz/max(total,1):.1f}x smaller")
    return 0


def cmd_build_stream(args) -> int:
    """Build from a directory (markdown ingester) through the funnel."""
    src = Path(args.source)
    name = args.name or src.name
    paths = B.plan_paths(args.out, name, args.scratch)
    level = (args.compress_level if args.compress_level is not None
             else B.ZLIB_LEVEL)
    ingester = pick_ingester(str(src))
    src_bytes = sum(p.stat().st_size for p in src.rglob("*") if p.is_file())

    B.log(f"source   {src}  ({ingester.name}, {human(src_bytes)})")
    B.log(f"core     {paths.core}")
    B.log(f"deep     {paths.deep}")
    B.log(f"scratch  {paths.workdir}")

    n_docs = B.build_stream(
        paths, ingester, str(src),
        {"source_dir": src.name, "source_bytes": src_bytes,
         "title": name, "language": ""},
        level=level, no_deep=args.no_deep)
    if n_docs == 0:
        B.log("no documents extracted - aborting")
        return 1

    core_sz = paths.core.stat().st_size
    deep_sz = paths.deep.stat().st_size if paths.deep.exists() else 0
    total = core_sz + deep_sz
    B.log("")
    B.log(f"DONE  {n_docs:,} documents")
    B.log(f"  core   {human(core_sz)}")
    B.log(f"  deep   {human(deep_sz)}")
    B.log(f"  total  {human(total)}  vs  {human(src_bytes)} source  "
          f"=  {src_bytes/max(total,1):.1f}x smaller")
    return 0


def cmd_info(args) -> int:
    con = sqlite3.connect(f"file:{args.codex}?mode=ro", uri=True)
    meta = get_meta(con)
    print(f"=== {args.codex}")
    for k in sorted(meta):
        print(f"  {k:<18} {meta[k]}")
    n, words, imp = con.execute(
        "SELECT COUNT(*), COALESCE(SUM(word_count),0), COALESCE(AVG(importance),0) "
        "FROM doc").fetchone()
    print(f"\n  documents          {n:,}")
    print(f"  total words        {words:,}")
    print(f"  mean importance    {imp:.4f}")
    print(f"  redirects          "
          f"{con.execute('SELECT COUNT(*) FROM redirect').fetchone()[0]:,}")
    print(f"  related rows       "
          f"{con.execute('SELECT COUNT(*) FROM related').fetchone()[0]:,}")
    print(f"  context labels     "
          f"{con.execute('SELECT COUNT(context_id) FROM doc').fetchone()[0]:,}")
    dep = con.execute("SELECT COUNT(*) FROM doc WHERE flags & 1").fetchone()[0]
    print(f"  image-dependent    {dep:,} ({dep/max(n,1):.1%}) "
          f"- text that still leans on a picture we do not carry")

    core = Path(args.codex)
    print("\n  files")
    for label, suffix in (("core", ".codex.db"), ("deep", ".codex-deep.db")):
        p = core.with_name(core.name.replace(".codex.db", suffix))
        print(f"    {label:<6} {human(p.stat().st_size) if p.exists() else '-':>10}"
              f"  {p.name if p.exists() else 'not built'}")
    print("\n  top 15 by importance")
    for t, imp, deg in con.execute(
            "SELECT title, importance, in_degree FROM doc "
            "ORDER BY importance DESC LIMIT 15"):
        print(f"    {imp:.4f}  in={deg:<7,} {t[:60]}")
    return 0


def cmd_search(args) -> int:
    from codex.search import Searcher
    s = Searcher(args.codex)
    t0 = time.perf_counter()
    hits = s.search(args.query, limit=args.n, deep=args.deep)
    dt = (time.perf_counter() - t0) * 1000
    print(f"{len(hits)} hits in {dt:.1f} ms "
          f"({'deep' if args.deep else 'quick'})\n")
    for h in hits:
        print(f"  [{h['score']:6.2f}] {h['title']}")
        if h.get("snippet"):
            print(f"           {h['snippet'][:150]}")
    return 0


def main() -> int:
    p = argparse.ArgumentParser(prog="codexctl")
    sub = p.add_subparsers(dest="cmd", required=True)

    b = sub.add_parser("build", help="build a codex from a ZIM archive "
                                             "or a source directory")
    b.add_argument("source")
    b.add_argument("--out", default=str(data_dir()))
    b.add_argument("--name", default=None)
    b.add_argument("--workers", type=int, default=None)
    b.add_argument("--scratch", default=None,
                   help="directory for the transient edge file (keep off the "
                        "volume holding the source archive)")
    b.add_argument("--no-deep", action="store_true")
    b.add_argument("--force-graph", action="store_true")
    b.add_argument("--compress-level", type=int, default=None,
                   help=f"zlib body compression level (default {B.ZLIB_LEVEL})")
    b.add_argument("--no-preflight", action="store_true",
                   help="skip the sampled size projection and free-space check")
    b.set_defaults(fn=cmd_build)

    i = sub.add_parser("info", help="describe a codex")
    i.add_argument("codex")
    i.set_defaults(fn=cmd_info)

    s = sub.add_parser("search", help="query a codex")
    s.add_argument("codex")
    s.add_argument("query")
    s.add_argument("-n", type=int, default=10)
    s.add_argument("--deep", action="store_true")
    s.set_defaults(fn=cmd_search)

    args = p.parse_args()
    return args.fn(args)


if __name__ == "__main__":
    mp.freeze_support()
    sys.exit(main())
