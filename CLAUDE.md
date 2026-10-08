# CLAUDE.md

Windows-era operational notes for an agent working on this project. The
project is now portable (2026-09-25 migration); the authoritative layout is in
`README.md`, current state in `PROJECT_STATE.md`, and general agent rules in
`AGENTS.md`. This file survives because the Windows quirks below are still the
cheapest way to lose an hour on a Windows box.

## Paths and the interpreter

```
<root>/app/                       code (codexd.py, codexctl.py, launcher.py, codex/, tools/, tests/, web/)
<root>/data/                      built codexes (.codex.db + .codex-deep.db, art.db)
<root>/scripts/windows/           start.ps1, stop.ps1, status.ps1
<root>/_work/                     logs, art_cache, manifests, pidfile
<root>/.venv/                     the virtualenv: use .venv\Scripts\python.exe
```

**Always use `.venv\Scripts\python.exe`.** The system interpreter at
`AppData\Local\Python\pythoncore-3.12-64` happens to have some of the same
packages installed, so the wrong one appears to work and then diverges.

### The venv is a redirector, so codexd shows up as two PIDs

`.venv\Scripts\python.exe` is a 274 KB redirector stub, not a copied interpreter
(the base install is a PyManager layout that cannot be copied). Running it
launches the base interpreter as a **child process**. So a single daemon appears
in the process list twice:

- the stub, running from `.venv\Scripts\python.exe`
- its child, running from `AppData\Local\Python\pythoncore-3.12-64\python.exe`,
  which is the one that actually holds the socket

Check `ParentProcessId` before concluding you have duplicates. And note that any
"stop the daemon" command filtering on `Name='pythonw.exe'` will miss both of
them when it was started with `python.exe`; filter on the command line instead.

## Daemon lifecycle

```powershell
# start (from anywhere; the script resolves the project root itself)
powershell -ExecutionPolicy Bypass -File scripts\windows\start.ps1

# manual equivalent (from the project root)
Start-Process .venv\Scripts\python.exe -ArgumentList '-u','app\codexd.py' -WindowStyle Hidden

# is it up?
curl http://127.0.0.1:8765/api/health

# exactly one socket should be listening
netstat -ano | Select-String "8765.*LISTENING"

# stop (matches both the stub and its child)
powershell -ExecutionPolicy Bypass -File scripts\windows\stop.ps1
```

Loading Wikipedia takes ~20–30 s before the port opens; a failed `curl`
immediately after starting means "still loading", not "crashed". Check
`_work/logs/codexd.out.log`.

The daemon must be restarted to pick up newly built codexes — it globs
`data/*.codex.db` once at startup.

## Do not undo the design decisions

The README's *Design decisions, and why (so you don't undo them)* section is
load-bearing. Each entry reverses something that looks like an obvious
improvement, and each is backed by a measurement recorded inline. The ones most
likely to be "fixed" by a well-meaning edit:

- **`MIN_PREFIX = 3`** and prefix-expanding only the last term. Dropping to 2
  characters took one query from 191 ms to 1,894 ms.
- **Ranking hoisted into a CTE**, joining `doc` only for survivors. Inlining the
  join is the natural shape and costs 8x on prefix queries.
- **Per-thread SQLite connections.** One shared connection serialises every
  statement and makes one slow codex stall all clients.
- **`np.add.at` in the PageRank loop but `bincount` for degree counts.** The same
  call is correct in one place and 8x too slow in the other.
- **zstd level 15, not 19.** 19 costs ~70% more time for ~0.1% size.
- **No images, ever, from a ZIM.** Sampled: median 0.05 MP, 0 of 220 reached
  2 MP. This was built in V0.1 and removed on evidence.

If you have a measurement that beats the recorded one, change it and update the
README with the new number. Otherwise leave it.

## After any build, check these before trusting the result

`codexctl build` reporting success does not mean the corpus is good.

```bash
.venv/Scripts/python.exe app/tools/gaps.py data/<name>.codex.db
```

Plus the two failure modes that are silent:

```sql
-- empty leads: fts_quick indexes title+lead, so these are findable by title only
SELECT COUNT(*) FROM doc WHERE lead IS NULL OR lead = '';
-- orphans: nothing links here, so they always rank last and get no context label
SELECT COUNT(*) FROM doc WHERE in_degree = 0;
```

**The most important check is the document count.** `DONE 6 documents` from a
77,274-entry archive is a failure that exits 0 and says nothing is wrong. Always
compare against `Archive.article_count`. Two archives on disk fail this way: one
keeps its prose in JSON, one is a bag of PDFs.

A new source routed to `GenericAdapter` needs its `exclude_prefixes` checked
before the graph means anything — `exclude_prefixes` is empty on the generic
adapter, and a site whose profile pages get indexed will have them dominate
PageRank (this is what blocks StackExchange). Sample entry paths first.

`tools/calibrate.py <archive.zim>` projects documents, size and build time before
you commit to a long build. Use it rather than guessing.

## Adapter hooks

Beyond `parse`/`skip_path`/`should_keep`, two hooks exist for archives that are
not self-describing. Both are no-ops on `GenericAdapter`, so adding one to a new
adapter cannot disturb an existing source:

- **`prepare(archive)`** — build an archive-wide index once per worker (called
  from `_worker_init` and from `preflight`). `LibreTextsAdapter` loads a 4.9 MB
  table of contents here.
- **`source_for(archive, entry, raw)`** — return the HTML to actually parse.
  Default is the entry's own bytes; `None` drops the entry. This is how a
  document whose body lives in a *different* entry gets read.

