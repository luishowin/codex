# PROJECT_STATE.md

## Family reader checkpoint · 2026-11-24

The Wikipedia specimen is approved for reading quality. The family web reader
opens portable multi-book cassettes and the existing reference shelf at
`/reader`. Its library follows the supplied home-page design. Articles use
serif prose, local fonts and edition-specific bookmarks and amendment requests.

The review cassette contains 19 Wikipedia entries from the June 2026 archive
and a separate tea specimen. Browser checks covered desktop and phone layouts,
keyboard use, search, offline glyphs, exports, printing, cassette removal,
reinsertion and saved locations across restarts. The Python suite passed
241 tests before the final visual changes, which were checked in the browser.

The pilot reconciled 1,536 sampled archive entries and included 593 articles.
Across 585 matched articles, candidate compressed bodies used 2.56 times the
existing body space. The 30 GiB combined target remains a preference. Next,
integrate the approved format into the production streaming builder and rerun
the same pilot before starting a full build. See [the reader guide](READER.md)
for reproduction commands, format details and measurements.

Current implementation state of Codex. Updated 2026-11-20 after the shelf
repair (container contents, cross-codex merge, capture hygiene, book
navigation, stamped client state, `/api/library`).
The measured history and design rationale live in `README.md`; operating
commands in `START-GUIDE.html`; agent rules in `AGENTS.md`.

## Where things are

| file | owns |
|---|---|
| `app/codex/paths.py` | every path; `data/shelf.json` policy; merge weights |
| `app/codex/{ingest,build,graph,index,schema}.py` | film production |
| `app/codex/{adapters,artifacts,hygiene,model}.py` | extraction and the artefact rules |
| `app/codex/search.py` | ranking **inside** one codex, `structure/contents/children`, `nav` |
| `app/codex/merge.py` | fusing codexes: specialisation weights, title dedupe |
| `app/codex/cassette.py` | SPEC §3 manifests (shelf + fixture) |
| `app/codex/art.py` | image store, bindings, hit annotation |
| `app/codexd.py` | the only HTTP surface (`/api/*`, `/read`, `/static`, `/art`) |
| `app/web/` | canvas: one shell for browser and desktop |
| `app/tools/audit.py` | the scorecard — run it before and after any rebuild |
| `app/tools/` (rest) | calibrate, gaps, stats, try_hygiene, rebuild_deep, art_*, milmed_* |

Film is `data/*.codex.db` + optional `*.codex-deep.db`; `art.db` is shared and
never ATTACHed; `data/shelf.json` decides what is loaded (film stays on disk).
Pre-rebuild backups of the 2026-11-20 rolls: `_work/pre-rebuild-2026-11-20/`.

## What exists

- 13 built codexes in `data/`: 7,333,360 documents built, 35 GB (core + deep).
  **10 are on the shelf**: 7,259,704 documents, 33.77 GB served.
  `data/shelf.json` keeps the three Wikipedia subsets on disk but unloaded
  (see "Shelf + library service" below).
  Full table with per-codex sizes: `START-GUIDE.html` section 08, or
  `curl http://127.0.0.1:8765/api/health` while the daemon runs.
- `art.db` in `data/`: 100 curated Wikimedia images, 227 bindings across 10
  codexes, served by the daemon without touching `codex/search.py`.
- Warm search daemon `app/codexd.py` (port 8765): quick + deep search, reader,
  contents, library, stats, art serving. Verified end to end on Linux
  (10 shelf rolls, 7,259,704 docs, search ~20-50 ms warm).
- Canvas in `app/web/`: `index.html` shell + SVG sprite, `codex.css` tokens,
  `app.js` router/chrome/search, `views/` per-screen modules, local fonts,
  `mock/library.json` fixture. No build step, no CDN.
- `app/codexctl.py`: build from ZIM, info, search. `app/launcher.py`:
  Windows-only global hotkey overlay (pywebview + RegisterHotKey).
- `app/tools/`: calibrate, audit, gaps, stats, try_hygiene, rebuild_deep, art_*
  (manifest/build/commons/subjects), milmed_ocr/milmed_build, attic (evidence
  probes, unmaintained by design).
- Portable layout introduced 2026-09-25: `app/` code, `data/` corpora,
  `scripts/{linux,macos,windows}` launchers, `_work/` generated files, docs at
  the root. All paths derive from `app/codex/paths.py` (`__file__`-relative);
  env overrides: `CODEX_DATA_DIR`, `CODEX_ART_DB`, `CODEX_WORK_DIR`,
  `CODEX_MILMED_DIR`, `TESSERACT_CMD`. Rollback record for the migration:
  `_work/migration_checkpoint_2026-09-25.md`.

