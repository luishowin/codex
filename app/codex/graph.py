"""Pass 2: resolve the link graph, drop dead ends, and rank by PageRank.

The archive knows which pages exist, so a link whose target is not in the corpus
is provably a dead end and is discarded here rather than guessed at. What
survives is a clean internal graph, and PageRank over it gives an importance
signal computed entirely offline -- no usage data, no telemetry, no network.

That signal does double duty: it decides which documents are worth carrying
images for, and it multiplies BM25 at query time so that searching "mercury"
surfaces the planet and the element ahead of a hamlet in Nevada.
"""
from __future__ import annotations

import time
from pathlib import Path

import numpy as np

from .build import EDGE_DTYPE, log, path_hash
from .model import KIND_DEVICE

DAMPING = 0.85
ITERATIONS = 20
TOP_RELATED = 12
# A page linked from more than this share of the corpus is site furniture -- an
# error page, a licence notice, an "external content" interstitial -- not an
# important topic. Left alone it wins PageRank outright and starves every real
# document, so it is excluded from the graph before ranking.
BOILERPLATE_SHARE = 0.15
BOILERPLATE_MIN = 500
# Process the edge file in slices so peak memory stays bounded regardless of
# corpus size; 32M edges is ~384 MB of working set.
EDGE_SLICE = 32_000_000
# Resolved edges: both endpoints are doc ids by this point.
RESOLVED_DTYPE = np.dtype([("s", "<u4"), ("d", "<u4")])
# Selecting `related` sorts three parallel arrays per slice, so it works in
# smaller bites than the resolve pass: a sort needs an index array plus negated
# copies of both sort keys, roughly 24 bytes per edge on top of the edges.
RELATED_SLICE = 8_000_000
# Fold accumulated per-slice candidates back down once they exceed this, so peak
# memory does not depend on how the edge file happens to be ordered.
CANDIDATE_LIMIT = 24_000_000
# Rows per executemany. Converting a whole 78M-row result to Python lists at
# once would cost gigabytes; this streams it in bites.
SQL_BATCH = 500_000


def _resolve_map(con) -> tuple[np.ndarray, np.ndarray, int, int]:
    """Build a sorted (path_hash -> doc_id) lookup table, and persist redirects.

    Redirects are folded in so that a link to a redirect resolves to the
    redirect's target, exactly as a reader would follow it.

    The path->id dict answers both questions -- which hash resolves to which
    document, and which redirect points at a live document -- so it is built
    once here rather than scanned out of `doc` a second time by the caller. At
    7M documents that dict is ~1 GB, and building it twice was a gigabyte of
    peak we do not have.
    """
    log("  building path->id map")
    n_docs = con.execute("SELECT COUNT(*) FROM doc").fetchone()[0]

    hashes = np.empty(n_docs, dtype=np.uint64)
    ids = np.empty(n_docs, dtype=np.uint32)
    by_path: dict[str, int] = {}
    # Streamed rather than fetchall(): materialising 7M (id, path) tuples costs
    # another gigabyte on top of the dict, and they are consumed once.
    for k, (doc_id, path) in enumerate(con.execute("SELECT id, path FROM doc")):
        hashes[k] = path_hash(path)
        ids[k] = doc_id
        by_path[path] = doc_id

    extra_h: list[int] = []
    extra_i: list[int] = []

    def _resolved():
        """Yield (from_path, target_id) and collect the hash side as we go."""
        for from_path, to_path in con.execute(
                "SELECT from_path, to_path FROM redirect_raw"):
            target = by_path.get(to_path)
            if target is None:
                continue
            extra_h.append(path_hash(from_path))
            extra_i.append(target)
            yield (from_path, target)

    con.execute("BEGIN")
    con.execute("DELETE FROM redirect")
    con.executemany("INSERT OR IGNORE INTO redirect(from_path, to_id) VALUES(?,?)",
                    _resolved())
    con.execute("COMMIT")
    n_red = len(extra_h)
    log(f"  {n_red:,} redirects resolved to live documents")

    if extra_h:
        hashes = np.concatenate([hashes, np.array(extra_h, dtype=np.uint64)])
        ids = np.concatenate([ids, np.array(extra_i, dtype=np.uint32)])
        extra_h.clear()
        extra_i.clear()
    log(f"  {n_docs:,} docs + {n_red:,} resolvable redirects in map")

    order = np.argsort(hashes, kind="stable")
    return hashes[order], ids[order], n_docs, n_red


