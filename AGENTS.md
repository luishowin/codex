# AGENTS.md

Portable project (Linux/macOS/Windows) as of 2026-09-25. Full context:
`README.md` (what/why + measured numbers) and `PROJECT_STATE.md` (current
state). `CLAUDE.md` holds Windows-era operational notes (venv redirector,
PowerShell lifecycle). Trust the measured numbers over code reading.

## Where things are (repo root = this dir)

- Code: `app/` (`codexd.py`, `codexctl.py`, `launcher.py`, package `codex/`, `tools/`, `tests/`, `web/`). Ignore `app/Codex-documents/` (unrelated dated scratch, not project code).
- Standalone demo site: `codex-site/` (static page + stdlib `serve.py` on `:8766`). Do not confuse with the daemon UI in `app/web/` (`:8765`).
- Built outputs: `data/*.codex.db` + `*.codex-deep.db` + `art.db`.
- Generated/transient: `_work/` (art_cache, logs, art_manifest.json, art_contact_sheet.html, codexd.pid).
- Platform launchers: `scripts/{linux,macos,windows}/{start,stop,status}.*`. Same app, same data; only the wrapper differs.
- Path resolution: `app/codex/paths.py` derives everything from `__file__` (project root = `app/..`). Env overrides: `CODEX_DATA_DIR`, `CODEX_ART_DB`, `CODEX_WORK_DIR`, `CODEX_MILMED_DIR`. Never reintroduce machine-specific absolute paths; `tests/test_paths.py` pins this.
- Source ZIMs and `milmed/` (raw/ocr/text/figures) are absent on this mount: no builds from ZIM possible here. `app/tools/calibrate.py` needs a local `.zim`.
- No git repo, no CI. Migration rollback record: `_work/migration_checkpoint_2026-09-25.md`.

## Interpreter and layout

- Interpreter: no working environment ships with the checkout. Create `<root>/.venv` per README Install (`python3 -m venv .venv && .venv/bin/pip install libzim selectolax zstandard numpy Pillow pytest`) or set `CODEX_PYTHON`. `scripts/*/start.sh` resolves `CODEX_PYTHON`, then `<root>/.venv`, then `~/.venvs/codex`, then `python3` — the bare-`python3` fallback lacks the deps and fails at daemon boot (`ModuleNotFoundError` in `_work/logs/codexd.err.log`).
- `launcher.py` is Windows-only (`ctypes.WinDLL("user32")`, `RegisterHotKey` + pywebview): do not try to run it on Linux. `codexd.py`/`codexctl.py` are portable.
- Entrypoints: `app/codexctl.py` (build/info/search), `app/codexd.py` (daemon `:8765`), `app/launcher.py` (Windows hotkeys).
- Pipeline: `codex/adapters.py` (per-source extraction) -> `codex/build.py` (pass 1) -> `codex/graph.py` (pass 2 PageRank/related/context) -> `codex/index.py` -> `codex/search.py` (read path). `tools/milmed_build.py` replaces only pass 1; `schema`/`graph`/`index` are reused untouched.
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
```

- `--scratch` must be a **different volume** from the source (transient edge file ~2.7 GB for Wikipedia). Resume checkpoint is every 50k docs or 2 min. `--zstd-level` default 15.
- Mandatory post-build: compare `DONE n documents` against `Archive.article_count` (a 6-docs-from-77k-entries build exits 0; one source keeps prose in JSON, one is PDFs). Then check empty leads (`SELECT COUNT(*) FROM doc WHERE lead IS NULL OR lead=''`: quick search indexes title+lead only) and orphans (`WHERE in_degree = 0`).
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

## Milmed / art specifics

- `irp.fas.org` = 24 PDFs, not a site. `app/tools/milmed_ocr.py` -> `app/tools/milmed_build.py` (reads `ocr/*.pdf` for page numbers). OCR triage is per page (19.5% need it); `sfhandbook-pt2/pt3` skipped as dupes of `sfhandbook.pdf`; titles in `milmed_build.CITATIONS` are curated (cover OCR says `CHAPTER 4`). Figures rendered from page rects, never `extract_image` (stencil masks). Tesseract defaults to the Windows install path; on Linux/macOS set `TESSERACT_CMD`.
- `art.db`: build via `art_manifest.py` -> `art_build.py`; never modify `search.py` for it (227-row binding dict in daemon, annotate after merge). Never construct thumbnail URLs (HTTP 400: pass `iiurlwidth`, use `thumburl`). Always `formatversion=2`. Commons file `"missing": true` + `"imagerepository": "shared"` means not-local, not absent. On 429 widen interval run-wide; `Retry-After` > 180 s means stop; never delete `_work/art_cache/` (resume is free). Review `_work/art_contact_sheet.html`: the auto-picker misfires (elephant skull for human skull).

## Tests

```bash
cd <root> && .venv/bin/python -m pytest app/tests/ -q   # 138 passing (Linux, 2026-09-25)
```

- Run after touching `codex/search.py` or the ranking blend. `tests/test_search_quality.py` pins 10 queries + asserts `codex-media.db` stays gone; `CODEX_DB` env overrides the default (`data/ifixit.codex.db`), suite skips gracefully if absent. `tests/test_paths.py` pins the portable layout and boots a real daemon on port 8877 (works from any CWD).
- Suite runs from any directory: paths come from `codex/paths.py`, not the shell.

## Deliberately absent — do not add

Raster images from a ZIM, `codex-media.db`, any network call at query time. `vec` table exists and is empty (embeddings genuinely unbuilt). Next real ranking job is per-source weighting in `search_all` merge (`javascript promise` -> no MDN; `hurricane evacuation kit` -> no ready.gov; per-codex `&codex=` queries already correct).