## What works (verified 2026-09-25, re-verified 2026-10-08, Linux)

- Test suite: 161 passed, 0 skipped (`pytest app/tests/ -q`, 2026-11-15), run
  from a foreign CWD. 138 of these predate the canvas rework; the twelve new
  ones pin the canvas (offline assets, import graph, fixture vs SPEC §3).
  Baseline before the migration was 99 passed / 27 skipped; the
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
 - Curated shelf: `ArtStore.shelf()` (reverse binding map, wikipedia
   preferred, links restricted to loaded rolls so every card opens),
   `GET /api/shelf`, Featured row atop each browse letter (thumbnail cards
   to `/read` permalinks; empty letters hide the row). Verified live
   (H → 8 cards); `test_art.py` +3 shelf tests, suite 146 passed.

## v2 — stdlib projector, funnel, recipe (2026-10-09, in progress)

 - Runtime is zstd-free: bodies zlib-6 everywhere (measured +7.5% on long
   prose, smaller on short docs; cores 22.3 → 23.0 GB), writers
   flipped (`build.py`, `milmed_build.py`, `--compress-level`), pass-0 dict
   training deleted, `search.py`/`index.py` zlib-only. Fence:
   `requirements-build.txt` (build-only deps) +
   `tests/test_stdlib_runtime.py` (transitive closure from `codexd.py`,
   green). `try_hygiene.py` repaired to read through `Searcher`.
 - Funnel: `codex/ingest.py` (`ZimIngester`, `MarkdownIngester`, path-identity
   contract), `build_stream` + shared `finish_build` in `build.py`
   (`_extract_one` moved, deferred graph/index imports documented),
   `codexctl build <dir>` auto-routes to markdown, `index.build_deep`
   reads the codec from core meta. Proof: `test_funnel.py` builds 3 linked
   markdown docs hermetically (graph edges resolve, search/browse/get work).
   `milmed_build` flipped to zlib but not yet an ingester (tools→codex
   layering); `calibrate.py` still projects in zstd ratios.
 - Recipe: README "Fresh machine" (system python3 serves, venv only for
   building), guide/AGENTS reframed the same way.
 - Migration state: COMPLETE. All 13 rolls zlib (`body_codec=zlib`, 0
   zstd-magic rows in a full wikipedia scan). wikipedia: 20.5 → 22.6 GB core
   after transcode + VACUUM (+10%); shelf cores 22.3 → 23.0 GB. Daemon
   served all 13 rolls from the stock interpreter (no zstandard installed:
   import fails, daemon up, search/doc/browse verified). Daemon currently
   STOPPED (killed 2026-10-09); transcode backups deleted. Suite 149 green.

## Canvas rework (2026-11-15)

 - New canvas built from the Essential OS reader study (`codex.html`): one
   window, top bar with menubar + one search field, home, article reader,
   library, cassette detail, search results, A–Z browse, settings, side sheet
   (contents / saved / history), find-in-article, menus, toasts, dialogs.
 - Replaces the 1,207-line single-file page with `codex.css` + `app.js` +
   `views/*.js` ES modules. Hash routes, so a plain page, a Tauri window and
   `/read?codex=&id=` permalinks all work. `/read` verified in headless
   Chrome (article opens straight from the URL).
 - Serif is the system stack; measured on this Fedora 45 box: no Palatino,
   no P052, no Georgia, no Old Standard — resolves to Liberation Serif.
   Inter ships locally (`xVf.woff2`); the `fonts.googleapis.com` link is gone,
   so the canvas has no external reference (pinned by `test_web_assets.py`).
 - Library reads `/api/library` (see "Shelf + library service"); the fixture in
   `app/web/mock/library.json` is only the no-daemon fallback, written by
   `app/tools/mock_library.py` through the same `codex.cassette` builder.
 - Covers are typographic SVG from the manifest (palette + masthead + contents
   + creator). No hero image: art.db's auto-picker misfires, and a wrong
   picture on a cover is worse than none.
 - Cassette manifest frozen in `SPEC.md` §3; the fixture follows it. SHA-256
   is real below 2 GB and `null` above (never fabricated). Pack/verify/import/
   return are specified, not built.
 - Browser-verified flows (headless Chrome + CDP): popover search, full-text
   toggle, results page, article + infobox + related + hero, contents sheet
   with 33 entries, saved articles, history, find-in-article counts, File
   menu, library → cassette detail, `/` focus. Light and dark, 1280×900 and
   420×820.
 - Suite: 161 passed, including 12 canvas tests.

