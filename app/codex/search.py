"""Query a codex.

Ranking blends FTS5's BM25 with the offline PageRank importance score. BM25
alone answers "which document contains these words most densely", which on a
7-million-document corpus surfaces a lot of obscure stubs. Multiplying by
importance answers the question the user actually asked.

Two tiers:
  quick  title + lead only. What the hotkey launcher calls. Sub-30ms warm.
  deep   full body, via the ATTACHed deep file when it is present.
"""
from __future__ import annotations

import json
import re
import sqlite3
import sys
import threading
import time
import zlib
from contextlib import contextmanager
from pathlib import Path

from .model import reflow
from .schema import FLAG_IMAGE_DEPENDENT

# Longest a single search may run before it is aborted. No query on a healthy
# codex comes close; this exists so a pathological one cannot hold a thread.
QUERY_DEADLINE = 5.0

# Match counts are reported up to this many, then as "cap+". See _count.
COUNT_CAP = 1000

# FTS5 treats these as syntax; a user typing them means them literally.
_FTS_SPECIAL = re.compile(r'["*():^-]')

# Shortest last term that may still be prefix-expanded. Below this a prefix
# matches so much of the corpus that ranking it costs seconds. See escape_query.
MIN_PREFIX = 3


def query_terms(q: str) -> list[str]:
    return [t for t in _FTS_SPECIAL.sub(" ", q).split() if t]


def escape_query(q: str, op: str = "AND") -> str:
    """Turn free text into a safe FTS5 MATCH expression.

    Only the *last* term is a prefix match, because that is the one the user may
    still be typing: "iphone bat" finds "iPhone battery" without anyone learning
    FTS5 syntax.

    Prefixing every term looks equally harmless and is not. On a 7M-document
    index `"a"*` expands to every term in the vocabulary beginning with "a", and
    the cost is not subtle -- measured on the full Wikipedia codex:

        "how does a transformer work"   16,885 ms  ->  367 ms
        "battle of hastings"             2,041 ms  ->  199 ms
        "second world war causes"        1,058 ms  ->   72 ms
        "photosynthesis"                   427 ms  ->    8 ms

    Across eight real queries seven returned an identical top hit and the eighth
    was junk under both. Single-term queries -- what the hotkey launcher sends --
    are unaffected either way.

    A short prefix is the same pathology in miniature, and it is what made the
    search box appear dead: every keystroke fires a query, and the first one or
    two characters expand to most of the corpus. Measured on the full Wikipedia
    codex, with the ranking query already restructured:

        prefix   documents matched   latency
        "b"*             5,693,928    9,430 ms
        "ba"*            1,924,470    1,894 ms
        "bat"*             172,817      191 ms
        "batt"*            103,484      121 ms
        "batter"*                        26 ms

    The cliff is between two characters and three, so terms shorter than
    MIN_PREFIX are matched exactly instead. Typing "ba" then finds the word "ba"
    rather than a fifth of Wikipedia -- correct, and three orders of magnitude
    cheaper.

    Quoting also neutralises FTS5 operators, so a stray '-' or 'NEAR(' is treated
    as text rather than raising a syntax error mid-keystroke.
    """
    terms = query_terms(q)
    if not terms:
        return ""
    last = terms[-1]
    parts = [f'"{t}"' for t in terms[:-1]]
    parts.append(f'"{last}"*' if len(last) >= MIN_PREFIX else f'"{last}"')
    joiner = " " if op == "AND" else " OR "
    return joiner.join(parts)


