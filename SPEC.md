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
| GET | `/api/health` | — | `{"ok", "api": 1, "codexes": [codex…], "art": {images, bindings, bytes} \| null}` |
| GET | `/api/search` | `q, n (1–100), deep (0/1), codex?` | `{hits, total, capped, per_codex, ms, deep, q}` |
| GET | `/api/browse` | `prefix (A–Z or #), n (1–200), after?, codex?` | `{hits, prefix}` (titles in order) |
| GET | `/api/shelf` | `letter (A–Z or #)` | `{letter, items: [{subject, discipline, slug, thumb_url, codex, doc_id}]}` |
| GET | `/api/doc` | `codex, id` | `{id, path, title, kind, importance, in_degree, word_count, context, lead, sections, meta, related, codex}` |
| GET | `/api/art` | `codex+id` or `slug` | credit record + `hero_url`/`thumb_url` |
| GET | `/art/<slug>[.thumb].webp` | — | image bytes, immutable cache headers |
| POST | `/api/load` | `path` (file or glob) | `{loaded: [names], codexes: [...]}` |
| POST | `/api/unload` | `codex` | `{unloaded, codexes: [...]}` or 404 |

Hit shape: `{id, path, title, importance, kind, context, score, snippet,
tier, relaxed, codex, art?}`. `total` counts up to a 1,000 cap, then
`1,000+` (`capped: true`) — counts are floors, not exact. `related` entries:
`{id, title, importance, context, source: 'links'|'similar'}`.

Promises: v1 responses only gain keys; `codex` names are the filenames;
unloading never touches other rolls; missing `art.db`/deep files degrade to
fewer pictures/depth, never errors.
