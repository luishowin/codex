"""The codex build pipeline.

Streams a source into a codex without ever materialising it on disk. The
source is opened read-only and never modified.

    pass 1  extract, compress, write doc rows and the outbound edge file
    pass 2  resolve edges, drop dead ends, PageRank, write importance + related
    pass 3  build the FTS indexes

Passes 1-3 each checkpoint, so an interrupted overnight run resumes rather than
restarting.

Bodies are zlib-compressed JSON (level ZLIB_LEVEL, no dictionary): the
projector is stdlib-only, so the one third-party runtime dependency had to
go. Measured on 1,000 real Wikipedia bodies, zlib-6 and zlib-9 compress
identically and take the same time; against the old zstd-15+dict, zlib is
+7.5% on long prose and smaller on short docs. Decode cost is microseconds
per document either way.
"""
from __future__ import annotations

import hashlib
import json
import multiprocessing as mp
import os
import sqlite3
import struct
import sys
import time
import zlib
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from libzim.reader import Archive

from .adapters import pick_adapter
from .ingest import _extract_one, archive_meta
from .model import Doc
from .schema import (BUILD_PRAGMAS, apply_pragmas, get_meta, init_core,
                     init_core_indexes, init_deep, init_fts_quick, set_meta,
                     SCHEMA_VERSION)

# (src_id, dst_path_hash) written during extraction; resolved in pass 2.
EDGE_DTYPE = np.dtype([("src", "<u4"), ("dst", "<u8")])
EDGE_STRUCT = struct.Struct("<IQ")
# zlib 6: identical size and pace to 9 on sampled bodies (see module doc).
ZLIB_LEVEL = 6
CHUNK = 2000          # entry ids per worker task
CHECKPOINT_EVERY = 50_000
CHECKPOINT_SECONDS = 120.0   # ...or this long, whichever comes first
PROGRESS_EVERY = 60.0        # seconds between progress lines


def path_hash(path: str) -> int:
    """Stable 64-bit path hash.

    Python's built-in hash() is randomised per process and therefore useless
    across worker boundaries; blake2b is stable and fast enough at this size.
    """
    return int.from_bytes(
        hashlib.blake2b(path.encode("utf-8", "surrogatepass"), digest_size=8).digest(),
        "little",
    )


# --------------------------------------------------------------------------
# worker
# --------------------------------------------------------------------------

_W: dict = {}


def _worker_init(zim_path: str, level: int = ZLIB_LEVEL) -> None:
    """Each process gets its own Archive handle. Compression is plain zlib,
    so there is no dictionary to share and nothing to train (pass 0 is gone)."""
    a = Archive(zim_path)
    _W["archive"] = a
    adapter = pick_adapter(archive_meta(a))
    # Adapters that need an archive-wide index (a table of contents, a path map)
    # build it once per worker rather than once per entry.
    adapter.prepare(a)
    _W["adapter"] = adapter
    _W["level"] = level


def _worker_chunk(args: tuple[int, int]) -> list[tuple]:
    """Parse a contiguous range of entry ids. Returns rows ready for SQLite."""
    lo, hi = args
    a = _W["archive"]
    adapter = _W["adapter"]
    level = _W["level"]
    out: list[tuple] = []

    for i in range(lo, hi):
        got = _extract_one(a, adapter, i)
        if got is None:
            continue
        tag, payload = got
        if tag == "redirect":
            out.append(("R", payload[0], payload[1]))
            continue

        doc: Doc = payload
        body_json = json.dumps([s.as_json() for s in doc.sections],
                               ensure_ascii=False, separators=(",", ":")
                               ).encode("utf-8")
        body = zlib.compress(body_json, level)
        meta = json.dumps(doc.meta, ensure_ascii=False,
                          separators=(",", ":")) if doc.meta else None
        link_hashes = [path_hash(p) for p in doc.links]
        out.append(("D", doc.path, doc.title, doc.kind, doc.word_count,
                    doc.lead, body, meta, link_hashes, doc.flags))
    return out


