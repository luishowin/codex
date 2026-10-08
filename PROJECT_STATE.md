# PROJECT_STATE.md

Current implementation state of Codex. Updated 2026-10-08 after the web-UI
rework (suggestion dropdown, permalinks, theme fix, metrics/foot removal).
The measured history and design rationale live in `README.md`; operating
commands in `START-GUIDE.html`; agent rules in `AGENTS.md`.

## What exists

- 13 built codexes in `data/`: 7,333,360 documents, 33.9 GB (core + deep).
  Full table with per-codex sizes: `START-GUIDE.html` section 08, or
  `curl http://127.0.0.1:8765/api/health` while the daemon runs.
- `art.db` in `data/`: 100 curated Wikimedia images, 227 bindings across 10
  codexes, served by the daemon without touching `codex/search.py`.
- Warm search daemon `app/codexd.py` (port 8765): quick + deep search, reader,
  stats, art serving. Verified working end to end on Linux after the
  migration (13 codexes loaded, 7,333,360 docs, search ~32 ms warm).
- Single-file web UI in `app/web/` (served by the daemon, no build step).
- `app/codexctl.py`: build from ZIM, info, search. `app/launcher.py`:
  Windows-only global hotkey overlay (pywebview + RegisterHotKey).
- `app/tools/`: calibrate, gaps, stats, try_hygiene, rebuild_deep, art_*
  (manifest/build/commons/subjects), milmed_ocr/milmed_build, attic (evidence
  probes, unmaintained by design).
- Portable layout introduced 2026-09-25: `app/` code, `data/` corpora,
  `scripts/{linux,macos,windows}` launchers, `_work/` generated files, docs at
  the root. All paths derive from `app/codex/paths.py` (`__file__`-relative);
  env overrides: `CODEX_DATA_DIR`, `CODEX_ART_DB`, `CODEX_WORK_DIR`,
  `CODEX_MILMED_DIR`, `TESSERACT_CMD`. Rollback record for the migration:
  `_work/migration_checkpoint_2026-09-25.md`.

## What works (verified 2026-09-25, re-verified 2026-10-08, Linux)

- Test suite: 138 passed, 0 skipped (`pytest app/tests/ -q`), run from a
  foreign CWD. Baseline before the migration was 99 passed / 27 skipped; the
  skips were tests that could not find `D:/codex` paths and now run against
  `data/`.
- `scripts/linux/start.sh`: starts the daemon, waits for health, opens the
  browser. `status.sh` and `stop.sh` verified against the live daemon.
- Daemon boot test in `tests/test_paths.py` starts a real daemon from
  `cwd="/"`, asserts the default art path resolves, and stops it again.
- `codexctl info` and `tools/stats.py` run from `/tmp` and `/` respectively.
- All 27 databases pass `PRAGMA integrity_check` post-move (26 codex cores +
  deeps, plus art.db; the 21 GB Wikipedia core took ~85 min and is clean).
- macOS and Windows launchers exist and are documented but were NOT executed
  (no such machines available). The PowerShell scripts follow the same
  lifecycle as the verified bash ones; treat them as untested until run once
  on real hardware.

## What is broken / known gaps

- Nothing regressed by the migration; no schema or behavior changes were made.
- Pre-existing (unchanged, see README "Not built yet"): embeddings unbuilt
  (`vec` empty); TUI and MCP server scaffolded only; StackExchange adapter
  missing; ready.gov leads carry the language-switcher furniture; per-source
  weighting in the `search_all` merge is wrong (small codexes lose to
  Wikipedia on their home turf; per-codex `&codex=` queries are correct);
  stopwords absent.
- Source ZIMs and `milmed/` artifacts are not on this Linux mount: ZIM builds
  and milmed rebuilds cannot run here until those inputs exist. Set
  `CODEX_MILMED_DIR` when they do.
- `app/launcher.py` is Windows-only and cannot be exercised on Linux.
- New 2026-10-08 UI has not been eyeballed in a browser (no screenshots
  taken): light-theme results/reader, dropdown over the home hero, and the
  ≤640 px brand fallback are code-verified only.

## Migration summary (2026-09-25)

- `codex from C drive/` -> `app/` (source), docs promoted to the root,
  Windows `.venv` deleted (user-approved), stale generated HTML docs deleted
  (user-approved), daemon logs moved to `_work/logs/`.