class Searcher:
    """Read-only handle on one codex.

    Connections are per-thread. A single sqlite3.Connection shared across
    threads serialises every statement on it, which is why the daemon needed a
    global lock -- and one slow query then wedged every codex for every client.
    Each thread getting its own read-only handle removes the need for the lock
    entirely; SQLite is happy with many concurrent readers of the same file.
    """

    def __init__(self, core_path: str, deep_path: str | None = None,
                 deadline: float = QUERY_DEADLINE):
        self.core_path = Path(core_path)
        self.deadline = deadline

        if deep_path is None:
            guess = self.core_path.with_name(
                self.core_path.name.replace(".codex.db", ".codex-deep.db"))
            deep_path = str(guess) if guess.exists() else None
        self.deep_path = (deep_path if deep_path and Path(deep_path).exists()
                          else None)
        self.has_deep = self.deep_path is not None

        self._local = threading.local()

    # -- connections ------------------------------------------------------
    def _connect(self) -> sqlite3.Connection:
        con = sqlite3.connect(f"file:{self.core_path}?mode=ro", uri=True,
                              check_same_thread=False)
        con.row_factory = sqlite3.Row
        con.execute("PRAGMA temp_store=MEMORY")
        con.execute("PRAGMA cache_size=-131072")
        if self.deep_path:
            con.execute("ATTACH DATABASE ? AS deep",
                        (f"file:{self.deep_path}?mode=ro",))
        # Fires every N virtual-machine instructions; returning non-zero aborts
        # the statement. This is the backstop that keeps one pathological query
        # from occupying a thread indefinitely.
        #
        # N sets how far past the deadline a query can run before anyone checks.
        # Measured against a 2.0s budget: 100,000 overshot to 3.28s, 25,000 to
        # 2.14s, 5,000 to 2.28s -- and a normal query cost 7.3 / 7.1 / 7.6 ms
        # respectively, so the finer checks are free. 25,000 it is.
        con.set_progress_handler(self._expired, 25_000)
        return con

    @property
    def con(self) -> sqlite3.Connection:
        con = getattr(self._local, "con", None)
        if con is None:
            con = self._local.con = self._connect()
        return con

    def _expired(self) -> int:
        until = getattr(self._local, "until", None)
        return 1 if until is not None and time.monotonic() > until else 0

    @contextmanager
    def _deadline(self, seconds: float | None = None):
        """Abort any query in this block that runs longer than `seconds`."""
        self._local.until = time.monotonic() + (seconds or self.deadline)
        try:
            yield
        finally:
            self._local.until = None

    # -- ranking ----------------------------------------------------------
    @staticmethod
    def _blend(bm25: float, importance: float) -> float:
        """Combine BM25 with importance.

        FTS5 returns bm25() as a negative number where more negative is better.
        Flip it, then scale by importance on a floor so that a highly relevant
        obscure page still outranks a vaguely relevant famous one.
        """
        relevance = -bm25
        return relevance * (0.35 + importance)

    def search(self, query: str, limit: int = 10, deep: bool = False) -> list[dict]:
        """Search with progressive relaxation. See _run."""
        return self._run(query, limit, deep)[0]

    def search_page(self, query: str, limit: int = 10, deep: bool = False,
                    cap: int = COUNT_CAP) -> dict:
        """search(), plus how many documents matched.

        The count comes from the attempt that actually produced the hits -- a
        query that fell through to an OR relaxation matched far more documents
        than the AND that returned nothing, and reporting the AND's count would
        describe a result set the user is not looking at.
        """
        hits, tier, op = self._run(query, limit, deep)
        total, capped = self._count(query, tier, op, cap) if hits else (0, False)
        return {"hits": hits, "total": total, "capped": capped,
                "tier": tier, "relaxed": op == "OR"}

    def _run(self, query: str, limit: int,
             deep: bool) -> tuple[list[dict], str | None, str | None]:
        """Search with progressive relaxation.

        Requiring every term is right when it works and useless when it does
        not: "nintendo switch joycon drift" has no title containing all four
        words, and returning nothing is the worst possible answer. So fall back
        -- widen to the full body, then to any-term -- rather than giving up.

        Returns the hits alongside the tier and operator that produced them, so
        a caller can describe or re-query the same result set.
        """
        if not query_terms(query):
            return [], None, None

        attempts = []
        if deep and self.has_deep:
            attempts.append(("deep", "AND"))
            attempts.append(("deep", "OR"))
        else:
            attempts.append(("quick", "AND"))
            if self.has_deep:
                attempts.append(("deep", "AND"))
            attempts.append(("quick", "OR"))
            if self.has_deep:
                attempts.append(("deep", "OR"))

        # One deadline for the whole relaxation ladder, not per attempt: four
        # attempts each allowed the full budget would be four times the wait.
        with self._deadline():
            for tier, op in attempts:
                match = escape_query(query, op)
                if not match:
                    continue
                try:
                    hits = (self._search_deep(query, match, limit) if tier == "deep"
                            else self._search_quick(query, match, limit))
                except sqlite3.DatabaseError as exc:
                    # A malformed MATCH expression from half-typed user input is
                    # expected and skippable. A broken *statement* is a bug, and
                    # swallowing it silently is how the deep tier stayed dead --
                    # every query failed identically and the fallback hid it.
                    #
                    # An abort is neither: the budget is spent, so relaxing to a
                    # wider query would only spend more. Give up on this codex.
                    if self._expired():
                        print(f"  !! {tier}/{op} aborted at deadline "
                              f"({self.deadline:.0f}s): {query!r}", file=sys.stderr)
                        return [], None, None
                    print(f"  !! {tier}/{op} query failed: {exc}", file=sys.stderr)
                    continue
                if hits:
                    for h in hits:
                        h["tier"] = tier
                        h["relaxed"] = (op == "OR")
                    return hits, tier, op
        return [], None, None

    def _count(self, query: str, tier: str, op: str,
               cap: int = COUNT_CAP) -> tuple[int, bool]:
        """How many documents matched, counted up to `cap`.

        Deliberately not exact. Counting every match means visiting every match,
        and the whole point of the ranked query is to avoid that -- on a short
        prefix it is millions of rows. Without ORDER BY the LIMIT terminates the
        scan early, which is what makes this affordable: measured 0.7-22 ms
        against matches that cost seconds to rank.

        Returns (count, capped). `capped` true means "at least cap", so the UI
        can say "1,000+" rather than claiming a precision it does not have.
        """
        match = escape_query(query, op)
        if not match:
            return 0, False
        src = "deep.fts_deep" if tier == "deep" else "fts_quick"
        bare = "fts_deep" if tier == "deep" else "fts_quick"
        sql = (f"SELECT COUNT(*) FROM "
               f"(SELECT rowid FROM {src} WHERE {bare} MATCH ? LIMIT ?)")
        try:
            with self._deadline(1.0):
                n = self.con.execute(sql, (match, cap + 1)).fetchone()[0]
        except sqlite3.DatabaseError:
            # A count is a nicety; never fail a good result set over it.
            return 0, False
        return (cap, True) if n > cap else (n, False)

    # Rank on the FTS index alone, then join `doc` for the survivors only.
    #
    # Joining inside the ranked query looks equivalent and is not: the join and
    # the correlated context lookup run for every *match*, before LIMIT applies.
    # On "batt"* that is 103,484 random reads into a 21 GB file plus 103,484
    # subqueries, to return 200 rows. Measured idle, interleaved, best-of-3:
    #
    #     "battery"*     30 ms  ->   20 ms
    #     "batter"*      44 ms  ->   28 ms
    #     "batt"*       945 ms  ->  116 ms
    #     "bat"*      1,438 ms  ->  188 ms
    #
    # Top-5 results are identical in every case -- the ordering is the same, the
    # work to reach it is not.
    _QUICK_SQL = """
        WITH top AS (
            SELECT rowid AS id,
                   bm25(fts_quick, 8.0, 1.0) AS bm,
                   snippet(fts_quick, 1, '', '', ' ', 18) AS snip
            FROM fts_quick
            WHERE fts_quick MATCH ?
            ORDER BY bm
            LIMIT ?
        )
        SELECT d.id, d.path, d.title, d.lead, d.importance, d.kind,
               (SELECT c.title FROM doc c WHERE c.id = d.context_id) AS ctx,
               t.bm AS bm, t.snip AS snip
        FROM top t JOIN doc d ON d.id = t.id
        ORDER BY t.bm
    """

    def _search_quick(self, raw: str, match: str, limit: int) -> list[dict]:
        rows = self.con.execute(self._QUICK_SQL, (match, limit * 8)).fetchall()
        return self._rank(rows, raw, limit)

    # Same shape as _QUICK_SQL, and the same reason for it.
    #
    # The MATCH operand must be the table's bare name -- not schema-qualified,
    # and not an alias. `deep.fts_deep MATCH ?` reads as table `deep`, column
    # `fts_deep` and raises "no such column"; `f MATCH ?` against an alias
    # raises the same. Either way every deep query failed and search() fell
    # through to quick, which is how this tier stayed dead without anyone
    # noticing. Qualify the FROM, bare-name everything else -- including inside
    # the CTE, where the same rule applies.
    _DEEP_SQL = """
        WITH top AS (
            SELECT rowid AS id, bm25(fts_deep) AS bm
            FROM deep.fts_deep
            WHERE fts_deep MATCH ?
            ORDER BY bm
            LIMIT ?
        )
        SELECT d.id, d.path, d.title, d.lead, d.importance, d.kind,
               (SELECT c.title FROM doc c WHERE c.id = d.context_id) AS ctx,
               t.bm AS bm, '' AS snip
        FROM top t JOIN doc d ON d.id = t.id
        ORDER BY t.bm
    """

    def _search_deep(self, raw: str, match: str, limit: int) -> list[dict]:
        rows = self.con.execute(self._DEEP_SQL, (match, limit * 8)).fetchall()
        return self._rank(rows, raw, limit)

    def _rank(self, rows, raw: str, limit: int) -> list[dict]:
        ql = raw.strip().lower()
        terms = [t.lower() for t in query_terms(raw)]
        out = []
        for r in rows:
            score = self._blend(r["bm"], r["importance"])
            title_l = (r["title"] or "").lower()
            # An exact or prefix title match is almost always what was meant.
            if title_l == ql:
                score *= 6.0
            elif title_l.startswith(ql):
                score *= 2.5

            # Under an OR relaxation a document matching three of four terms
            # must beat one matching a single common word.
            if len(terms) > 1:
                haystack = f"{title_l} {(r['lead'] or '').lower()}"
                covered = sum(1 for t in terms if t in haystack)
                score *= 1.0 + 0.6 * (covered / len(terms))

            snippet = " ".join(((r["snip"] or "").strip()
                                or (r["lead"] or "")).split())
            out.append({
                "id": r["id"], "path": r["path"], "title": r["title"],
                "importance": r["importance"], "kind": r["kind"],
                "context": r["ctx"],
                "score": score,
                "snippet": snippet[:300],
            })
        out.sort(key=lambda h: -h["score"])
        return out[:limit]

    # Index-backed by idx_doc_title (upper-initial, title): equality on the
    # initial plus a range start for keyset paging, so even the first page
    # of 'S' on 7M documents never scans.
    _BROWSE_SQL = """
        SELECT d.id, d.path, d.title, d.lead, d.importance, d.kind,
               (SELECT c.title FROM doc c WHERE c.id = d.context_id) AS ctx
        FROM doc d
        WHERE upper(substr(d.title, 1, 1)) = ?
          AND d.title > ?
        ORDER BY d.title
        LIMIT ?
    """

    _BROWSE_MISC_SQL = """
        SELECT d.id, d.path, d.title, d.lead, d.importance, d.kind,
               (SELECT c.title FROM doc c WHERE c.id = d.context_id) AS ctx
        FROM doc d
        WHERE (upper(substr(d.title, 1, 1)) < 'A'
               OR upper(substr(d.title, 1, 1)) > 'Z')
          AND d.title > ?
        ORDER BY d.title
        LIMIT ?
    """

    def browse(self, prefix: str, limit: int = 50, after: str = "") -> list[dict]:
        """Alphabetical title browse for the A-Z strip.

        Rows carry the same keys as search hits (snippet is the lead's first
        words), so the canvas renders them through the same rows. `after` is
        the last title of the previous page. '#' groups every non-A-Z
        initial -- digits, symbols, non-Latin scripts (upper() is ASCII-only,
        so accented initials land here too until diacritics are folded).
        """
        limit = max(1, min(limit, 200))
        if prefix == "#":
            rows = self.con.execute(
                self._BROWSE_MISC_SQL, (after or "", limit)).fetchall()
        else:
            k = (prefix[:1] if prefix else "").upper()
            if len(k) != 1 or not "A" <= k <= "Z":
                return []
            rows = self.con.execute(
                self._BROWSE_SQL, (k, after or "", limit)).fetchall()
        out = []
        for r in rows:
            out.append({
                "id": r["id"], "path": r["path"], "title": r["title"],
                "importance": r["importance"], "kind": r["kind"],
                "context": r["ctx"],
                "snippet": " ".join(((r["lead"] or "").split())[:40]),
            })
        return out

    # -- retrieval --------------------------------------------------------
    def get(self, doc_id: int) -> dict | None:
        r = self.con.execute(
            "SELECT id, path, title, kind, importance, in_degree, word_count, "
            "lead, body, meta, flags, "
            "(SELECT c.title FROM doc c WHERE c.id = doc.context_id) AS context "
            "FROM doc WHERE id=?", (doc_id,)).fetchone()
        if r is None:
            return None
        sections = []
        if r["body"]:
            try:
                # Bodies are zlib JSON. Anything else is pre-2.0 film, which
                # this projector no longer reads (see SPEC).
                sections = json.loads(zlib.decompress(r["body"]))
            except Exception:
                sections = []
        # Repair the extraction artefact described in model.reflow. Done here so
        # every consumer gets clean prose -- the reader, the CLI, and anything
        # later feeding this text to a model -- rather than each fixing it again.
        for s in sections:
            if "t" in s:
                s["t"] = reflow(s["t"])
        return {
            "id": r["id"], "path": r["path"], "title": r["title"],
            "kind": r["kind"], "importance": r["importance"],
            "in_degree": r["in_degree"], "word_count": r["word_count"],
            "context": r["context"],
            "lead": reflow(r["lead"] or ""), "sections": sections,
            "meta": json.loads(r["meta"]) if r["meta"] else {},
            "flags": r["flags"],
            "image_dependent": bool(r["flags"] & FLAG_IMAGE_DEPENDENT),
        }

    def related(self, doc_id: int, limit: int = 12) -> list[dict]:
        """Related documents, link-derived where possible.

        Only ~28% of iFixit documents have link-derived neighbours: once the
        site furniture is excluded from the graph, most guides simply do not
        cross-link. Rather than show nothing for the other 72%, fall back to a
        title similarity lookup against the quick index, which costs one extra
        FTS query and only runs when the stored list is empty.
        """
        rows = [dict(r) for r in self.con.execute(
            "SELECT d.id, d.title, d.importance, "
            "       (SELECT c.title FROM doc c WHERE c.id=d.context_id) AS context "
            "FROM related r JOIN doc d ON d.id = r.dst WHERE r.src=? "
            "ORDER BY r.rank LIMIT ?", (doc_id, limit))]
        if rows:
            for r in rows:
                r["source"] = "links"
            return rows
        return self._similar(doc_id, limit)

    def _similar(self, doc_id: int, limit: int) -> list[dict]:
        row = self.con.execute("SELECT title FROM doc WHERE id=?",
                               (doc_id,)).fetchone()
        if row is None:
            return []
        match = escape_query(row["title"], "OR")
        if not match:
            return []
        try:
            rows = self.con.execute(
                "SELECT d.id, d.title, d.importance, "
                "       (SELECT c.title FROM doc c WHERE c.id=d.context_id) AS context "
                "FROM fts_quick JOIN doc d ON d.id = fts_quick.rowid "
                "WHERE fts_quick MATCH ? AND d.id != ? "
                "ORDER BY bm25(fts_quick, 8.0, 1.0) LIMIT ?",
                (match, doc_id, limit)).fetchall()
        except sqlite3.DatabaseError:
            return []
        out = [dict(r) for r in rows]
        for r in out:
            r["source"] = "similar"
        return out


    def resolve(self, path: str) -> int | None:
        r = self.con.execute("SELECT id FROM doc WHERE path=?", (path,)).fetchone()
        if r:
            return r[0]
        r = self.con.execute("SELECT to_id FROM redirect WHERE from_path=?",
                             (path,)).fetchone()
        return r[0] if r else None

    def close(self) -> None:
        """Close this thread's handle.

        Other threads' handles are left alone -- there is no registry of them,
        and closing a connection another thread is mid-query on would be worse
        than leaking it. Process exit releases them; a codex is read-only, so
        there is nothing to flush.
        """
        con = getattr(self._local, "con", None)
        if con is not None:
            con.close()
            self._local.con = None