# --------------------------------------------------------------------------
# driver
# --------------------------------------------------------------------------

@dataclass
class BuildPaths:
    core: Path
    deep: Path
    edges: Path
    workdir: Path


def plan_paths(out_dir: str, name: str, scratch: str | None) -> BuildPaths:
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    # The edge file is large and transient; keep it off the volume holding the
    # source archive so the two do not compete for free space.
    work = Path(scratch) if scratch else out / "_work"
    work.mkdir(parents=True, exist_ok=True)
    return BuildPaths(core=out / f"{name}.codex.db",
                      deep=out / f"{name}.codex-deep.db",
                      edges=work / f"{name}.edges.bin",
                      workdir=work)


def log(msg: str) -> None:
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


def _gb(n: float) -> str:
    return f"{n/2**30:,.1f} GB"


def preflight(zim_path: str, n_entries: int, paths: "BuildPaths",
              level: int = ZLIB_LEVEL, sample: int = 400) -> dict:
    """Sample the archive to project output size, then check the disk can hold it.

    Measured rather than assumed: keep rate, links per document and compressed
    bytes per document all move by more than 2x between sources, so a hardcoded
    model would be wrong for every archive but the one it was fitted to. A
    twenty-second sample in front of a five-hour run is free.

    Returns {} when nothing could be sampled; the caller treats that as "no
    projection available" rather than as a failure.
    """
    import random
    import shutil

    a = Archive(zim_path)
    adapter = pick_adapter(archive_meta(a))
    adapter.prepare(a)
    rng = random.Random(1234)
    ids = rng.sample(range(n_entries), min(n_entries, sample * 30))

    n_seen = n_docs = n_links = 0
    body_bytes = lead_bytes = 0
    for i in ids:
        if n_docs >= sample:
            break
        n_seen += 1
        got = _extract_one(a, adapter, i)
        if got is None or got[0] != "doc":
            continue
        doc = got[1]
        blob = json.dumps([s.as_json() for s in doc.sections],
                          ensure_ascii=False, separators=(",", ":")
                          ).encode("utf-8")
        body_bytes += len(zlib.compress(blob, level))
        lead_bytes += len(doc.lead.encode("utf-8", "replace"))
        n_links += len(doc.links)
        n_docs += 1

    if not n_docs:
        return {}

    est_docs = int(n_entries * (n_docs / max(n_seen, 1)))
    per_doc_core = (body_bytes + lead_bytes) / n_docs + 120  # +path/title/row
    est_core = est_docs * per_doc_core
    # fts_deep is contentless with detail=none, so it stores a term dictionary
    # and doclists rather than any text. Measured against finished builds it
    # lands at 13% of the core file on Wikipedia and 17% on iFixit; 35% leaves
    # headroom without demanding disk that will never be touched.
    est_deep = est_core * 0.35
    est_edges = est_docs * (n_links / n_docs) * EDGE_STRUCT.size
    # A 400-doc sample lands the document count within about 10% (measured
    # -1.0% to -8.8% across five archives), and it errs low -- the wrong
    # direction for a space check -- so carry a margin.
    margin = 1.15
    # VACUUM rewrites the core into a temporary copy before replacing it, so
    # the peak is two cores plus the deep file.
    need_out = (est_core + est_deep + est_core) * margin
    need_work = (est_edges + est_edges * 0.7) * margin

    out = {"docs": est_docs, "links_per_doc": n_links / n_docs,
           "core": est_core, "deep": est_deep, "edges": est_edges,
           "need_out": need_out, "need_work": need_work,
           "free_out": shutil.disk_usage(paths.core.parent).free,
           "free_work": shutil.disk_usage(paths.workdir).free}
    log(f"preflight: sampled {n_docs} docs from {n_seen:,} entries "
        f"-> est. {est_docs:,} documents, {out['links_per_doc']:,.1f} links each")
    log(f"  projected  core {_gb(est_core)}   deep {_gb(est_deep)}   "
        f"edge file {_gb(est_edges)}")
    log(f"  needs      {_gb(need_out)} on {paths.core.parent} "
        f"(free {_gb(out['free_out'])}), incl. room for VACUUM to copy the core")
    log(f"             {_gb(need_work)} on {paths.workdir} "
        f"(free {_gb(out['free_work'])})")
    return out


