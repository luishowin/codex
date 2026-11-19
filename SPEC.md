# SPEC — film format v1, projector API v1

Frozen. Additive changes only: new tables, columns, endpoints, and JSON keys
may appear; existing ones never change meaning, and `/read` permalinks never
break. A canvas written against this document keeps working.

## 1. Film

Plain SQLite, no extensions. One corpus = one core file, plus an optional
deep file. A third file, `art.db`, is shared by every corpus and never
ATTACHed.

### 1.1 Core (`NAME.codex.db`) — self-sufficient

| table | columns |
|---|---|
| `codex_meta` | `key TEXT PK, value TEXT` (title, source_zim, zim_date, built_at, words, zstd_level, body_codec (`zlib` once transcoded; absent means v1 zstd), schema_version, adapter, language, source_bytes, …) |
| `zdict` | `id INTEGER PK, dict BLOB` (zstd dictionaries; `doc.dict_id` → `zdict.id`) |
| `doc` | `id PK, path TEXT, title TEXT, kind INTEGER, importance REAL, in_degree INTEGER, word_count INTEGER, lead TEXT, body BLOB, meta TEXT (JSON), dict_id INTEGER, context_id INTEGER → doc.id, flags INTEGER` |
| `redirect` | `from_path TEXT PK, to_id INTEGER → doc.id` (title aliases) |
| `related` | `src, dst, rank INTEGER, PK(src, rank)` WITHOUT ROWID (top-12 outbound neighbours by PageRank mass) |

Indexes: `idx_doc_path ON doc(path)` UNIQUE, `idx_doc_importance ON
doc(importance DESC)`, `idx_doc_title ON doc(upper(substr(title,1,1)), title)`.
`fts_quick`: FTS5 `(title, lead)`,
`content='doc'`, `tokenize='porter unicode61 remove_diacritics 2'`.

`kind`: 0 article, 1 guide, 2 device (context anchor: books, device pages),
3 category. `flags` bit 0: text referred to pictures the archive couldn't
supply (kept verbatim, shown with a warning).

`doc.body`: zlib level 6 compressed JSON sections (prose `{h?, t}`, tables
`{h?, k:'table', headers[], rows[][]}`). Pre-2.0 v1 film used zstd with the
`zdict` dictionary; this projector no longer reads it — transcode first
(decompress with dict `zdict[1]`, recompress, set
`codex_meta.body_codec='zlib'`).
`doc.lead`: plain text, readable without decompressing. `doc.meta`: optional
JSON (infobox/tools, source-dependent).

Read mode: WAL, `query_only=1`. Readers need SQLite + zstd only.

### 1.2 Deep (`NAME.codex-deep.db`) — optional

ATTACHed as `deep` when present; absent file only disables full-text depth.
`fts_deep`: FTS5 `(text)`, `content=''`, `detail=full` (lesser detail levels
cannot rank — measured), same tokenizer. `vec`: `doc_id PK, bits BLOB`
(binary-quantised embeddings; empty until built).

### 1.3 `art.db` — optional, shared

`art(id PK, slug UNIQUE, subject, discipline, width, height, hero BLOB,
thumb BLOB, source_mime, artist, credit, licence, licence_url, source_file,
source_url, description, fetched_at)`, `binding(codex, doc_id → art_id,
PK(codex, doc_id))` WITHOUT ROWID. Served, never joined into search.

## 2. Projector API v1

Base: `http://127.0.0.1:8765` (host/port configurable; no auth — trusted
networks only). Every JSON response is UTF-8. Error shape:
`{"error": "..."}` with the HTTP status.

| method | path | params | returns |
|---|---|---|---|
| GET | `/`, `/index.html`, `/read` | `/read` takes `?codex=&id=` and opens the reader | the canvas shell (HTML) |
| GET | `/static/<path>` | — | canvas assets (never outside `app/web/`) |
| GET | `/api/health` | — | `{"ok", "api": 1, "codexes": [codex…], "hidden": [names], "shelf": path, "art": {images, bindings, bytes} \| null}` |
| GET | `/api/library` | `all? (0/1)` | `{schema, generated_at, generated_by, note, cassettes: [manifest…]}` — the shelf currently served; `all=1` adds every roll in the data directory, loaded or not |
| GET | `/api/search` | `q, n (1–100), deep (0/1), codex?` | `{hits, total, capped, per_codex, weights, ms, deep, q}` |
| GET | `/api/browse` | `prefix (A–Z or #), n (1–200), after?, codex?` | `{hits, prefix}` (titles in order) |
| GET | `/api/index` | `codex`, `prefix? (A–Z or #)`, `after?`, `n (1–500)`, or `codex, root=<doc id>` | `{codex, mode: contents\|flat, letter, letters, total, sections, unit, items}`; with `root`: `{codex, root, ordered: "id", items}` |
| GET | `/api/shelf` | `letter (A–Z or #)` | `{letter, items: [{subject, discipline, slug, thumb_url, codex, doc_id}]}` |
| GET | `/api/doc` | `codex, id` | `{id, path, title, kind, importance, in_degree, word_count, context, context_id, nav, lead, sections, meta, related, codex}` |
| GET | `/api/art` | `codex+id` or `slug` | credit record + `hero_url`/`thumb_url` |
| GET | `/art/<slug>[.thumb].webp` | — | image bytes, immutable cache headers |
| POST | `/api/load` | `path` (file or glob) | `{loaded: [names], codexes: [...]}` |
| POST | `/api/unload` | `codex` | `{unloaded, codexes: [...]}` or 404 |