def resolve_and_rank(con, edges_path: Path, max_doc_id: int) -> dict:
    """Resolve raw edges to doc ids, run PageRank, and persist the results."""
    t0 = time.perf_counter()
    # Resolves redirects and persists them as a side effect: it holds the only
    # path->id dict, and building a second one costs a gigabyte.
    sorted_h, sorted_ids, n_docs, n_redirects = _resolve_map(con)

    size = edges_path.stat().st_size
    n_edges_total = size // EDGE_DTYPE.itemsize
    log(f"  resolving {n_edges_total:,} raw edges ({size/2**30:,.2f} GB)")

    dim = max_doc_id + 1
    # int64 so the per-slice bincount below can accumulate in place without a
    # cast on every block.
    in_degree = np.zeros(dim, dtype=np.int64)
    out_degree = np.zeros(dim, dtype=np.int64)

    resolved_path = edges_path.with_suffix(".resolved.bin")
    n_kept = n_dead = 0

    with open(edges_path, "rb") as fin, open(resolved_path, "wb") as fout:
        while True:
            block = np.fromfile(fin, dtype=EDGE_DTYPE, count=EDGE_SLICE)
            if block.size == 0:
                break
            src = block["src"]
            dst_h = block["dst"]

            # searchsorted + equality check: a miss means the target is not in
            # the corpus, i.e. a dead-end link.
            pos = np.searchsorted(sorted_h, dst_h)
            np.clip(pos, 0, len(sorted_h) - 1, out=pos)
            hit = sorted_h[pos] == dst_h
            dst = sorted_ids[pos]

            keep = hit & (dst != src.astype(np.uint32))  # drop self-links
            n_dead += int((~hit).sum())
            src_k = src[keep].astype(np.uint32)
            dst_k = dst[keep]
            n_kept += src_k.size

            # bincount, not np.add.at: for plain integer counts the unbuffered
            # ufunc path is ~8x slower (measured 4.74s vs 0.61s per 32M edges).
            # The float-weighted add.at in _pagerank is a different code path
            # and is already the faster of the two -- leave that one alone.
            if src_k.size:
                in_degree += np.bincount(dst_k, minlength=dim)
                out_degree += np.bincount(src_k, minlength=dim)

            out = np.empty(src_k.size, dtype=RESOLVED_DTYPE)
            out["s"] = src_k
            out["d"] = dst_k
            out.tofile(fout)

    log(f"  kept {n_kept:,} live edges, dropped {n_dead:,} dead ends "
        f"({n_dead/max(n_edges_total,1):.1%})")

    # Identify site furniture by how universally it is linked.
    threshold = max(BOILERPLATE_MIN, int(n_docs * BOILERPLATE_SHARE))
    boiler = in_degree > threshold
    n_boiler = int(boiler.sum())
    if n_boiler:
        names = con.execute(
            "SELECT id, title FROM doc WHERE id IN ({})".format(
                ",".join(str(i) for i in np.flatnonzero(boiler)[:12]))).fetchall()
        log(f"  {n_boiler} boilerplate target(s) over {threshold:,} in-links, "
            f"excluded from ranking:")
        for _id, t in names:
            log(f"      in={int(in_degree[_id]):>7,}  {t[:56]}")

    rank = _pagerank(resolved_path, dim, out_degree, n_docs, boiler)
    _persist(con, rank, in_degree, resolved_path, dim, boiler)

    edges_path.unlink(missing_ok=True)
    resolved_path.unlink(missing_ok=True)
    log(f"  pass 2 done in {(time.perf_counter()-t0)/60:,.1f} min")

    return {"edges_kept": n_kept, "edges_dead": n_dead,
            "redirects": n_redirects}