def _hms(seconds: float) -> str:
    seconds = max(int(seconds), 0)
    h, rem = divmod(seconds, 3600)
    m, s = divmod(rem, 60)
    return f"{h:d}h{m:02d}m" if h else f"{m:d}m{s:02d}s"


def _rewind_edges(con, edges_path: Path) -> None:
    """Discard edges written past the last committed checkpoint.

    Edges are now durable *before* the transaction that accounts for them, so a
    crash in between leaves the file longer than the watermark. Appending to it
    as-is would double up the edges for those documents.
    """
    raw = get_meta(con).get("edge_bytes")
    if raw is None:
        # A codex checkpointed by a build predating this field. It has no record
        # of how far the edge file was accounted for, and truncating to zero
        # would throw away a perfectly good one, so leave it alone.
        log("  no edge_bytes watermark (older build); appending without rewind")
        return
    recorded = int(raw or 0)
    if not edges_path.exists():
        return
    actual = edges_path.stat().st_size
    if actual > recorded:
        log(f"  edge file is {actual - recorded:,} bytes past the last "
            f"checkpoint; rewinding to {recorded:,}")
        with open(edges_path, "r+b") as ef:
            ef.truncate(recorded)


def extract_pass(con, zim_path: str, n_entries: int, workers: int,
                 edges_path: Path, resume_from: int = 0,
                 level: int = ZLIB_LEVEL) -> int:
    """Pass 1: extract every document, compress, and stream out the edge file."""
    log(f"pass 1: extracting from entry {resume_from:,} of {n_entries:,} "
        f"across {workers} workers (zlib level {level})")

    ranges = [(i, min(i + CHUNK, n_entries))
              for i in range(resume_from, n_entries, CHUNK)]
    n_docs = n_redirect = n_flagged = 0
    doc_rows: list[tuple] = []
    red_rows: list[tuple] = []
    next_id = con.execute("SELECT COALESCE(MAX(id), 0) FROM doc").fetchone()[0] + 1
    t0 = time.perf_counter()
    done_entries = resume_from
    last_t, last_docs, last_entries = t0, 0, resume_from
    last_flush = t0

    edge_buf = bytearray()
    if resume_from:
        _rewind_edges(con, edges_path)
    mode = "ab" if resume_from else "wb"
    with open(edges_path, mode) as ef, \
            mp.Pool(workers, initializer=_worker_init,
                    initargs=(zim_path, level)) as pool:

        for got in pool.imap(_worker_chunk, ranges, chunksize=1):
            done_entries += CHUNK
            for row in got:
                if row[0] == "R":
                    red_rows.append((row[1], row[2]))
                    n_redirect += 1
                    continue
                (_, path, title, kind, wc, lead, body, meta, link_hashes,
                 flags) = row
                doc_id = next_id
                next_id += 1
                doc_rows.append((doc_id, path, title, kind, wc, lead, body,
                                 meta, flags))
                for h in link_hashes:
                    edge_buf += EDGE_STRUCT.pack(doc_id, h)
                n_docs += 1
                if flags:
                    n_flagged += 1

            now = time.perf_counter()
            # Checkpoint on either trigger. Count alone is not enough: it is
            # 50,000 *kept* documents, so a stretch of archive that keeps
            # little can run for a long time with nothing durable behind it,
            # and everything since the last checkpoint is lost on a crash.
            if (len(doc_rows) >= CHECKPOINT_EVERY
                    or (doc_rows and now - last_flush >= CHECKPOINT_SECONDS)):
                _flush(con, doc_rows, red_rows, ef, edge_buf,
                       done_entries, n_entries)
                doc_rows, red_rows, edge_buf = [], [], bytearray()
                last_flush = now

            # Progress is reported on its own timer, and as an instantaneous
            # rate: a cumulative average hides a slowdown completely.
            if now - last_t >= PROGRESS_EVERY:
                scanned = min(done_entries, n_entries)
                inst = (n_docs - last_docs) / (now - last_t)
                entry_rate = (done_entries - last_entries) / (now - last_t)
                eta = (n_entries - scanned) / max(entry_rate, 1e-9)
                log(f"  {scanned/n_entries*100:5.1f}%  {n_docs:,} docs  "
                    f"{n_redirect:,} redirects  {inst:,.0f} docs/s "
                    f"(avg {n_docs/max(now-t0,1e-9):,.0f})  "
                    f"eta {_hms(eta)} -> "
                    f"{time.strftime('%a %H:%M', time.localtime(time.time()+eta))}")
                last_t, last_docs, last_entries = now, n_docs, done_entries

        _flush(con, doc_rows, red_rows, ef, edge_buf, n_entries, n_entries)

    log(f"  extracted {n_docs:,} docs, {n_redirect:,} redirects in "
        f"{(time.perf_counter()-t0)/60:,.1f} min")
    log(f"  {n_flagged:,} docs ({n_flagged/max(n_docs,1):.1%}) flagged "
        f"image-dependent")
    return n_docs


