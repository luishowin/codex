"""The codex on-disk format.

Deliberately plain SQLite. There is no custom container, no proprietary framing
and no compiled extension requirement: any SQLite binding in any language can
open a codex and read it. The only thing a reader needs to know beyond standard
SQL is that `doc.body` is zstd-compressed JSON, and the dictionary it was
compressed with lives in `zdict`.

Layout is split across two files:

  codex.db       documents, lead text, quick title/lead index.
                 Self-sufficient: copy this alone to a USB stick and it works.
  codex-deep.db  full-body FTS and embedding vectors. ATTACHed when present.

A codex stores no raster images, by decision rather than omission. Kiwix
downsamples aggressively: sampled across `wikipedia_en_all_maxi` the median
image is 0.05 MP and not one of 220 reached 2 MP, and iFixit's are ~300x225.
At that quality they cost gigabytes and answer nothing, and the archives cannot
supply better. What survives is text, tables, and formulas as LaTeX.
"""
from __future__ import annotations

import sqlite3

SCHEMA_VERSION = 1

# --- core file -------------------------------------------------------------

CORE_SQL = """
CREATE TABLE IF NOT EXISTS codex_meta (
    key   TEXT PRIMARY KEY,
    value TEXT
);

-- Trained zstd dictionaries. Small documents share one so that compression has
-- a real context to work with; per-document zstd wastes most of its window.
CREATE TABLE IF NOT EXISTS zdict (
    id   INTEGER PRIMARY KEY,
    dict BLOB NOT NULL
);

CREATE TABLE IF NOT EXISTS doc (
    id         INTEGER PRIMARY KEY,
    path       TEXT    NOT NULL,          -- original ZIM path: stable identity
    title      TEXT    NOT NULL,
    kind       INTEGER NOT NULL DEFAULT 0,
    importance REAL    NOT NULL DEFAULT 0.0,
    in_degree  INTEGER NOT NULL DEFAULT 0,
    word_count INTEGER NOT NULL DEFAULT 0,
    lead       TEXT,                      -- plain: previewed without decompressing
    body       BLOB,                      -- zstd(dict) of JSON [{h,t},...]
    meta       TEXT,                      -- optional JSON (infobox, tools, ...)
    dict_id    INTEGER REFERENCES zdict(id),
    -- Disambiguation. 1,028 iFixit titles are shared by 2,343 documents
    -- ("Safety Precautions" x42) and the pages carry no breadcrumb, no device
    -- link and no meta tag naming their parent. The only available signal is
    -- the reverse one: which device page links here. Filled in pass 2.
    context_id INTEGER REFERENCES doc(id),
    -- Bitfield. Bit 0 (FLAG_IMAGE_DEPENDENT): the text contains an instruction
    -- that genuinely relied on a picture we no longer carry. Those sentences
    -- are kept verbatim rather than mangled, and flagged so the loss is visible
    -- instead of silent.
    flags      INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS redirect (
    from_path TEXT PRIMARY KEY,
    to_id     INTEGER NOT NULL REFERENCES doc(id)
);

-- Staging only. Redirect targets are paths at extraction time and cannot be
-- resolved to ids until every document has one. Dropped at the end of pass 2.
CREATE TABLE IF NOT EXISTS redirect_raw (
    from_path TEXT PRIMARY KEY,
    to_path   TEXT NOT NULL
) WITHOUT ROWID;

-- Top-N outbound neighbours by PageRank mass. The full edge list is discarded
-- after ranking; persisting ~500M edges would dwarf the corpus itself.
CREATE TABLE IF NOT EXISTS related (
    src  INTEGER NOT NULL,
    dst  INTEGER NOT NULL,
    rank INTEGER NOT NULL,
    PRIMARY KEY (src, rank)
) WITHOUT ROWID;

"""

CORE_INDEXES = """
CREATE UNIQUE INDEX IF NOT EXISTS idx_doc_path       ON doc(path);
CREATE        INDEX IF NOT EXISTS idx_doc_importance ON doc(importance DESC);
"""

