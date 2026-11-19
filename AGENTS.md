# AGENTS.md

Portable project (Linux/macOS/Windows) as of 2026-09-25. Full context:
`README.md` (what/why + measured numbers) and `PROJECT_STATE.md` (current
state). `CLAUDE.md` holds Windows-era operational notes (venv redirector,
PowerShell lifecycle). Trust the measured numbers over code reading.

## Where things are (repo root = this dir)

- Code: `app/` (`codexd.py`, `codexctl.py`, `launcher.py`, package `codex/`, `tools/`, `tests/`, `web/`). Ignore `app/Codex-documents/` (unrelated dated scratch, not project code).
- Built outputs: `data/*.codex.db` + `*.codex-deep.db` + `art.db`.
- Generated/transient: `_work/` (art_cache, logs, art_manifest.json, art_contact_sheet.html, codexd.pid).
- Platform launchers: `scripts/{linux,macos,windows}/{start,stop,status}.*`. Same app, same data; only the wrapper differs.
- Path resolution: `app/codex/paths.py` derives everything from `__file__` (project root = `app/..`). Env overrides: `CODEX_DATA_DIR`, `CODEX_ART_DB`, `CODEX_WORK_DIR`, `CODEX_MILMED_DIR`. Never reintroduce machine-specific absolute paths; `tests/test_paths.py` pins this.
- Source ZIMs live in `Reference/kiwix/kiwiz zim files/` and the military-medicine
  PDFs in `Reference/milmed/` (`raw/ocr/text/figures`), both on this MX500 mount,
  so ZIM builds and milmed rebuilds are possible here. `app/tools/calibrate.py`
  needs a local `.zim` (use the `Reference/kiwix/...` path directly).
- Film on disk is not the shelf. `data/shelf.json` lists rolls that stay on
  disk but are not loaded, searched or listed by `/api/library`; edit that file
  (not `mv`, not code) to put a roll back. An explicit `--codex` always wins.
  `/api/library` manifests come from `app/codex/cassette.py` and are *shelf*
  manifests: `sealed: false`, every `sha256` null, `cassette_id` prefixed
  `shelf-`. `app/web/mock/library.json` is only the no-daemon fallback.
- No git repo, no CI. Migration rollback record: `_work/migration_checkpoint_2026-09-25.md`.

## Interpreter and layout

- Interpreter: no working environment ships with the checkout. Running the projector needs stock Python 3 only (stdlib-only read path, enforced by `tests/test_stdlib_runtime.py`) — `scripts/*/start.sh` falls back to system `python3` and that is sufficient to serve. Create `<root>/.venv` per README Install (`pip install -r requirements-build.txt`) or set `CODEX_PYTHON` only for cutting film, running tools, or the test suite. `scripts/*/start.sh` resolves `CODEX_PYTHON`, then `<root>/.venv`, then `~/.venvs/codex`, then `python3`.
- `launcher.py` is Windows-only (`ctypes.WinDLL("user32")`, `RegisterHotKey` + pywebview): do not try to run it on Linux. `codexd.py`/`codexctl.py` are portable.
- Entrypoints: `app/codexctl.py` (build/info/search), `app/codexd.py` (daemon `:8765`), `app/launcher.py` (Windows hotkeys).
- Pipeline: sources -> `codex/ingest.py` (`ZimIngester`/`MarkdownIngester` yield `Doc`/`Redirect`; link targets must equal `Doc.path` exactly or edges dangle) -> `codex/build.py` (`extract_pass` mp for ZIM, `build_stream` sequential, shared `finish_build`) -> `codex/graph.py` (pass 2 PageRank/related/context) -> `codex/index.py` -> `codex/search.py` (read path, ranks inside one codex) -> `codex/merge.py` (daemon-only: fuses codexes by title-share specialisation, dedupes titles). New film is zlib (`codex_meta.body_codec`, `ZLIB_LEVEL`); pass-0 dict training is deleted, `--zstd-level` is now `--compress-level`, `calibrate.py` still projects in zstd ratios (~10% off). `tools/milmed_build.py` is a zlib writer not yet converted to an ingester (layering: tools depend on `codex/`, never the reverse).
- Format: `*.codex.db` (`doc, redirect, related, zdict, fts_quick, codex_meta`) works standalone; `*.codex-deep.db` (`fts_deep, vec`) ATTACHed if present. `art.db` (`art, binding, art_meta`) is never ATTACHed. WAL/SHM siblings always move with their `.db`.