def _flush(con, doc_rows, red_rows, ef, edge_buf, done, total) -> None:
    """Checkpoint. Edges reach the disk *before* the rows that reference them.

    `resume_entry` means "every entry below this is fully accounted for", so
    everything it covers has to be durable by the time it is committed. The
    edge write used to happen after the COMMIT, which meant a crash in the gap
    left up to 50,000 documents with no outbound links at all -- no error, no
    warning, just a quietly worse graph five hours later.
    """
    if edge_buf:
        ef.write(edge_buf)
        ef.flush()
        os.fsync(ef.fileno())
    con.execute("BEGIN")
    if doc_rows:
        con.executemany(
            "INSERT INTO doc(id, path, title, kind, word_count, lead, body, "
            "meta, flags) VALUES(?,?,?,?,?,?,?,?,?)", doc_rows)
    if red_rows:
        # from_path is the PK; a ZIM can contain duplicate redirect sources.
        con.executemany(
            "INSERT OR IGNORE INTO redirect_raw(from_path, to_path) VALUES(?,?)",
            red_rows)
    set_meta(con, resume_entry=str(min(done, total)), edge_bytes=str(ef.tell()))
    con.execute("COMMIT")


def build_stream(paths: BuildPaths, ingester, source: str, meta: dict,
                 level: int = ZLIB_LEVEL, no_deep: bool = False) -> int:
    """Pass 1 from any ingester, then the shared finish. Fresh builds only:
    existing outputs are deleted, and there is no resume (stream sources are
    cheap to re-read, unlike a 50 GB archive). New film is always zlib."""
    for p in (paths.core, paths.deep, paths.edges):
        p.unlink(missing_ok=True)

    con = sqlite3.connect(str(paths.core), isolation_level=None)
    apply_pragmas(con, BUILD_PRAGMAS)
    init_core(con)
    set_meta(con, schema_version=SCHEMA_VERSION, body_codec="zlib",
             compress_level=level, built_by="codexctl",
             adapter=ingester.name, **meta)

    log(f"pass 1: streaming {ingester.name} from {source} (zlib {level})")
    t0 = time.perf_counter()
    n_docs = n_redirect = 0
    next_id = 1
    doc_rows: list[tuple] = []
    red_rows: list[tuple] = []
    edge_buf = bytearray()
    ef = open(paths.edges, "wb")
    with ef:
        for tag, payload in ingester.iter_docs(source):
            if tag == "redirect":
                red_rows.append((payload.from_path, payload.to_path))
                n_redirect += 1
                continue
            doc = payload
            body_json = json.dumps([s.as_json() for s in doc.sections],
                                   ensure_ascii=False, separators=(",", ":")
                                   ).encode("utf-8")
            doc_rows.append((next_id, doc.path, doc.title, doc.kind,
                             doc.word_count, doc.lead,
                             zlib.compress(body_json, level),
                             json.dumps(doc.meta, ensure_ascii=False,
                                        separators=(",", ":")) if doc.meta else None,
                             doc.flags))
            for link in doc.links:
                edge_buf += EDGE_STRUCT.pack(next_id, path_hash(link))
            next_id += 1
            n_docs += 1
            if len(doc_rows) >= CHECKPOINT_EVERY:
                _flush(con, doc_rows, red_rows, ef, edge_buf, n_docs, n_docs)
                doc_rows, red_rows, edge_buf = [], [], bytearray()
        _flush(con, doc_rows, red_rows, ef, edge_buf, n_docs, n_docs)
    if not edge_buf and paths.edges.stat().st_size == 0:
        # No edges: leave no file so finish skips the graph the same way it
        # does when a ZIM yields nothing linkable, instead of ranking an
        # empty graph.
        paths.edges.unlink()
    log(f"  streamed {n_docs:,} docs, {n_redirect:,} redirects in "
        f"{(time.perf_counter()-t0)/60:,.1f} min")
    return finish_build(con, paths, state={}, no_deep=no_deep)