If you add a hook, add it to `tools/calibrate.py` too. It deliberately mirrors
the real extraction path — a projection that skips `source_for` reads routing
stubs and predicts an empty corpus, which is the exact failure it exists to warn
about.

## The military-medicine PDFs

`irp.fas.org` is 24 PDFs, not a website. `milmed/` holds the artifacts
(`raw/`, `text/`, `ocr/`, `figures/`) and `data/military-medicine.codex.db`
is the codex built from them. (`CODEX_MILMED_DIR` overrides the location;
on the original Windows box this was `D:\milmed`.)

- `app/tools/milmed_ocr.py` rebuilds `milmed/`; `--figures-only` redoes just the
  images.
- `app/tools/milmed_build.py` rebuilds the codex from `milmed/ocr/*.pdf`. It is
  the only builder that does not read a ZIM, and it replaces **only pass 1** —
  `schema`, `graph.resolve_and_rank` and `index.*` are source-agnostic and are
  reused untouched.

Worth not re-deriving: OCR is decided **per page**, not per file, because most
manuals are text bodies with scanned plates dropped in; `sfhandbook-pt2/pt3` are
skipped because page-image hashing puts 264 of their 265 pages inside
`sfhandbook.pdf`; and the manual titles in `milmed_build.CITATIONS` are curated
on purpose — cover-page OCR gives `corpsman-pt2` the title `CHAPTER 4`.

### Don't move `strip_figure_directives` into `clean_text`

`codex/hygiene.py` has two cleaners and they are separate deliberately.
`clean_text` runs over every corpus; `strip_figure_directives` runs only on the
military manuals, because its vocabulary (`fig`, `illus`, numbered figure refs)
misfires on general text and `clean_text` is shared by 7.3M documents.

`plate` and `chart` were in the first draft of the milmed vocabulary and are gone
on evidence: 112 false hits, zero true ones — *perpendicular plate of the ethmoid
bone*, *partial plates*, *(PHEL) chart*. Don't add them back.

Four regressions are pinned in `TestFigureDirectives`, all of which shipped into
a build before being caught by reading the corpus back out: alternation order
(`fig` matching inside `figure`), sentence-splitting on the `fig.` abbreviation,
`[0-9A-Z]` matching lowercase under `re.I` and eating the word "and", and figure
numbers that are not integers (`215D`, `A-1A`, `APP-I-3`, `7-6 OR 7-7`). Tesseract is at
`C:\Program Files\Tesseract-OCR\tesseract.exe` — no Ghostscript and no OCRmyPDF,
since Tesseract writes searchable PDFs itself and chocolatey needs admin here.

Figures are rendered from the page, not pulled out with `extract_image`: most are
stencil masks (`/ImageMask true`) and the raw stream is a flipped negative.

**Don't reach for `C:\Users\Admin\Documents\Unlimited-OCR-main`.** It is a Baidu
3B vision-language model served through a patched SGLang build: Linux, CUDA, an
H100-class GPU, and a checkpoint that has never been downloaded. This machine has
a 512 MB iGPU. It was evaluated and ruled out, not overlooked.

## Tests

```bash
.venv/Scripts/python.exe -m pytest app/tests/ -q
```

126 passing as of V0.6. Run them after touching `codex/search.py` or the ranking
blend — ranking regressions are easy to introduce and impossible to eyeball.

`tests/test_art.py` is mostly runnable without `art.db`: the subject list,
licence policy and relevance heuristics are pure functions. The rest skips.

## The image layer (`art.db`)

100 curated images in `data/art.db`, built by `app/tools/art_manifest.py` then
`tools/art_build.py`. This does **not** reverse the no-images decision: the ban
is on ZIM-sourced images, re-confirmed in V0.6 across six archives (1 of 1,050
sampled images reached 2 MP). These come from Wikimedia at build time.

Four things that cost real time to work out:

- **Never build a thumbnail URL.** Guessing a width gives `HTTP 400`. Pass
  `iiurlwidth` and use the returned `thumburl`.
- **Rate limiting escalates when you retry.** A 1 s baseline drew
  `Retry-After: 1`, then `10`, then a flat `600` after 35 images. `polite_get`
  widens the interval for the whole run on each 429; a `Retry-After` over 180 s
  stops the run instead of grinding. Downloads cache to
  `_work/art_cache`, so resuming is free — never delete it to "start
  clean", that is the expensive part.
- **`formatversion=2`, always.** Version 1 returns `pages` as a dict and every
  lookup silently misses.
- **A Commons file returns `"missing": true` from en.wikipedia** alongside
  `"imagerepository": "shared"` and a full `imageinfo` block. It means "not
  local", not "absent". Testing `missing` rejects nearly every file.

`art.db` is never ATTACHed and `codex/search.py` is untouched — the binding table
is 227 rows and lives in a dict in the daemon. If a change here needs to modify
`search.py`, stop: the ranked-CTE plan is pinned by measurement.

Substituted images are marked `review` and appear in
`_work/art_contact_sheet.html`. Look at it. The automatic picker has
chosen an African elephant skull for *human skull* and a UI icon for *Vibrio
cholerae*; both are fixed, but filenames genuinely cannot settle relevance.

## Things that are deliberately absent

Don't "add" these thinking they were forgotten: raster images *from a ZIM*, a
media sidecar database (`codex-media.db` was removed in V0.2 and the tests assert
it stays gone — `art.db` is a different file with different table names and
passes those tests unmodified), and any network call at query time. Embeddings
are genuinely unbuilt — the `vec` table exists and is empty, which is a real gap,
not a bug.
