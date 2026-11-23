"""Pass 3: build the search indexes.

Two indexes with different jobs:

  fts_quick  title + lead, external-content over `doc`. Small, and the only one
             the hotkey launcher touches. snippet()/highlight() work natively.
  fts_deep   full body text, contentless with detail=none. Roughly half the size
             of a positional index; snippets come from the decompressed body.
"""
from __future__ import annotations

import json
import time
import zlib

from .build import log
from .model import block_text

BATCH = 20_000


def build_quick(con) -> None:
    """Populate the external-content index from the doc table.

    An external-content table owns no copy of the text, so it cannot be filled
    with ordinary INSERT/DELETE: those try to reconcile against the content
    table and leave the index malformed. 'rebuild' is the supported way to
    regenerate it wholesale from `doc`.
    """
    log("pass 3a: building fts_quick (title + lead)")
    t0 = time.perf_counter()
    con.execute("INSERT INTO fts_quick(fts_quick) VALUES('rebuild')")
    con.execute("INSERT INTO fts_quick(fts_quick) VALUES('optimize')")
    n = con.execute("SELECT COUNT(*) FROM doc").fetchone()[0]
    log(f"  indexed {n:,} docs in {(time.perf_counter()-t0)/60:,.1f} min")


def build_deep(core_con, deep_con) -> None:
    """Populate the contentless full-body index.

    fts_deep lives in the deep file but its rowids are doc ids from the core
    file, which is what lets the two be queried together once ATTACHed.
    Bodies are zlib JSON (see SPEC); pre-2.0 zstd film must be transcoded
    before a rebuild.
    """
    log("pass 3b: building fts_deep (full body)")
    t0 = time.perf_counter()
    dec = zlib.decompress

    # Contentless tables reject plain DELETE for the same reason; 'delete-all'
    # is the supported reset.
    deep_con.execute("INSERT INTO fts_deep(fts_deep) VALUES('delete-all')")
    deep_con.execute("BEGIN")

    n = 0
    batch: list[tuple] = []
    cur = core_con.execute(
        "SELECT id, title, COALESCE(lead,''), body FROM doc ORDER BY id")
    for doc_id, title, lead, body in cur:
        text = _body_text(dec, body)
        full = f"{title}\n{lead}\n{text}" if text else f"{title}\n{lead}"
        batch.append((doc_id, full))
        if len(batch) >= BATCH:
            deep_con.executemany(
                "INSERT INTO fts_deep(rowid, text) VALUES(?,?)", batch)
            n += len(batch)
            batch = []
            if n % (BATCH * 10) == 0:
                log(f"  {n:,} docs indexed")
    if batch:
        deep_con.executemany("INSERT INTO fts_deep(rowid, text) VALUES(?,?)", batch)
        n += len(batch)
    deep_con.execute("COMMIT")

    log("  optimizing fts_deep")
    deep_con.execute("INSERT INTO fts_deep(fts_deep) VALUES('optimize')")
    log(f"  indexed {n:,} docs in {(time.perf_counter()-t0)/60:,.1f} min")


def _body_text(dec, body: bytes | None) -> str:
    if not body:
        return ""
    try:
        raw = dec(body)
    except Exception:
        try:
            raw = bytes(body)
        except Exception:
            return ""
    try:
        sections = json.loads(raw)
    except Exception:
        return ""
    parts = []
    for s in sections:
        if s.get("h"):
            parts.append(s["h"])
        if s.get("k") == "table":
            # Flatten cells so tables stay searchable even though they are
            # stored structurally.
            if s.get("headers"):
                parts.append(" ".join(s["headers"]))
            for row in s.get("rows") or ():
                parts.append(" ".join(row))
        elif s.get("k") == "rich":
            parts.extend(map(block_text, s["blocks"]))
        elif s.get("t"):
            parts.append(s["t"])
    return "\n".join(parts)