`/api/index` reports a codex's shape. `mode: "contents"` means the film has
`kind=2` containers (manuals, courses, devices) and should be browsed as a
table of contents; `"flat"` means the alphabetical `/api/browse` is the right
door. In contents mode `items` are top-level containers in shelf order —
case-insensitive, A–Z, with everything else under `#` last. With no `prefix`
the **whole shelf** is returned, paged by `after`; that is what the canvas
renders, because a codex of books is read as one list with letter headings, not
filtered by letter. `prefix` still narrows to one initial for any client that
wants it. `root=<id>` returns one container's direct children in
**`id` order** — the order the source was read, which is page order for the PDF
manuals and curriculum order for libretexts — each again carrying `children` so
the client can descend. The relation is only ever followed downward: container
graphs are not guaranteed acyclic (libretexts and iFixit both contain loops),
and nothing walks up. `unit` is presentation only (`book`, `device`, `entry`).

`/api/browse` is unchanged, including its meaning for flat codexes.

`nav` is present when the document belongs to a container: `{position, total,
prev, next}`, with `prev`/`next` as `{id, title} | null` and the order being the
container's `id` order (the same order `/api/index?root=` returns). It is what
lets a reader move through a manual section by section; flat documents have
`nav: null` and `context_id: null`.

Hit shape: `{id, path, title, importance, kind, context, score, snippet,
tier, relaxed, codex, art?, also?}`. `also` appears when another codex carries
a page with the same title: the page is returned once, and `also` names the
others as `[{codex, id}]`. `total` counts up to a 1,000 cap, then
`1,000+` (`capped: true`) — counts are floors, not exact. `related` entries:
`{id, title, importance, context, source: 'links'|'similar'}`.

`/api/search` fuses the per-codex pages (`codex/merge.py`): each hit's `score`
is multiplied by a source weight derived from how specialised that codex is for
the query (the share of its titles that mention the terms, requiring a cluster
of at least three), then titles are de-duplicated. `weights` reports what was
applied, so a ranking result is explainable after the fact. An explicit
`&codex=` query uses one codex and therefore gets neutral weights (1.0).

Promises: v1 responses only gain keys; `codex` names are the filenames;
unloading never touches other rolls; missing `art.db`/deep files degrade to
fewer pictures/depth, never errors.

`/api/library` manifests are **shelf** manifests: `sealed` is false, every
`sha256` is null until a pack step computes it, and `cassette_id` is prefixed
`shelf-`. They describe film that exists, and never claim a digest. `hidden`
in `/api/health` names rolls present on disk but kept off the shelf by
`data/shelf.json`; an explicit `--codex` is never filtered.

## 3. Cassettes (manifest v1) — format specified; shelf manifests served

A cassette is a **self-describing directory**, not one archive file: the
largest core is over 24 GB, and FAT32 refuses files above 4 GB. The volume
root is the cassette:

```
CODEX-CASSETTE/
  cassette.json            manifest (below)
  cover.svg                generated cover, no raster dependency
  film/<name>.codex.db     core, clean (VACUUM INTO, never a live WAL copy)
  film/<name>.codex-deep.db   optional
  film/art.db              optional subset: only rows bound to this codex
  SHA256SUMS               sha256sum -c compatible, one line per file
  ATTRIBUTION.txt          corpus licence and source, for sharing
```

`cassette.json`:

| key | type | meaning |
|---|---|---|
| `schema` | int | `1` |
| `cassette_id` | string | stable identity of the physical cassette (ULID) |
| `name` | string | film name; equals the `*.codex.db` stem |
| `title` | string | display title (from `codex_meta.title`) |
| `issue` | string | `YYYY.MM`, the label on the spine |
| `created_at` | string | ISO-8601, when the cassette was sealed |
| `created_by` | string | a person, not `built_by: codexctl` |
| `contents` | object | `documents, words, language, adapter, source, source_date, schema` |
| `film` | array | `[{role: core\|deep, file, bytes, sha256}]` |
| `cover` | object | `{hero_slug, subject, palette}`; `palette` is one of ink, ember, moss, slate, wine, sand |
| `licence` | object | `{name, url, note}` |
| `manifest_sha256` | string\|null | digest of this manifest with the field itself blanked |
| `sealed` | bool | `false` for a shelf manifest; `true` once packed |

Rules:

- `sha256` is either a lowercase hex digest of the file or `null`. **Never
  fabricated.** A digest over 2 GB is computed once at pack time and cached.
- Writers checkpoint first: `VACUUM INTO` produces the shipped core. No
  `-wal` or `-shm` sibling is ever written to a cassette.
- `role: deep` is optional; a cassette without it reads, with less depth.
- Readers ignore unknown keys, so this section can gain fields.
- Verification, import and return are the library service's job; the
  manifest is the contract they share. `GET /api/library` now serves shelf
  manifests built by `app/codex/cassette.py`; `app/web/mock/library.json`
  (written by `app/tools/mock_library.py` through the same builder) remains
  only as the offline fallback when the canvas is opened without a daemon.