# doc.flags bits
FLAG_IMAGE_DEPENDENT = 1 << 0

# fts_quick mirrors doc(title, lead) as an external-content index, so snippet()
# and highlight() work natively without a second copy of the text.
FTS_QUICK_SQL = """
CREATE VIRTUAL TABLE IF NOT EXISTS fts_quick USING fts5(
    title, lead,
    content='doc', content_rowid='id',
    tokenize='porter unicode61 remove_diacritics 2'
);
"""

# --- deep file -------------------------------------------------------------

# Contentless, but with full detail. `content=''` is what keeps a second copy of
# the text out of the file; `detail` is a separate axis and it is not optional
# here, because bm25() needs term frequencies to exist.
#
# Measured over 68,871 real articles, ranking a 200-hit result:
#   detail=none     33.8 MB   every bm25() is -0.0   -> matches, cannot rank
#   detail=column   73.2 MB   every bm25() is -0.0   -> matches, cannot rank
#   detail=full    147.8 MB   200 distinct values    -> ranks properly
#
# detail=none was chosen for size and it silently made the deep tier unrankable:
# every hit scored zero, so results came back in whatever order the title
# heuristics broke ties. Snippets still come from the decompressed body.
DEEP_SQL = """
CREATE TABLE IF NOT EXISTS deep_meta (
    key   TEXT PRIMARY KEY,
    value TEXT
);

CREATE VIRTUAL TABLE IF NOT EXISTS fts_deep USING fts5(
    text,
    content='',
    tokenize='porter unicode61 remove_diacritics 2'
);

-- Binary-quantised embeddings: 384 dims packed to 48 bytes. A flat Hamming scan
-- over these is fast enough that an ANN index is not worth its own size.
CREATE TABLE IF NOT EXISTS vec (
    doc_id INTEGER PRIMARY KEY,
    bits   BLOB NOT NULL
);
"""

# --- pragmas ---------------------------------------------------------------

BUILD_PRAGMAS = (
    ("journal_mode", "OFF"),
    ("synchronous", "OFF"),
    ("temp_store", "MEMORY"),
    ("cache_size", "-1048576"),   # ~1 GiB, leaves headroom on a 16 GB box
    ("locking_mode", "EXCLUSIVE"),
)

READ_PRAGMAS = (
    ("journal_mode", "WAL"),
    ("synchronous", "NORMAL"),
    ("temp_store", "MEMORY"),
    ("cache_size", "-131072"),    # ~128 MiB
    ("query_only", "1"),
)


def apply_pragmas(con: sqlite3.Connection, pragmas) -> None:
    for k, v in pragmas:
        try:
            con.execute(f"PRAGMA {k}={v}")
        except sqlite3.DatabaseError:
            # locking_mode/query_only are not always settable mid-connection;
            # none of them are required for correctness.
            pass


def open_core(path: str, build: bool = False) -> sqlite3.Connection:
    con = sqlite3.connect(path, isolation_level=None)
    apply_pragmas(con, BUILD_PRAGMAS if build else READ_PRAGMAS)
    return con


def init_core(con: sqlite3.Connection) -> None:
    con.executescript(CORE_SQL)


def init_core_indexes(con: sqlite3.Connection) -> None:
    """Deferred until after bulk load - building these up front costs 2-3x."""
    con.executescript(CORE_INDEXES)


def init_fts_quick(con: sqlite3.Connection) -> None:
    con.executescript(FTS_QUICK_SQL)


def init_deep(con: sqlite3.Connection) -> None:
    con.executescript(DEEP_SQL)


def set_meta(con: sqlite3.Connection, table: str = "codex_meta", **kw) -> None:
    con.executemany(
        f"INSERT INTO {table}(key, value) VALUES(?, ?) "
        f"ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        [(k, "" if v is None else str(v)) for k, v in kw.items()],
    )


def get_meta(con: sqlite3.Connection, table: str = "codex_meta") -> dict[str, str]:
    try:
        return dict(con.execute(f"SELECT key, value FROM {table}").fetchall())
    except sqlite3.DatabaseError:
        return {}