def _pagerank(resolved_path: Path, dim: int, out_degree: np.ndarray,
              n_docs: int, boiler: np.ndarray) -> np.ndarray:
    """Power iteration over the resolved edge file."""
    log(f"  pagerank: {ITERATIONS} iterations over {dim:,} nodes")
    rank = np.full(dim, 1.0 / max(n_docs, 1), dtype=np.float64)
    # Nodes with no outbound links leak mass; redistribute it uniformly.
    dangling = out_degree == 0
    safe_out = np.maximum(out_degree, 1).astype(np.float64)

    for it in range(ITERATIONS):
        t0 = time.perf_counter()
        contrib = rank / safe_out
        nxt = np.zeros(dim, dtype=np.float64)

        with open(resolved_path, "rb") as f:
            while True:
                block = np.fromfile(f, dtype=RESOLVED_DTYPE, count=EDGE_SLICE)
                if block.size == 0:
                    break
                # Measured on numpy 2.5: the float-weighted add.at path runs at
                # 0.42s per 32M edges, slightly *faster* than the equivalent
                # bincount. Do not "optimise" this into bincount.
                np.add.at(nxt, block["d"], contrib[block["s"]])

        leaked = rank[dangling].sum()
        nxt = DAMPING * (nxt + leaked / max(n_docs, 1)) + (1 - DAMPING) / max(n_docs, 1)
        # Furniture absorbs mass every iteration; drain it so the rest of the
        # corpus keeps it.
        nxt[boiler] = 0.0

        delta = np.abs(nxt - rank).sum()
        rank = nxt
        log(f"    iter {it+1:2d}/{ITERATIONS}  L1 delta {delta:.3e}  "
            f"({time.perf_counter()-t0:,.1f}s)")
        if delta < 1e-9:
            log("    converged")
            break
    return rank


def _group_top(key: np.ndarray, val: np.ndarray, score: np.ndarray,
               k: int) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """For each distinct `key`, the `k` entries with the highest (score, val).

    This is the vectorised form of the `list.sort(reverse=True)` over (score,
    id) tuples it replaces, tie-break included: equal scores order by
    *descending* id, which is what comparing those tuples did.

    Returns (key, val, score, rank) sorted by key ascending then rank ascending,
    where rank is the 0-based position within the key's group.
    """
    empty = np.empty(0, dtype=np.int64)
    if key.size == 0:
        return key, val, score, empty
    # lexsort's *last* key is the primary one: group by key ascending, then
    # score descending, then val descending.
    order = np.lexsort((-val.astype(np.int64), -score, key))
    key_s, val_s, score_s = key[order], val[order], score[order]
    del order
    starts = np.flatnonzero(np.concatenate(([True], key_s[1:] != key_s[:-1])))
    counts = np.diff(np.append(starts, key_s.size))
    rank = np.arange(key_s.size, dtype=np.int64) - np.repeat(starts, counts)
    keep = rank < k
    return key_s[keep], val_s[keep], score_s[keep], rank[keep]


class _TopK:
    """Streaming top-k-per-key over more edges than fit in memory.

    Per-slice top-k followed by a merge is *exact*, not an approximation: if an
    edge is in a key's global top-k it is at least as good as k-1 others, so it
    is in its own slice's top-k for that key too. Candidates are folded back
    down whenever they pile up, which bounds peak memory by CANDIDATE_LIMIT
    rather than by corpus size.
    """

    def __init__(self, k: int) -> None:
        self.k = k
        self._parts: list[tuple[np.ndarray, np.ndarray, np.ndarray]] = []
        self._n = 0

    def add(self, key: np.ndarray, val: np.ndarray, score: np.ndarray) -> None:
        if key.size == 0:
            return
        a, b, c, _ = _group_top(key, val, score, self.k)
        self._parts.append((a, b, c))
        self._n += a.size
        if self._n > CANDIDATE_LIMIT:
            self._fold()

    def _fold(self) -> None:
        if len(self._parts) < 2:
            return
        a, b, c, _ = _group_top(
            np.concatenate([p[0] for p in self._parts]),
            np.concatenate([p[1] for p in self._parts]),
            np.concatenate([p[2] for p in self._parts]), self.k)
        self._parts = [(a, b, c)]
        self._n = a.size

    def result(self) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
        if not self._parts:
            e32 = np.empty(0, dtype=np.uint32)
            return e32, e32, np.empty(0), np.empty(0, dtype=np.int64)
        self._fold()
        a, b, c = self._parts[0]
        return _group_top(a, b, c, self.k)