## Measure before claiming

- Every perf/corpus/ranking number came from a script; code reading has produced confident wrong diagnoses. Run something before stating facts about throughput, size, ranking, or archive contents.

## Daemon

- Start: `bash scripts/linux/start.sh` (waits for health, opens browser; `CODEX_NO_BROWSER=1` skips). Knobs: `CODEX_PORT`, `CODEX_HOST`, `CODEX_PYTHON`. Health: `curl http://127.0.0.1:8765/api/health`. Status/stop: `scripts/linux/status.sh`, `scripts/linux/stop.sh`. `status.sh` reporting `not running` / `no response` on a fresh checkout is the expected answer, not an error.
- Daemon defaults to `data/*.codex.db` + `data/art.db` via `codex/paths.py`; `--codex`/`--art` override. Logs: `_work/logs/codexd.{out,err}.log`. PID: `_work/codexd.pid`.
- Wikipedia takes ~20-30 s before the port opens; a failed `curl` right after starting = still loading (watch `codexd.out.log`). The daemon globs once at startup: **restart after building a new codex**.
- On Windows one daemon shows as two PIDs (venv redirector stub + base interpreter; child holds the socket). Stop by command line containing `codexd`, never by `pythonw.exe` name alone.

## Build, then verify (success exit proves nothing)

```bash
python app/tools/calibrate.py <archive.zim>   # projection + expected doc count, before long builds
python app/codexctl.py build "<archive.zim>" --out data --workers 10 --scratch <other-volume>
python app/tools/gaps.py data/<name>.codex.db
python app/tools/audit.py --codex <name> -v   # scorecard: shells, off-host, titles, leads, thin
```

- `--scratch` must be a **different volume** from the source (transient edge file ~2.7 GB for Wikipedia). Resume checkpoint is every 50k docs or 2 min. `--zstd-level` default 15.
- Mandatory post-build: compare `DONE n documents` against `Archive.article_count` (a 6-docs-from-77k-entries build exits 0; one source keeps prose in JSON, one is PDFs). Then check empty leads (`SELECT COUNT(*) FROM doc WHERE lead IS NULL OR lead=''`: quick search indexes title+lead only) and orphans (`WHERE in_degree = 0`). Then `audit.py`: `would drop` must fall and nothing new may appear in `leads` or `titles`.
- New `GenericAdapter` source: sample entry paths and set `exclude_prefixes` first (empty by default; `users/*` profiles will dominate PageRank: blocks StackExchange). If you add `prepare()`/`source_for()` hooks, mirror them in `tools/calibrate.py` or the projection reads stubs and predicts an empty corpus.

## Do not "fix" these (each reverses a measured decision)