- 26 codex DBs + WAL/SHM siblings and `art.db` moved to `data/` as intact
  units while the daemon was stopped; total 33.9 GB, WAL files were all 0
  bytes at move time.
- `D:/codex`, `D:\milmed` and `C:\...` defaults replaced with
  project-relative resolution in codexd, codexctl, launcher, tools and tests.
  `tools/attic/` intentionally retains its historical strings.
- Added `app/codex/paths.py`, `app/tests/test_paths.py` (layout + no-legacy-
  paths + foreign-CWD + daemon boot tests), `scripts/` for all three OSes,
  `START-GUIDE.html` (self-contained, embedded fonts, OS detection).
- Docs updated: README (layout tree, install/build/use/tests commands),
  AGENTS (new paths + same rules), CLAUDE (retargeted to the new layout).

## Environment + UI session (2026-10-08, this mount)

 - No venv existed here and `start.sh` fell back to a bare system `python3`
   that lacked the deps (daemon died at import with `ModuleNotFoundError`).
   Created `<root>/.venv` with
   libzim/selectolax/zstandard/numpy/Pillow/pytest; daemon started from it
   (13 codexes, 7,333,360 docs, search verified live).
 - Web UI rework (`app/web/index.html`, plus `GET /read` in `app/codexd.py`):
   top-7 suggestion dropdown (always dark, title-only), results page only on
   commit (click/Enter); hits are `/read?codex=&id=` anchors (normal click
   in-page, middle-/modifier-click new tab); `#field`/`.hit`
   `max-width:1000px` centered with the brand pinned left (in-flow again
   under 640 px); removed `#metrics` (+`renderMetrics`), `#clear`, `#foot`
   (+`kbd`/`#statlink`), suggestion snippets; reader `.rwrap` 1500 / `.rd`
   1000 / `.toc` 220 px, TOC 9 px item padding, `Intro` entry active on load;
   theme toggle fixed (dark `body.results`/`body.stats` overrides scoped to
   `html[data-theme="dark"]`, hardcoded near-whites converted to theme
   vars); `#mode` border `#3c3c3c`; corpus line hidden while suggesting.
 - Docs: `START-GUIDE.html` (status.sh "not running" is expected pre-start;
   one-time `.venv` step in Quick start), `AGENTS.md` (interpreter
   resolution, `Codex-documents`/`codex-site` notes, `.venv` test command).
 - Verified: `node --check` on both page script blocks, `/read` → 200,
   `pytest` 138 passed.
 - Private GitHub repo `luishowin/codex` (main branch): code, scripts, docs
   pushed; the ~32 GB of film (`*.codex.db*`, `*.codex-deep.db*`,
   `art.db*`) is git-ignored, as are `.venv/` and `_work/`.

## v2 — A-Z browse (2026-10-09)

 - Alphabetical door beside ranked search: `idx_doc_title` expression index
   (`upper(substr(title,1,1)), title`) in `schema.py` `CORE_INDEXES`,
   `Searcher.browse()` (index-backed, keyset `after` paging, `#` bucket for
   non-A-Z initials), `GET /api/browse` merged across rolls in `codexd.py`,
   A–Z strip in the canvas reusing hit rows (keyboard, Enter-to-open,
   permalinks, new-tab all work unchanged; clicking the active letter
   restores the ranked search).
 - One-time migration: index built on all 13 cores with the daemon stopped
   (wikipedia 7.08M rows in 74 s); new builds get it automatically.
   Measured: covering-index plan, B/S pages ~4 ms, `#` ~260 ms.
 - Graph decision (from the BM25-only comparison): ranking metadata stays.
   Pure-BM25 top-1 is a stub on broad queries (`Photosynthesis(board
   game)`, `Black Holes(album)`); blend + 6× title boost restores the
   canonical article. Known wrinkle kept: importance can overturn aboutness
   on small corpora (`spudger` → Bose guide above the spudger page).
 - Tests: `app/tests/test_browse.py` (5 tests); suite 143 passed.

## Next

## Next

1. Re-verify `scripts/windows/*.ps1` and `scripts/macos/*.sh` once on real
   hardware.
2. Per-source weighting in the search merge (the known ranking gap).
3. Embeddings (bge-small via onnxruntime) if a CPU-bound subset is acceptable.
4. A StackExchange Q&A adapter, then a ready.gov subclass for the lead junk.
5. Consider git init + Git LFS (or a data/ exclusion) if the project ever
   becomes version-controlled; `.gitignore` documents the intent.