def _scan_related(resolved_path: Path, norm: np.ndarray, boiler: np.ndarray,
                  kinds: np.ndarray | None):
    """One streaming pass over the resolved edges, feeding both selections.

    `related` is the top outbound neighbours by rank. `context` is the single
    highest-ranked *inbound* device page, which is the only thing that tells 42
    guides all called "Safety Precautions" apart. Both come off the same read.
    """
    related = _TopK(TOP_RELATED)
    context = _TopK(1) if kinds is not None else None
    with open(resolved_path, "rb") as f:
        while True:
            block = np.fromfile(f, dtype=RESOLVED_DTYPE, count=RELATED_SLICE)
            if block.size == 0:
                break
            # Furniture is never a useful "related" suggestion either.
            live = ~boiler[block["d"]]
            srcs, dsts = block["s"][live], block["d"][live]
            del block, live
            if srcs.size == 0:
                continue
            related.add(srcs, dsts, norm[dsts])
            if context is not None:
                from_device = kinds[srcs] == KIND_DEVICE
                d_src = srcs[from_device]
                if d_src.size:
                    context.add(dsts[from_device], d_src, norm[d_src])
    return related.result(), (context.result() if context is not None else None)


def _executemany_batched(con, sql: str, columns: list[np.ndarray]) -> None:
    """executemany over numpy columns without ever building the whole row list."""
    n = columns[0].size
    for lo in range(0, n, SQL_BATCH):
        hi = min(lo + SQL_BATCH, n)
        con.executemany(sql, zip(*(c[lo:hi].tolist() for c in columns)))


def _persist(con, rank: np.ndarray, in_degree: np.ndarray,
             resolved_path: Path, dim: int, boiler: np.ndarray) -> None:
    """Write normalised importance, in-degree, and top-N related documents."""
    log("  writing importance and related")
    # Normalise to 0..1 on a log scale: raw PageRank is extremely long-tailed,
    # so a linear scale would collapse almost every document to zero.
    positive = rank[rank > 0]
    if positive.size:
        lo = np.log(positive.min())
        hi = np.log(rank.max())
        norm = np.zeros_like(rank)
        nz = rank > 0
        norm[nz] = (np.log(rank[nz]) - lo) / max(hi - lo, 1e-12)
    else:
        norm = rank

    sel = np.flatnonzero((in_degree > 0) | (norm > 0))
    con.execute("BEGIN")
    _executemany_batched(
        con, "UPDATE doc SET importance=?, in_degree=? WHERE id=?",
        [norm[sel], in_degree[sel], sel])
    con.execute("COMMIT")
    del sel

    # Kinds, for picking a disambiguating parent below -- but only where such a
    # parent can exist. WikipediaAdapter emits nothing but KIND_ARTICLE, so on
    # Wikipedia this whole selection is provably empty and the per-slice gather
    # over every edge is pure waste.
    kinds = None
    if con.execute("SELECT EXISTS(SELECT 1 FROM doc WHERE kind=?)",
                   (KIND_DEVICE,)).fetchone()[0]:
        kinds = np.zeros(dim, dtype=np.uint8)
        for _id, _k in con.execute("SELECT id, kind FROM doc"):
            kinds[_id] = _k
        log("  selecting related documents and disambiguating context")
    else:
        log("  selecting related documents (no device pages: no context labels)")

    (r_src, r_dst, _, r_rank), ctx = _scan_related(
        resolved_path, norm, boiler, kinds)

    con.execute("BEGIN")
    con.execute("DELETE FROM related")
    _executemany_batched(
        con, "INSERT OR REPLACE INTO related(src, dst, rank) VALUES(?,?,?)",
        [r_src, r_dst, r_rank])
    n_context = 0
    if ctx is not None:
        c_dst, c_src, _, _ = ctx
        n_context = int(c_dst.size)
        _executemany_batched(
            con, "UPDATE doc SET context_id=? WHERE id=?", [c_src, c_dst])
    con.execute("DROP TABLE IF EXISTS redirect_raw")
    con.execute("COMMIT")
    log(f"  {r_src.size:,} related rows, {n_context:,} context labels written")