- `MIN_PREFIX = 3`, prefix-expand only the last term (`ba*` = 1,894 ms vs `bat*` = 191 ms).
- Rank inside CTE, join `doc` only for survivors (inlining costs 8x on prefix queries).
- Per-thread SQLite connections in `Searcher`; no global lock (one shared connection stalls all codexes).
- `np.add.at` in PageRank loop but `bincount` for degree counts (same call is fastest in one, 8x slowest in the other).
- zstd level 15, not 19 (~70% more time, ~0.1% size).
- Never extract images from a ZIM (median 0.05 MP, 1/1,050 >= 2 MP). Curated `art.db` (Wikimedia-sourced) does not reverse this.
- `codex/hygiene.py`: keep `clean_text` (all corpora) separate from `strip_figure_directives` (milmed only; `fig/illus` vocab misfires generally). Do not re-add `plate`/`chart` (112 false hits, 0 true).
- Deep SQL: `FROM deep.fts_deep WHERE fts_deep MATCH ?` — bare table name in MATCH, qualified FROM. Any other shape raises "no such column" and silently kills the deep tier via fallback.
- `/api/library` default is the **loaded set**, not every file in `data/`: asking for a 7M-row roll's word total costs ~50 s cold. `?all=1` is the explicit opt-in, and the daemon seeds the summary cache from what it counted at load.
- `data/shelf.json` is policy, not generated output. Do not filter the shelf in code, and do not "clean up" by deleting files: hidden rolls are one edit away from returning, and `wikipedia-100`'s source ZIM is already gone for good.
- Cross-codex ranking lives in `codex/merge.py`, not in `search_all`. Raw scores are only comparable within one codex (importance is that codex's own PageRank); the merge weights by title-share specialisation. Do not replace it with a per-source taste table, and do not add a per-codex slot cap: the weights already break monopolies and a cap cuts the source that is genuinely right. `MIN_TITLES = 3` is what stops one coincidental title (field manual "Tourniquet") from being called specialisation.
- Browse/contents structure is `kind=2` + `context_id`, read by `Searcher.structure()`. Do not sort children by title (page order is the point), do not walk *up* (libretexts and iFixit loops), and do not replace the 0.5 s probe with a full scan: `WHERE kind=2` measured 48 s on the 21 GB Wikipedia roll. Do not add a `kind` index to existing film either; no rebuild is worth it for a feature only three codexes use.
- `app/tools/audit.py` treats a repeated title as **structure, not junk**. A shelf of books has a "Chapter 1", a "Glossary" and a "Table of Contents" in every book; military-medicine repeats "Chapter 1" 23 times with 1,133 words each. Only replay shells and off-host pages are counted as `would drop`; leads are `strip`, thin docs and odd titles are `review`. Do not turn the repeat list into a deletion rule. The one exception is `LibreTextsAdapter.exclude_titles`, a per-source list of navigation titles — justified because the audit measured them at 757 documents of zero reading value, one copy per book.
- Capture filtering uses the **archive's `Name` metadata**, never the majority host by path: `developer.mozilla.org_bc74bccb.zim` says which site was captured. The modal host is the capture origin, which is where the replay shells live (MDN: 141 on `mdnplay.dev` against 1,082 real pages). Getting this backwards would have kept the shells and deleted the encyclopedia.
- Lead chrome is stripped by **whole lines only** (`strip_lead_furniture`): "On this page", "Also called: X", the title repeated, and 3+ line label lists. Do not turn that into a word filter — "On this page you will learn…" is a sentence, and a sentence that mentions a label must survive. Likewise `_STAT_ONLY` matches a *whole* section text, because "hard" and "easy" are ordinary words in repair steps.
- Client state (`localStorage` -> `codex.recent`, `codex.marks`, `codex.last`) is stamped `built|docs` from `/api/health` and pruned at boot. **Never trust a stored doc id across a rebuild**: ids are reassigned when documents are dropped (the MDN rebuild shifted every id after 1,082), so an unstamped entry opens the wrong page, not a 404. If you add another client store, stamp it the same way.

## Milmed / art specifics

- `irp.fas.org` = 24 PDFs, not a site. `app/tools/milmed_ocr.py` -> `app/tools/milmed_build.py` (reads `ocr/*.pdf` for page numbers). OCR triage is per page (19.5% need it); `sfhandbook-pt2/pt3` skipped as dupes of `sfhandbook.pdf`; titles in `milmed_build.CITATIONS` are curated (cover OCR says `CHAPTER 4`). Figures rendered from page rects, never `extract_image` (stencil masks). Tesseract defaults to the Windows install path; on Linux/macOS set `TESSERACT_CMD`.
- `art.db`: build via `art_manifest.py` -> `art_build.py`; never modify `search.py` for it (227-row binding dict in daemon, annotate after merge). Never construct thumbnail URLs (HTTP 400: pass `iiurlwidth`, use `thumburl`). Always `formatversion=2`. Commons file `"missing": true` + `"imagerepository": "shared"` means not-local, not absent. On 429 widen interval run-wide; `Retry-After` > 180 s means stop; never delete `_work/art_cache/` (resume is free). Review `_work/art_contact_sheet.html`: the auto-picker misfires (elephant skull for human skull).

## Tests

```bash
cd <root> && .venv/bin/python -m pytest app/tests/ -q   # 239 passing (Linux, 2026-11-20)
```

- Run after touching `codex/search.py` or the ranking blend. `tests/test_search_quality.py` pins 10 queries + asserts `codex-media.db` stays gone; `CODEX_DB` env overrides the default (`data/ifixit.codex.db`), suite skips gracefully if absent. `tests/test_paths.py` pins the portable layout and boots a real daemon on port 8877 (works from any CWD).
- Suite runs from any directory: paths come from `codex/paths.py`, not the shell.

## Deliberately absent — do not add

Raster images from a ZIM, `codex-media.db`, any network call at query time. `vec` table exists and is empty (embeddings genuinely unbuilt). Next real ranking job is stopwords (`how plants convert sunlight` -> *Sunlight*, not *Photosynthesis*), then near-duplicate detection across codexes (ready.gov serves translations of the same toolkit under different titles).