## Shelf + library service (2026-11-19)

 - **Measured redundancy, not a feeling.** Joined every roll's `path` against
   the full Wikipedia roll: `wikipedia-100` is 102/102 (100%) contained,
   `wikipedia-climate` 3,725/3,733 (99.8%), `wikipedia-medicine`
   68,500/68,871 (99.5%). Wikipedia alone is ~96% of the shelf. A second,
   different redundancy shows in results: duplicate titles *within* ready.gov
   (6–7× "Hurricane season preparedness digital toolkit") and between
   wikipedia-medicine and wikipedia — the merge does not dedupe by title yet.
 - **Decision: a subset roll is redundant next to its superset, legitimate as
   a standalone cassette.** So they are hidden, never deleted; `wikipedia-100`'s
   source ZIM (`wikipedia_en_100_maxi_2026-04.zim`) is already gone, so it can
   never be rebuilt.
 - `data/shelf.json` + `paths.hidden_rolls()` + `codexd.discover()`: hidden
   rolls are not loaded, not searched, not listed. `CODEX_HIDDEN` overrides for
   tests; an explicit `--codex` is never filtered. `/api/health` reports
   `hidden` and the shelf file so "missing" and "hidden" cannot be confused.
 - `GET /api/library` is real: `app/codex/cassette.py` builds SPEC §3 shelf
   manifests from `codex_meta` + `stat`. Default = the loaded set; `?all=1`
   adds every roll in `data/`. `sealed: false`, all `sha256` null, ids prefixed
   `shelf-`. `app/tools/mock_library.py` now calls the same builder, so the
   fixture cannot describe a shelf the daemon would not serve.
 - The 51 s trap: summing `word_count` over 7M rows on a cold USB cache. The
   daemon seeds the summary cache from its own load counts; default library is
   ~11 ms, `?all=1` ~0.95 s cold / ~7 ms cached.
 - Canvas verified in a browser: home and library show 10 cassettes
   (7,260,654 docs, 33.8 GB), cassette detail says "Shelf manifest … nothing
   sealed / no digest", search returns 87 results in 53 ms, no console errors.
 - Suite: 177 passed (161 + 16 new in `tests/test_library_api.py`).
 - Still mock-free but not finished: there is no "insert cassette" action in
   the canvas yet (`POST /api/load` exists), and pack/verify/import remain
   unbuilt.

