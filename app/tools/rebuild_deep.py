#!/usr/bin/env python3
"""Rebuild a codex's deep (full-body) FTS index from its existing core file.

Pass 3b is the only pass that reads nothing but the core database, so the deep
index can be regenerated on its own without re-extracting the archive -- which
matters when the archive took five hours and the index took forty minutes.

Builds alongside the live file and swaps only on success, so a failure leaves
the existing index untouched.

Usage: rebuild_deep.py <codex.db> [--keep-old]
"""
from __future__ import annotations

import os
import sqlite3
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from codex import index as I
from codex.build import log
from codex.schema import (BUILD_PRAGMAS, SCHEMA_VERSION, apply_pragmas,
                          init_deep, set_meta)


def human(n: float) -> str:
    for u in ("B", "KB", "MB", "GB", "TB"):
        if abs(n) < 1024:
            return f"{n:,.1f}{u}"
        n /= 1024
    return f"{n:,.1f}PB"


def main(core_path: str, keep_old: bool = False) -> int:
    core_p = Path(core_path)
    if not core_p.exists():
        print(f"no such codex: {core_p}", file=sys.stderr)
        return 2
    deep_p = core_p.with_name(core_p.name.replace(".codex.db", ".codex-deep.db"))
    new_p = deep_p.with_suffix(deep_p.suffix + ".new")
    old_p = deep_p.with_suffix(deep_p.suffix + ".old")

    core = sqlite3.connect(f"file:{core_p}?mode=ro", uri=True)
    n_docs = core.execute("SELECT COUNT(*) FROM doc").fetchone()[0]
    row = core.execute("SELECT dict FROM zdict WHERE id=1").fetchone()
    zdict_bytes = bytes(row[0]) if row else b""

    log(f"core     {core_p}  ({n_docs:,} docs)")
    log(f"deep     {deep_p}"
        f"{'  (' + human(deep_p.stat().st_size) + ')' if deep_p.exists() else '  (absent)'}")
    log(f"building {new_p}")
    if zdict_bytes:
        log(f"  using stored zstd dictionary ({len(zdict_bytes)/1024:,.0f} KB)")

    # Build beside the live file; a half-written index must never replace a
    # working one.
    new_p.unlink(missing_ok=True)
    deep = sqlite3.connect(str(new_p), isolation_level=None)
    apply_pragmas(deep, BUILD_PRAGMAS)
    init_deep(deep)
    t0 = time.perf_counter()
    try:
        I.build_deep(core, deep, zdict_bytes)
        set_meta(deep, table="deep_meta", schema_version=SCHEMA_VERSION,
                 core=core_p.name, docs=n_docs,
                 rebuilt_at=time.strftime("%Y-%m-%dT%H:%M:%S"))
        deep.execute("PRAGMA journal_mode=WAL")
    except BaseException:
        deep.close()
        new_p.unlink(missing_ok=True)
        raise
    deep.close()
    core.close()

    # Swap. Windows will not rename onto an existing file, so step through .old.
    old_p.unlink(missing_ok=True)
    if deep_p.exists():
        for suffix in ("-wal", "-shm"):
            Path(str(deep_p) + suffix).unlink(missing_ok=True)
        os.replace(deep_p, old_p)
    os.replace(new_p, deep_p)
    size = deep_p.stat().st_size
    if keep_old:
        log(f"  previous index kept at {old_p.name}")
    else:
        old_p.unlink(missing_ok=True)

    log(f"DONE  {human(size)} in {(time.perf_counter()-t0)/60:,.1f} min")
    return 0


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if not args:
        print(__doc__.strip(), file=sys.stderr)
        sys.exit(2)
    sys.exit(main(args[0], keep_old="--keep-old" in sys.argv))