def finish_build(con, paths: BuildPaths, state: dict | None = None,
                 no_deep: bool = False, force_graph: bool = False) -> int:
    """Passes 2-3 plus vacuum. Shared by the ZIM and stream funnels.

    Deferred graph/index imports: those modules import log/constants from
    this one, so a top-level import would be circular.
    """
    from .graph import resolve_and_rank
    from .index import build_deep, build_quick

    state = state or {}
    n_docs = con.execute("SELECT COUNT(*) FROM doc").fetchone()[0]
    if n_docs == 0:
        return 0

    log("building core indexes")
    init_core_indexes(con)

    # --- pass 2: graph
    if state.get("graph_done") == "1" and not force_graph:
        log("pass 2: already complete, skipping")
    elif paths.edges.exists() and paths.edges.stat().st_size > 0:
        max_id = con.execute("SELECT MAX(id) FROM doc").fetchone()[0]
        con.execute("PRAGMA cache_size=-262144")   # 256 MiB; see codexctl
        try:
            stats = resolve_and_rank(con, paths.edges, max_id)
        finally:
            apply_pragmas(con, BUILD_PRAGMAS)
        set_meta(con, graph_done="1", **{f"graph_{k}": v
                                         for k, v in stats.items()})
    else:
        log("pass 2: no edges, skipping graph (BM25-only film)")

    # --- pass 3: indexes
    init_fts_quick(con)
    build_quick(con)

    if not no_deep:
        deep = sqlite3.connect(str(paths.deep), isolation_level=None)
        apply_pragmas(deep, BUILD_PRAGMAS)
        init_deep(deep)
        build_deep(con, deep)
        set_meta(deep, table="deep_meta", schema_version=SCHEMA_VERSION,
                 core=paths.core.name, docs=n_docs)
        deep.execute("PRAGMA journal_mode=WAL")
        deep.close()

    set_meta(con, docs=n_docs, built_at=time.strftime("%Y-%m-%dT%H:%M:%S"))
    log("vacuuming core")
    con.execute("PRAGMA journal_mode=WAL")
    # VACUUM rebuilds the database into a temporary copy, and that copy
    # honours temp_store. BUILD_PRAGMAS sets temp_store=MEMORY, which on a
    # multi-GB core means trying to hold the entire rebuilt database in RAM.
    # Put it on the scratch volume instead.
    os.environ.setdefault("SQLITE_TMPDIR", str(paths.workdir))
    con.execute("PRAGMA temp_store=FILE")
    con.execute("VACUUM")
    con.close()
    return n_docs