## Merger + ranking (2026-11-19, same session)

 - **The pinned failures are fixed, measured live.** `javascript promise` →
   `mdn` *Using the Fetch API* first (weight 4.0) with Wikipedia at 1.04;
   `hurricane evacuation kit` → `ready-gov` *Hurricane Season Preparedness
   Digital Toolkit* first (4.0); `diabetes` still MedlinePlus first, `iphone
   battery` still iFixit first, `tourniquet` still Wikipedia first (every codex
   has one matching title, so the signal has no opinion — `MIN_TITLES = 3`).
 - **Mechanism:** `codex/merge.py` weights each codex by title-share
   specialisation for the query, not by a per-source table. Probe cost measured
   at 0.4–0.6 ms on the full Wikipedia roll; per-query totals 13–30 ms warm
   (Wikipedia's own quick search is 45–58 ms of that).
 - **Dedupe:** titles are fused by normalised title. Within one codex a repeat is
   dropped (ready.gov's "Home Safety" ×7 → 1); across codexes the page is kept
   once and labelled `also` (e.g. Wikipedia's *Photosynthesis* + wikiversity's).
   Measured on 8 queries: 5 duplicate rows removed from the top-12 pages, 2 hits
   annotated. The UI shows `· also in <codex>`.
 - **Override knob:** `data/shelf.json` → `weights` multiplies the derived weight
   (empty by default; non-positive/non-finite values ignored). Loaded at boot.
 - **RRF was measured and rejected.** With a per-codex quota, reciprocal-rank
   fusion put "ifixit: iPad microphone" first for `javascript promise` and
   "Air Fryer" first for `antibiotic resistance`, because it discards relevance
   magnitude. Recorded so nobody re-tries it without reading the numbers.
 - Suite: 189 passed (177 + 12 in `tests/test_merge.py`).

## Contents view: browse by container (2026-11-20)

 - **The bug was browse, not the film.** `military-medicine` is 22 manuals +
   1,125 sections; every section names its manual in `context_id` and every
   container is `kind=2`. Browsing flattened and sorted by title, so all of
   "APPENDIX 1..9" (ids 940-950, inside *Division and Brigade Surgeons'
   Handbook*) piled up under A and ten books fractured into one list.
 - **Measured shape:** milmed 22 roots / 1,125 sections; libretexts 22 / 20,862
   with 847 nested containers; iFixit 1,582 / 78,489 with 22,207 nested;
   wikipedia, wikiversity, wikivoyage, ready-gov, medlineplus, mdn,
   nhs-medicines = 0 containers, so their A–Z is unchanged.
 - `Searcher.structure()` / `contents()` / `children()`: roots in title order
   (A–Z door applies to *books*), children in **id order** (page/curriculum
   order). `/api/index` exposes both; `/api/browse` untouched.
 - **Loops are real:** libretexts 1814 ↔ 20201, iFixit Linux → Android →
   BeagleBone → Kali → Debian → Linux. Only downward expansion is used; the
   canvas caps visual depth at 6 and never walks up.
 - **No `kind` index, no rebuild.** `WHERE kind=2` is instant when containers
   start at id 1 (milmed, iFixit) or 39 (libretexts) and measured **48 s** on
   the 21 GB Wikipedia roll, which has none. The probe is bounded at 0.5 s;
   timeout = flat, which is the same answer the scan would give.
 - Canvas: `views/browse.js` asks `/api/index` first; `contents` renders the
   shelf with per-letter counts (empty letters disabled, opens on the first
   non-empty — B for milmed), rows expand in place, `#/browse/<codex>/<letter>/<root>`
   deep-links an open book. Enter on a container toggles rather than navigating
   (`openResult` honours `toggle`). Browser-verified: 42 rows for the D shelf
   with the appendices at positions 27-37, i.e. after the chapters; ready-gov
   still "56 titles starting with A", no console errors.
 - Suite: 200 passed (189 + 11 in `tests/test_contents.py`).

## One-page contents + shelf scorecard (2026-11-20)

 - **Contents mode lists the whole shelf.** No letter filter: 22 books for
   military-medicine on one page in title order, letter headings inside the
   list, 1,582 devices for iFixit paged from the API into the same list. Flat
   codexes keep the A–Z (there the alphabet is the index). `contents()` with no
   prefix now returns every root; `prefix` still narrows.
 - **Order bug found on the way:** SQLite's byte-order `ORDER BY` put every
   lowercase title after "Z", so iFixit's shelf re-opened the alphabet halfway
   down ("# A…Z B E F I J…"). Roots are now sorted in Python by
   `(is A-Z, casefold, title)`, keyset paging compares the same key, and the
   shelf reads A–Z then # once.
 - **`app/tools/audit.py`** — the scorecard that makes repair codex-by-codex.
   5.4 s for the whole shelf, sampled at 200k rows for wikipedia. Measured
   findings: MDN 123 replay shells + 149 off-host (only 1,082 of 1,231 are real
   pages); ready.gov 1,688 furniture leads (84%); libretexts 1,105 thin docs and
   heavy title repeats; medlineplus 295 furniture leads and 1,818 short ones;
   military-medicine structurally clean (22 anchors, 1,125 sections, 0 drops).
 - **Two false positives were caught by the tool's own tests** and fixed before
   it could justify anything: article paths like `1._Lig` are not hosts (they
   made Wikipedia report 82 phantom off-site pages), and shells are also
   off-host, so `would drop` must be a union (MDN 149, not 272).
 - Repeats are reported, never proposed for deletion: "chapter 1" ×23 in
   military-medicine is 23 real chapters in 23 books.
 - Suite: 212 passed (200 + 12 in `tests/test_audit.py`).

## Shelf repair pass 1: ready.gov, MDN, libretexts (2026-11-20)

 - Four ingest rules in `codex/artifacts.py`, applied by `GenericAdapter`:
   replay shells, foreign hosts (from the archive's `Name`), language pickers
   in leads, and one source's navigation titles. Backups of all three rolls
   before the change: `_work/pre-rebuild-2026-11-20/` (311 MB).
 - **MDN 1,231 → 1,082.** 123 shells + 26 other off-site pages (Wikipedia,
   FEMA, GitHub) dropped; 0 capture-ids, 0 shells, 0 off-host left. The 1,082
   real pages average 608 words and browse as real titles.
 - **ready.gov 2,006 → 2,002** (4 `fema.gov` links). 1,463 of 1,688 leads
   (whichever rule you count with) opened with the language picker; now 0.
 - **libretexts 20,926 → 20,169** (757 navigation docs: Detailed Licensing 192,
   InfoPage 179, Table of Contents 166, Front Matter 161, Back Matter 55,
   TitlePage 4). 869 anchors and 20,105 sections intact; `Table of Contents`
   etc. now return 0 rows.
 - **Ordering bug found while verifying:** SQLite byte order reopened the
   alphabet at iFixit (`# A…Z B E F I J…`) because lowercase titles sort after
   "Z". Shelf order is `(is A–Z, casefold, title)` in Python now, keyset paging
   uses the same key.
 - Shelf totals: 10 rolls, **7,259,744 documents**, 33.6 GB. `would drop` across
   the whole shelf: 2 (medlineplus links to nih.gov).
 - Tests: **229 passed** (212 + 14 artifacts + 3 before/after). The
   before/after tests read the backup, so the diff stays provable.
 - Verified in the browser: MDN browse has 30 clean titles under A and zero
   rows matching the old shell pattern; the ready.gov reader opens with
   "Launched in February 2003, Ready is a National public service campaign…";
   LibreTexts shows 22 books / 20,105 sections in one list.

## Book navigation + lead repair (2026-11-20, second pass)

 - **`/api/doc` returns `nav`**: `{position, total, prev, next}` over the
   container's direct children in `id` order, `null` on a flat document. The
   reader shows the book in its header and `← Previous · 25 of 40 · Next →` at
   the foot. Verified: APPENDIX 1 of the Division and Brigade handbook is
   "25 of 40", previous is pp. 93-96, next is APPENDIX 2, and clicking Next
   lands on id 941.
 - **Lead chrome is stripped before the lead is chosen** (`strip_lead_furniture`
   + `looks_like_nav_block` in `codex/artifacts.py`): "On this page",
   "Also called: RA", a title repeated as the first line, and a 3+ line list of
   labels. MedlinePlus 14,932 → 14,930; 1,818 chrome leads → 0, and *Abscess*
   now opens "An abscess is a collection of pus…". MedlinePlus is a directory of
   topic hubs, so many leads are still its section list — honest, not chrome.
 - **A guide's stats strip is not a summary**: a section whose whole text is
   "No estimate" / "1 - 2 hours" / "Moderate" is dropped before the lead is
   derived. iFixit 82,269 → 82,231; 5,053 "No estimate" previews → 0, and
   *iPhone 15 Battery Replacement* now previews "Use this guide to replace…".
 - **Duplicate titles in the flat browse are identified, not hidden.** When a
   page repeats a title (MedlinePlus's 20-page tutorial), each row shows the
   path tail — `Understanding Medical Words Tutorial · medwords/abbreviations1`.
   46 rows on the U page carry one. No document is removed from the list.
 - **Client state is stamped with the film it came from.** `recent`, `marks`
   and `last` store `{codex, id}`; a rebuild reassigns ids, so the home
   "Continue reading" showed a dead MDN shell title and clicking it could open
   the wrong page. Entries now carry `built|docs` from `/api/health` and are
   pruned at boot when the film changed (legacy unstamped entries go once, with
   a toast). `.cx-card b` is clamped to two lines so no title can overlap the
   grid. Verified in the browser: a seeded stale + unstamped entry disappear on
   reload, a freshly stamped one survives.
 - Shelf: 10 rolls, **7,259,704 docs**, 33.77 GB, `would drop` 2.
 - Tests: **239 passed** (229 + 3 lead-furniture, 3 book-navigation, 2 lead
   regressions, and adjusted pinned counts for the rebuilt ifixit/db).

## Next

1. Re-verify `scripts/windows/*.ps1` and `scripts/macos/*.sh` once on real
   hardware.
2. Per-source weighting in the search merge (the known ranking gap).
3. Embeddings (bge-small via onnxruntime) if a CPU-bound subset is acceptable.
4. A StackExchange Q&A adapter, then a ready.gov subclass for the lead junk.
5. Consider git init + Git LFS (or a data/ exclusion) if the project ever
   becomes version-controlled; `.gitignore` documents the intent.
