# Codex

Rebuilds ZIM archives into a compact, fast, portable knowledge store that humans
and language models can both search.

Source archives are never modified — opened read-only and streamed.

---

## Mental model: film, projector, canvas

Three components, each replaceable without touching the others:

- **Film** — a codex: one self-contained SQLite file per corpus
  (`data/*.codex.db`, optional full-text `*-deep.db` reel). Loading a
  corpus means loading a roll; unloading it changes nothing else.
- **Projector** — the backend: `app/codexd.py` plus `app/codex/`
  (ingest, build, rank, search). It holds the loaded rolls open and answers
  one stable HTTP API. A roll is text plus its link graph — the links are
  the ranking signal, not packaging.
- **Canvas** — the front end: `app/web/`, one shell shared by the browser and
  the desktop window. It only speaks the projector's API and degrades
  gracefully (no `art.db`, no pictures, nothing else notices).

Everything else in this repo serves one of the three: `app/codexctl.py`
and `app/tools/` cut new film, `scripts/` start and stop the projector.

---

## Project layout

```
<root>/
├── README.md              technical reference (this file)
├── START-GUIDE.html       operating guide: start/stop/status per OS
├── PROJECT_STATE.md       current implementation state
├── AGENTS.md              rules for AI coding agents
├── CLAUDE.md              Windows-era operational notes
├── app/                   the application
│   ├── codexd.py          warm search daemon (:8765), the only HTTP surface
│   ├── codexctl.py        build / info / search CLI
│   ├── launcher.py        Windows hotkey overlay (Windows-only)
│   ├── codex/             the library (no UI, no server):
│   │   ├── paths.py       every path; shelf policy; merge weights
│   │   ├── ingest.py      ZIM / Markdown -> Doc
│   │   ├── build.py       pass 1: extract, write film
│   │   ├── graph.py       pass 2: PageRank, related, context
│   │   ├── index.py       pass 3: fts_quick + fts_deep
│   │   ├── schema.py      the film format, indexes, pragmas
│   │   ├── adapters.py    per-source extraction
│   │   ├── artifacts.py   capture artefacts, title/lead rules
│   │   ├── hygiene.py     image-reference and text repair
│   │   ├── model.py       Doc / Section / reflow
│   │   ├── search.py      rank *inside* one codex; contents; nav
│   │   ├── merge.py       fuse codexes: specialisation, dedupe
│   │   ├── cassette.py    SPEC §3 manifests (shelf + fixture)
│   │   └── art.py         image store, bindings, annotations
│   ├── tools/             calibrate, audit, gaps, stats, art_*, milmed_*, mock_library, attic/
│   ├── tests/             pytest suite
│   └── web/               canvas: index.html, codex.css, app.js, views/, fonts/, mock/
├── data/                  built corpora: *.codex.db, *.codex-deep.db, art.db, shelf.json
├── scripts/               linux/ macos/ windows/ each with start, stop, status
└── _work/                 generated artifacts: art_cache, logs, manifests, pidfile, backups
```

`app/codex/paths.py` derives every location from this layout, so the project
runs from any working directory and copies between machines without edits.
Overrides: `CODEX_DATA_DIR`, `CODEX_ART_DB`, `CODEX_WORK_DIR`,
`CODEX_MILMED_DIR`.

## Coming back to this after a while? Read this bit.

**What this is.** You had ~180 GB of ZIM files in `D:\kiwix\`. They work, but
they're heavy, the reader is slow, the built-in search index can't be reranked,
and nothing can query them programmatically. This turns them into SQLite files
that answer queries in milliseconds.

How much smaller depends entirely on what the source was carrying. Against
iFixit, whose archive is mostly pictures, a codex is **25.6x** smaller. Against
`wikipedia_en_all_nopic`, which is already text-only, it is **1.6x**. Across the
whole built corpus: 68.5 GB of source → 33.9 GB of codex, **2.0x**. The large
ratios are the pictures coming off, not the text compressing — worth knowing
before you quote a number at someone.

**Where things live.**

The layout is portable: every path below is derived from the project root,
never from a machine. (Before 2026-09-25 the code lived in a Windows folder
literally named "codex from C drive" and the data on `D:\codex`; the migration
checkpoint is `_work/migration_checkpoint_2026-09-25.md`.)

```
<root>/app/           the code: codexd.py, codexctl.py, launcher.py, codex/, tools/, tests/, web/
<root>/data/          the built outputs: *.codex.db, *.codex-deep.db, art.db
<root>/scripts/       platform launchers: linux/ macos/ windows/ each with start, stop, status
<root>/_work/         generated and transient: art_cache, logs, manifests, pidfile
<root>/.venv/         your virtualenv, created per machine (never portable, gitignored)
```

**Start it.** One command, from any directory:

```bash
bash scripts/linux/start.sh        # macOS: bash scripts/macos/start.sh
```

```powershell
powershell -ExecutionPolicy Bypass -File scripts\windows\start.ps1
```

The script starts the daemon, waits for the health check to pass, and opens
<http://127.0.0.1:8765/> in your browser. On Windows, `app/launcher.py` adds
the global `Alt+Space` hotkey overlay on top of the same daemon. All of this
lives, with per-OS tabs and copyable blocks, in `START-GUIDE.html`.

**Is it running?**

```bash
curl http://127.0.0.1:8765/api/health
```

Loading Wikipedia takes 20–30 s before the port opens, so a failed `curl` right
after starting means "still loading". `codexd.out.log` says which codex it's on.

**Stop it.**

```bash
bash scripts/linux/stop.sh         # macOS: bash scripts/macos/stop.sh
```

```powershell
powershell -ExecutionPolicy Bypass -File scripts\windows\stop.ps1
```

**A single daemon appears in the process list twice, and that is normal.**
`.venv\Scripts\python.exe` is a 274 KB redirector stub rather than a copied
interpreter — the base install is a PyManager layout that can't be copied — so
running it spawns the real interpreter as a child. You see the stub *and*
`AppData\Local\Python\pythoncore-3.12-64\python.exe`, and the child is the one
holding the socket. Check `ParentProcessId` before concluding you have two
daemons. This is also why the stop command above matches `python.exe`: an
earlier version filtered on `pythonw.exe` alone and silently matched neither.

The real duplicate check is the socket, which can only have one owner:

```bash
netstat -ano | Select-String "8765.*LISTENING"
```

The daemon globs `<root>/data/*.codex.db` once at startup, so **restart it after
building a new codex** or it won't be loaded.

**Where you left off (V0.5, 2026-07-28).** Thirteen codexes are built and loaded:
**7,333,360 documents, 4.36 billion words, 33.9 GB**. Wikipedia is done — 7.08M
documents from the nopic archive, 5.0 h of pass 1. iFixit is **text-only by
decision**: V0.1 shipped 408,876 images in a 2 GB sidecar and they were unusable
(~300×225 thumbnails, some missing from the archive entirely), and all of that is
gone — pipeline, storage, schema, UI. 86 tests green. Embeddings, the TUI, and
the MCP server are scaffolded but not written.

**Where you are now (2026-11-20).** Ten codexes on the shelf — **7,259,704
documents, 33.77 GB** — with three Wikipedia subsets on disk but unloaded
(`data/shelf.json`). A codex with containers browses as a shelf of books with its
contents intact; ranking across codexes is by source specialisation, not raw
score; five rolls were rebuilt to strip capture artefacts and page chrome; the
reader has previous/next inside a book; and the client refuses to reopen a saved
page against a film that has since been rebuilt. 239 tests green.

V0.4 added the `libretexts` adapter — 20,926 documents of nursing, anatomy and
pharmacology that a generic build had turned into 6 — and the milmed
extraction (then on `D:\milmed\`), 1.64M
words of military-medicine manuals extracted and OCR'd out of a ZIM that holds
PDFs rather than pages.

V0.5 folded those manuals into the `military-medicine` codex: 1,147 documents
built from PDFs rather than a ZIM, every one citing its manual and page range,
and with the directives to look at a picture removed — a codex carrying no images
should not tell you to consult Figure 4-25.

The superseded `wikipedia_en_all_maxi_2026-02.zim` (124 GB) has been deleted: the
built corpus came from `nopic_2026-06`, four months newer with the same article
text, and the maxi's only unique contribution was images this project had already
ruled out on measurement. D: went from 97 GB to 212 GB free.

**Why there are no images from a ZIM, and why no future phase should add them.**
Sampled across `wikipedia_en_all_maxi`: median **0.05 MP**, max **0.395 MP**,
**0 of 220 images reached 2 MP**. iFixit's are ~300×225. Kiwix downsamples
everything, so the archives simply cannot supply usable pictures.

Re-measured in V0.6 across every archive still on disk, because the original
sample was one file and the conclusion was being applied to thirteen. 1,050
images sampled, and it holds everywhere:

| archive | median MP | max MP | ≥2 MP |
|---|---|---|---|
| wikipedia-medicine maxi | 0.047 | 0.63 | 0/182 |
| wikivoyage-europe maxi | 0.047 | 0.25 | 0/200 |
| wikiversity maxi | 0.058 | 4.10 | 1/76 |
| wikipedia-100 maxi | 0.047 | 1.23 | 0/199 |
| ifixit | 0.068 | 0.20 | 0/200 |
| libretexts-med | 0.259 | 0.92 | 0/193 |

One image in 1,050 cleared 2 MP. Enrichment therefore needs an external source,
which is what `art.db` is — see *The image layer*.

**Known rough edges in V0.2** (deliberately shipped, not forgotten):

- ~2.2% of leads still contain "Written By"/"Comments:" byline text — guides with
  neither steps nor an Introduction fall through to generic extraction. Down
  from 10% but not zero.
- 5.9% of documents have an empty lead, so no preview text in results.
- 4.4% are orphans (nothing links to them): findable by search, always ranked
  last, and they get no context label.
- The hygiene rules are heuristic. `tools/try_hygiene.py` dry-runs them against
  the built corpus and prints before/after — run it before trusting a change.

---

## Do I still need Kiwix?

**For searching, no. For pictures and three archives, yes — keep it installed.**

13 of the 18 archives on disk are converted, and they hold **7,332,410
documents** — around 97.6% of the ~7.51M articles on disk, answering in
milliseconds. But "most" is not "all", and the remainder is not a rounding error.

**Three reasons Kiwix stays on this machine:**

1. **Every image.** A codex stores no rasters at all, by decision. The moment you
   want to *see* the connector in a repair step rather than read about it, Kiwix
   is the only thing on this machine that can show it.
2. **Two archives are not text and never will be.** Sampled: `maps_en_kenya` is
   196,489 entries of `application/x-protobuf` vector tiles — 18 of 3,000 sampled
   entries are HTML. `ted_mul_tech` is JSON, JavaScript, WASM and `.vtt`
   subtitles: a video player with 10 articles. This pipeline extracts prose from
   HTML; neither archive contains any.
3. **~152,750 articles are still Kiwix-only**, in the three archives below that
   need adapter work.

### Coverage

| source archive | codex | documents |
|---|---|---:|
| `wikipedia_en_all_nopic_2026-06` | `wikipedia` | 7,077,143 |
| `ifixit_en_all_2025-12` | `ifixit` | 82,231 |
| `wikipedia_en_medicine_maxi_2026-04` | `wikipedia-medicine` — *off shelf* | 68,871 |
| `wikiversity_en_all_maxi_2026-05` | `wikiversity` | 49,886 |
| `libretexts.org_en_med_2025-01` | `libretexts-med` | 20,169 |
| `medlineplus.gov_en_all_2025-01` | `medlineplus` | 14,930 |
| `wikivoyage_en_europe_maxi_2026-03` | `wikivoyage-europe` | 9,118 |
| `wikipedia_en_climate-change_nopic_2026-04` | `wikipedia-climate` — *off shelf* | 3,733 |
| `www.ready.gov_en_2024-12` | `ready-gov` | 2,002 |
| `nhs.uk_en_medicines_2025-12` | `nhs-medicines` | 1,996 |
| `developer.mozilla.org_bc74bccb` | `mdn` | 1,082 |
| `irp.fas.org_en_military-medicine_2026-05` | `military-medicine` | 1,147 |
| `wikipedia_en_100_maxi_2026-04` | `wikipedia-100` — *off shelf* | 102 |

Three of those 13 — `wikipedia-100`, `wikipedia-climate`, `wikipedia-medicine` —
are **built but off the shelf**: joined by `path`, they are 100%, 99.8% and
99.5% contained in the full Wikipedia roll, so they only made the shelf look
duplicated. They are not deleted (`data/shelf.json` hides them, and
`wikipedia-100`'s source ZIM is already gone, so it could never be rebuilt).
They remain legitimate as standalone cassettes — a sample disc, a climate
cartridge, a med-kit cartridge — just not next to their superset.

Still Kiwix-only, and why:

| archive | articles | blocker |
|---|---:|---|
| `mechanics.stackexchange.com` | 54,827 | needs a Q&A adapter |
| `wiktionary_en_simple` | 53,403 | dictionary entries don't fit the document model |
| `aviation.stackexchange.com` | 44,522 | needs a Q&A adapter |
| `maps_en_kenya` | — | vector tiles, not text |
| `ted_mul_tech` | — | video, not text |

**irp.fas.org is not a website, it is 24 PDFs** — and it is now the
`military-medicine` codex anyway. Only 2 of its 54 entries are HTML, so a normal
build correctly yields one document; the manuals are extracted, OCR'd and built
by a separate path. See *The military-medicine PDFs*.

**Watch for this shape on any new source.** A build that exits 0 having kept a
handful of documents from tens of thousands of entries has not succeeded — always
compare `DONE n documents` against the archive's article count before trusting it.

## Measured results

Built from `ifixit_en_all_2025-12.zim` on a Ryzen 5 5600U (6C/12T, 16 GB):

| | |
|---|---|
| Source | 3.3 GB, 894,836 entries |
| Codex | **133 MB** (114.0 core + 19.2 deep) — **25.6x smaller** |
| Documents | 82,269 (guides, devices, articles) |
| Context labels | 95% |
| Build time | **~3 min**, 10 workers |
| Dead-end links removed | 189,214 |
| Image-dependent (flagged) | 13,243 (16.1%) |
| Quick search | **4–10 ms** warm, over HTTP |
| Tests | 126 passing |

Wikipedia, built from `wikipedia_en_all_nopic_2026-06.zim`:

| | |
|---|---|
| Source | 52.7 GB, 19,191,219 entries |
| Codex | **30.4 GB** (20.0 core + 10.3 deep) — 58% of source |
| Documents | 7,077,143 · 4.16 billion words |
| Build time | 5.0 h pass 1, 10 workers, zstd 15 |

The whole corpus as loaded by the daemon:

| | |
|---|---|
| Codexes | **10** (13 built; three Wikipedia subsets off shelf) |
| Documents | **7,259,704** |
| Words | **4,291,424,010** |
| On disk | **33.77 GB** (23.12 core + 10.65 deep) |
| Source archives | 68.46 GB → **2.0x smaller** |

The four smallest were built in one 3-minute run and are worth noting for what
they cost rather than what they hold: `medlineplus` 14,932 docs from a 1.94 GB
archive, `ready-gov` 2,006, `nhs-medicines` 1,996, `mdn` 1,231. MDN is a partial
crawl — 1,231 kept of 2,299 HTML entries, the rest being live-sample iframes the
`min_words = 20` stub filter correctly rejects.

Search latency over HTTP, warm, all codexes loaded, after the query rewrite in
`_search_quick` / `_search_deep`:

| query | |
|---|---|
| `photosynthesis` | 29 ms |
| `norman conquest` | 40 ms |
| `battery` | 40 ms |
| `bat` (3-char prefix) | 208 ms |
| `insulin resistance mechanism` (deep) | 75 ms |

Sampled preflight against `wikipedia_en_all_nopic_2026-06.zim` (49 GB) projects
**~6.89M documents → ~19 GB**, at **~6 h** across 10 workers (pass 1 is 5 h of
that). Every `codexctl build` now prints this projection and checks the disk can
hold it before starting.

An earlier calibration claimed 2.10 h. It divided a single-core rate by 10 and
assumed linear scaling; measured against the real worker shape on this box,
throughput is **4w 212 · 6w 283 · 8w 320 · 10w 384 · 12w 370 docs/s** — 10
workers is the plateau and it buys 5.6x one core, not 10x.

## Install

The environment is machine-local, never portable: recreate it on each machine.

```bash
python3 -m venv .venv                          # Linux / macOS
.venv/bin/pip install -r requirements-build.txt

python -m venv .venv                           # Windows
.venv\Scripts\pip install libzim selectolax zstandard numpy Pillow pywebview pytest
```

`pywebview` is only needed by the Windows-only `launcher.py`. `codex/paths.py`
resolves every location from the project root; the overrides that exist are
`CODEX_DATA_DIR`, `CODEX_ART_DB`, `CODEX_WORK_DIR` and `CODEX_MILMED_DIR`.

## Fresh machine (the USB test)

Running the projector needs stock Python 3 + SQLite and nothing else — no
venv, no pip. The `.venv` above is only for cutting film (build), running
tools, and the test suite.

```bash
# Fedora / any Linux with python3 (3.10+) and sqlite3
git clone <repo> corpus && cd corpus
cp /media/usb/*.codex.db /media/usb/art.db data/   # the film travels separately
bash scripts/linux/start.sh                          # uses system python3, just works
```

Windows needs one thing Linux ships by default: Python itself
(`winget install Python.Python.3` or python.org), then the same clone +
`scripts\windows\start.ps1`. To *build* film anywhere, create the venv above
— `requirements-build.txt` is the whole build-time dependency list, fenced
out of the projector by `app/tests/test_stdlib_runtime.py`.

What travels and what doesn't: the repo (projector, canvas, tools, docs)
fits anywhere; `data/` (film, ~32 GB, git-ignored) moves by USB copy;
`.venv/` and `_work/` are recreated, never copied. A roll is one
`.codex.db` (+ optional `-deep.db`); WAL/SHM siblings move with it when the
daemon is stopped, and never while it runs.

## Build

```bash
python app/codexctl.py build "path/to/archive.zim" --out data --workers 10 --scratch /some/other/volume
```

Put `--scratch` on a **different volume** from the source archive: the transient
edge file is large (~2.7 GB for Wikipedia) and must not compete with a 49 GB
source for free space.

`--no-deep` skips the full-body index. `--zstd-level N` overrides body
compression (default 15). `--no-preflight` skips the size projection and
free-space check. Re-running resumes from the last checkpoint, which is written
every 50,000 documents **or every two minutes**, whichever comes first.

## Use

```bash
python app/codexctl.py info   data/ifixit.codex.db
python app/codexctl.py search data/ifixit.codex.db "iphone 12 battery" -n 5 [--deep]
python app/codexd.py                              # daemon on :8765, defaults to data/
python app/launcher.py                            # Windows-only global hotkey overlay
```

Keys: `↑`/`↓` move · `Enter` open · `Tab` quick/deep · `Esc` back.

The canvas is one window: a top bar with a menubar, back/forward and a single
search field; a home page; an article reader with a serif display face; the
library of cassettes; settings; and a side sheet holding contents, saved
articles and this session's history. Search has two doors — a popover that
answers while you type (seven hits and "all results"), and a full results page
with the projector's timing, total and per-codex attribution.

Views are separate ES modules under `app/web/views/` and are wired by
`app/web/app.js`; there is no build step and no bundler. Routes live in the
hash (`#/library`, `#/c/<name>`, `#/a/<codex>/<id>`, `#/search/<q>`,
`#/browse/<codex>/<letter>`, `#/settings`), so the same files work as a plain
page, inside the future Tauri window, and from a `/read?codex=&id=` permalink.

The shelf is served by the projector: `GET /api/library` returns one SPEC §3
manifest per loaded roll, built by `app/codex/cassette.py`. These are *shelf*
manifests — `sealed: false`, every `sha256` null, ids prefixed `shelf-` — so
nothing claims to be a packed cassette yet. `?all=1` adds rolls that are on
disk but not loaded. `app/tools/mock_library.py` writes
`app/web/mock/library.json` through the same builder; the canvas reads it only
when no daemon is there.

Which rolls are on the shelf is data, not code: `data/shelf.json` lists
`hidden` rolls (currently the three Wikipedia subsets that duplicate the full
roll). Hiding costs nothing and deletes nothing — remove a name to bring it
back. An explicit `--codex` is never filtered, and `CODEX_CODEXES` overrides
discovery entirely.

```bash
python app/tools/mock_library.py          # write the fallback fixture
python app/tools/mock_library.py --check  # exit 1 if stale
```

Hotkeys: `/` or `Ctrl+K` search · `Ctrl+F` find in article · `Alt+←`/`→`
back/forward · `Ctrl+D` save article · `Ctrl+\` contents · `Ctrl+L` library ·
`Ctrl+=`/`-`/`0` text size. The Windows overlay loads the same page via
`/?launcher` and stays a compact bar without the hero, because a centred hero
is wrong for a Spotlight-style window.

The client will not issue a query below two characters, and debounces at 120 ms.
Superseded keystrokes are cancelled with `AbortController` rather than merely
ignored, because an abandoned query still occupies a daemon thread until it ends.

Hotkeys are negotiated at startup, not hardcoded — the launcher claims the first
combination Windows will give it and prints what it got. On this machine that's
`Alt+Space` (quick) and `Ctrl+Shift+Space` (deep); `Ctrl+Alt+Space` was already
taken. Registration uses Win32 `RegisterHotKey` via ctypes rather than a
keyboard hook: no admin rights, nothing for antivirus to object to.

Serving a Pi to the LAN: `python app/codexd.py --host 0.0.0.0`. **No
authentication** — trusted networks only.

## The format

Plain SQLite. No custom container, no compiled extension. Any SQLite binding in
any language can read it — the only thing beyond standard SQL is that `doc.body`
is zstd-compressed JSON, with the dictionary in `zdict`.

```
codex.db        doc, redirect, related, zdict, fts_quick, codex_meta
codex-deep.db   fts_deep, vec       (ATTACHed if present, optional)
```

`codex.db` alone is self-sufficient — copy it to a stick and it works.

V0.1 had a `codex-media.db` holding an `image` table; it was removed along with
the rest of the image pipeline, and `tests/test_search_quality.py` asserts it
stays gone. Those tests still pass unmodified.

There is one more file, and it is not per-codex:

```
art.db          art, binding, art_meta   (one file, shared by every codex)
```

Optional in the same way `codex-deep.db` is — absent file, no images, nothing
else notices. Never ATTACHed. See *The image layer*.

Reading one without this project:

```python
import json, sqlite3, zstandard as zstd
db = sqlite3.connect("ifixit.codex.db")
zd = zstd.ZstdCompressionDict(db.execute("SELECT dict FROM zdict WHERE id=1").fetchone()[0])
dctx = zstd.ZstdDecompressor(dict_data=zd)
for title, body in db.execute("SELECT title, body FROM doc ORDER BY importance DESC LIMIT 5"):
    print(title, json.loads(dctx.decompress(body))[:1])
```

---

## Design decisions, and why (so you don't undo them)

Every one of these came from measurement that contradicted the obvious guess.
They look arbitrary until you know the number behind them.

**No images from a ZIM, ever.** See the sampling numbers above. This was tried
properly in V0.1 and removed on the evidence, not skipped. The curated `art.db`
added in V0.6 does not reverse it: those images come from Wikimedia at build
time, are licence-filtered at ingest, and live in their own file. The ban is on
the *source*, not on pictures.

**The merge compares specialisation, not raw scores.** Raw scores rank *within*
one codex: importance is that codex's own PageRank, so cross-codex comparison is
a comparison of two different graphs, and the bigger graph wins. Measured on the
shelf before the fix: `javascript promise` returned four Wikipedia articles and
no MDN at n=8; `hurricane evacuation kit` returned Wikipedia and Wikiversity and
no ready.gov. Both sources answered correctly when asked directly, so the data
was right and the merge was wrong.

The fix (`codex/merge.py`) is not a hand-tuned table per source. It asks each
codex how many of its own *titles* mention the query's terms, and weights by
that share — MDN: 6 of 1,231 (0.49%) for "javascript promise"; Wikipedia: 500 of
7,077,143 (0.007%). The ratio is scale-free, so no absolute threshold is needed
and a new codex is not penalised for being new. Measured after: MDN first,
ready-gov first, MedlinePlus still first on "diabetes", iFixit still first on
"iphone battery", Wikipedia still first on "tourniquet" (where every codex has a
single matching title, so the signal correctly has no opinion). The probe costs
0.5 ms across ten codexes.

Deliberately absent: a per-codex slot cap. Weights already break the monopoly,
and a cap would cut the source that is genuinely right (MedlinePlus returned
four good hits on "diabetes"). Titles are de-duplicated after fusion — a
repeated title inside one codex is dropped, one shared *between* codexes is kept
once and labelled `also`, because "MedlinePlus also has this" is information.

**Browse indexes containers, not leaves.** A codex is either a set of
independent pages or a shelf of books, and the film already says which: sections
name their container in `context_id`, containers are `kind=2`. Sorting the
flattened set by title is what put military-medicine's "APPENDIX 1..9" next to
each other under A — ten books fractured into one pile. So a book codex shows
its **entire shelf on one page**, in title order, with letter headings inside
the list and no filter: 22 manuals for military-medicine, 22 courses for
libretexts, 1,582 devices for iFixit (paged from the API, still one list).
Opening a book lists its children in `id` order, which is page order for the
manuals. Flat codexes keep the alphabetical door, because there the alphabet
*is* the index.

Two things this design refuses to do. It never walks *up* the container graph:
libretexts and iFixit both link containers in a loop
(`Fundamentals of Nursing → Nursing → Fundamentals`), so only downward
expansion is safe, and that is also all a table of contents needs. And it never
scans a big roll to find out: with no index on `kind`, `WHERE kind=2` costs
48 s on the 21 GB Wikipedia roll and nothing on a codex whose first container is
at id 1, so the probe is bounded at 0.5 s and a timeout means "flat" — the same
answer the scan would have given, without the scan.

**Read it like a book, not a database.** A section inside a container carries
its book and its place in it: the reader header reads *Military Medicine ·
Division and Brigade Surgeons' Handbook (FM 4-02.21)*, and the footer is
`← Previous · 25 of 40 · Next →`, following the container's `id` order — the
same order the contents view shows. `/api/doc` returns `nav` for this; on a flat
codex it is `null`. That is what turns 1,125 chunks into a manual you can read
straight through, and it costs one query over the container's direct children.

**What a build drops, and what it repairs.** Four rules, each narrow because
they delete documents (`codex/artifacts.py`):

- **Replay shells.** zimit stores a page under its replayed URL; a
  `…/runner.html?uuid=…` stub with under 80 words is a JS shell, not a page.
  MDN had 123 of them.
- **Foreign hosts.** A capture follows links off-site. The archive's own `Name`
  metadata says which site it is (`developer.mozilla.org_bc74bccb`), and only
  that host is kept. The majority host by path is *not* the answer — it is the
  capture origin, which is exactly where MDN's 141 shells lived.
- **Language pickers.** ready.gov opened 1,463 of its leads (84%) with
  "English / Español / 简体中文 / …". Stripped only when two or more language
  names stand alone at the very start, so a sentence that mentions languages
  survives.
- **Lead chrome.** "On this page", "Also called: RA", a page repeating its own
  title, and a three-or-more-line list of labels (a table of contents where the
  summary should be) are skipped before the lead is chosen. MedlinePlus had
  1,818 such leads; a guide's stats strip ("No estimate") was the preview on
  5,053 iFixit guides.
- **One source's navigation.** LibreTexts repeats "Table of Contents",
  "Front Matter", "Detailed Licensing", "InfoPage" and "Back Matter" once per
  book across ~1,500 books; 757 documents with no reading value. "Preface",
  "Glossary" and "Index" stay.

Measured after (2026-11-20, `tools/audit.py` before/after): MDN 1,231 → 1,082
(149 artefacts, zero left), ready.gov 2,006 → 2,002 (4 FEMA links; 1,463 leads
repaired, none left), libretexts 20,926 → 20,169 (757 navigation pages, books
and their 20,105 sections intact), MedlinePlus 14,932 → 14,930 (chrome leads
gone), iFixit 82,269 → 82,231 (5,053 "No estimate" previews fixed). Whole-shelf
`would drop` is now 2.

**The image layer never touches `search.py`.** Joining the binding table into the
ranked CTE is the obvious shape and it is the one thing this design refuses to
do — that query's plan is pinned by the 945 ms → 116 ms measurement below, and
the binding table is 227 rows. The daemon holds `(codex, doc_id) -> art_id` in a
dict and tags hits after the merge, so the search path is bit-for-bit unchanged.

**Rank on the FTS index, then join `doc` for the survivors only.** Putting the
join and the correlated context lookup inside the ranked query is the obvious
shape, and it makes both run for every *match* rather than every *result* — on a
four-character prefix that is 103,484 random reads into a 21 GB file to return
200 rows. Hoisting the ranking into a CTE cut `"batt"*` from 945 ms to 116 ms and
`"bat"*` from 1,438 ms to 188 ms, with identical top-5 output.

**Only the last query term is prefix-expanded, and only from 3 characters up.**
Prefixing every term made `"a"*` expand the whole vocabulary. Prefixing a *short*
last term is the same failure at the start of every word someone types:

| match | documents matched | latency |
|---|---|---|
| `"b"*` | 5,693,928 | 9,430 ms |
| `"ba"*` | 1,924,470 | 1,894 ms |
| `"bat"*` | 172,817 | 191 ms |
| `"batt"*` | 103,484 | 121 ms |

The cliff is between two characters and three, so `MIN_PREFIX = 3`. This is what
made the search box look dead: every keystroke fired, and the first one wedged
the daemon for minutes.

**The daemon has no global lock.** `Searcher` hands each thread its own read-only
connection, and `search_all` fans out across codexes instead of looping. One
shared `sqlite3.Connection` serialises every statement on it, so a single slow
query used to stall every codex for every client — and each source added made
every query longer. A `set_progress_handler` deadline (5 s) aborts any runaway
query; the handler granularity is 25,000 VM instructions, measured to overshoot a
2 s budget by 0.14 s against 1.28 s at 100,000, for no cost on normal queries.

**Match counts are capped, not exact.** Counting every match means visiting every
match, which is the cost the ranked query exists to avoid. Without `ORDER BY` the
`LIMIT` terminates the scan early: 0.7–22 ms against matches that take seconds to
rank. Over the cap the UI says "1,000+" rather than claiming precision it does
not have.

**Extraction newlines are repaired at read time (`model.reflow`).** Selectolax
applies its separator at every element boundary, inline ones included, so `The
<a>iPhone 6</a> and ...` is stored as `The\niPhone 6\nand\n...`. Every Wikipedia
lead in the corpus carries these — measured across 400 documents, 32,279 artefact
newlines against 5,192 genuine breaks. Newline *count* cannot tell them apart
(extraction emits mid-sentence double newlines too), but sentence shape can: a
break is real only where the text before ends a sentence and the text after
starts one. Done at read time so it fixes the 30 GB already built, without a
rebuild. A dash closes up only when it runs straight into the next word, so
`photopigment\n-bearing` becomes a compound while `energy\n— typically` keeps its
space.

**Only prose is reflowed — lists are left exactly as stored.** Tool lists, spec
sheets and see-also lists are newline-separated too, and the first version of
`reflow` merged them: it altered **61.8%** of iFixit sections, flattening
`CPU: AMD A10 / Max Turbo Speed: 3.3 GHz / Cache: 2 MB` into one run-on line —
destroying the same field boundaries the table handling exists to protect. Prose
is told apart by how its fragments *begin*: shredding a sentence at its inline
tags leaves many fragments starting mid-clause, while list items nearly all start
with a capital. Measured over ~1,500 sections of each corpus, the share of
fragments starting lowercase or with attaching punctuation is **0.00 median in
iFixit (82% have none) against 0.40 in Wikipedia (11% have none)**. Gating at
0.25 takes iFixit from 61.8% altered to **8.2%**, and that remainder is real
prose. Wikipedia's own list sections are spared by the same rule.

**Dangling image references are excised in tiers, never blindly.** With no
pictures, "as shown in the first photo" points at nothing — 16.5% of documents
had at least one. But a sentence like *"the third pic is up against the plastic
stop pointed to by the bottom yellow arrow"* still tells a technician something
real, so it is kept verbatim and the document is flagged (`WHERE flags & 1`)
rather than mangled or deleted. Pure pointers are dropped; parenthetical clauses
are excised and the punctuation repaired.

The rules carry explicit guards, each added after a dry run produced a wrong
result: `Image Resolution: 1920x1080` is a spec field, `Figure out how to…` is
not a figure, `picture-perfect` is an idiom, and `bootable images` are disks.
An earlier version deleted any line merely *starting* with an image noun and
destroyed spec sheets wholesale.

**Math becomes LaTeX.** mwoffliner emits every formula three ways: hidden
MathML, an SVG fallback, and the LaTeX source in the `<math alttext>` attribute.
Extracting MathML text yields character soup; the LaTeX is exact, compact and
greppable. This makes the corpus *smaller and better at once*.

**Tables keep their rows.** 27% of Wikipedia articles carry `table.wikitable`.
Flattening them to prose destroys every cell boundary — the one thing that makes
a table worth reading. They are stored as `{k:"table", headers, rows}` and
flattened only for the search index.

**Links are read from cleaned prose only, never the raw tree.** Collected before
stripping navboxes and citations, *The New York Times* and *Wayback Machine* won
Wikipedia's ranking outright — cited by everything, about nothing.

**Anything linked from >15% of the corpus is excluded from the graph.** iFixit's
404 interstitial ("Oups") had **58,721 in-links** and ranked #1 before this. Side
effect worth knowing: removing it turned ~38% of all links into dead ends, which
is why the dead-end rate reads 64.5% rather than 26.2%. Both numbers are correct;
the higher one is the honest one.

**Ranking is BM25 × PageRank importance.** BM25 alone answers "which document
contains these words most densely", which on a 7M-document corpus surfaces
obscure stubs. Importance is computed offline from the archive's own link graph —
no usage data, no telemetry, no network. After the two corrections above, the
top iFixit documents are *How To Solder and Desolder Connections*, *Electronics
Skills*, *Recognizing & Disconnecting Cable Connectors*, which is what a repair
corpus should look like.

**Search relaxes progressively.** quick AND → deep AND → quick OR → deep OR,
with a coverage boost so 3-of-4 terms beats 1-of-4. `nintendo switch joycon
drift` matches no single title; returning nothing is the worst possible answer.

**Disambiguation comes from inbound device links.** 1,028 iFixit titles are
shared by 2,343 documents (*Safety Precautions* ×42). The pages carry **no**
breadcrumb, no `Device/` link, no meta tag naming their parent — checked. The
only available signal is the reverse one: which device page links here. Computed
in pass 2 while the edge file is still on disk, stored as `doc.context_id`.

**Stripping "see Figure 4-25" costs 0.3%, and the first measurement of it said
7.2%.** The 7.2% was self-inflicted: OCR text hard-wraps mid-sentence, often after
one or two words in a narrow column, and splitting on those line breaks shredded
the prose before the figure rules ever ran. Reflowing first and re-measuring gave
4,077 words of 1,626,719. Pure pointer sentences (`See figure 4-3.`) account for
only 10–13 words per manual; almost all of it is inline clause excision. If a
cleanup rule looks expensive, check what else is doing the cutting.

**`strip_figure_directives` is deliberately not part of `clean_text`.** It needs
`fig`, `illus`, `photo` and their numbered forms, and those misfire on a general
corpus — `clean_text` is shared by 7.3M documents. Even inside a closed medical
corpus the risk is real: `plate` and `chart` were in the first draft and produced
112 false hits and not one true one — *perpendicular plate of the ethmoid bone*,
*dentures, braces, or partial plates*, *the Physiological Heat Exposure Limit
(PHEL) chart*. Both words were removed from the vocabulary.

The rules took four rounds against the built corpus, and every miss was invisible
until the text was read back out of the database:

- **Alternation order.** `fig` before `figure` turned *"The square knot
  illustrated in figure 3 is best"* into *"The square knot **ure 3** is best"*.
  Longest alternative first, with `\b`.
- **`fig.` is an abbreviation.** Splitting sentences on its trailing period tore
  `(fig. APP-I-3)` in half, after which neither piece looked like a reference.
  The sentence splitter needs the abbreviation guarded and a capital required
  after the break, or `(fig.` + `1-17)` sails through.
- **Case-insensitive character classes match lowercase.** `[0-9A-Z]` under
  `re.I` swallowed the word "and", truncating `(figs. 2-3A, 2-3B, and 2-3C)`
  halfway. Fixed with a scoped `(?-i:)`.
- **Figure numbers are not integers.** `215D`, `A-1A`, `B22`, `APP-I-3`,
  `7-6 OR 7-7`, `3-36C—E`. Matching only `\d+(-\d+)?` left 178 references in
  place.
- **The spec-field guard has a bracket in its label.** `Taping a Sprained Ankle
  (fig: 78) Cut 14 strips` parsed as a `Label: value` row and was waved through
  untouched.

**A document is not always in the entry you read it from.** LibreTexts (and
anything else `mindtouch2zim` produces) stores a 300-byte meta-refresh stub at
`index/page_N` carrying only a `<title>`, and the prose in
`content/page_content_N.json` — 7.5 MB of HTML against 348 MB of JSON. The
extractor only ever read `text/html`, so a generic build produced **6 documents
from 77,274 entries and exited 0**. The lesson is not "add JSON support": it is
that a build reporting `DONE` proves nothing. Compare the document count against
the archive's `article_count` before believing any new source.

**The context label has to be the book, not the parent.** LibreTexts has no
internal links at all — 459 fragment anchors and 173 off-site URLs across 400
sampled bodies, nothing pointing back into the archive — so the graph is rebuilt
from `content/shared.json`, a table of contents in which all 23,155 pages resolve
to a parent. Linking each page to its immediate parent was the obvious move and
it was wrong: the same textbook is remixed into many courses, so `5: Lipids`
names 23 different chapters and `Front Matter` 161, and **17.5%** of labels
pointed at a title too duplicated to identify anything. Walking up instead to the
nearest ancestor that is neither shelving, nor numbered like a chapter, nor one
of the skeleton pages every book repeats, gives the *book* — and that is what a
reader needs to tell two `Table of Contents` apart. Labels went from 86.4%
coverage with 17.5% ambiguous to **99.7% coverage with 0.0% ambiguous**.

Only book nodes are marked `KIND_DEVICE`, and each book links down to every page
beneath it rather than just its children. Both matter: pass 2 takes context from
the highest-ranked *inbound device*, so leaving chapters as devices puts
`5: Lipids` back on the label, and linking only to direct children never reaches
a section six levels down.

**Pass 2 picks `related` with numpy, not a dict of lists.** The obvious
implementation — a dict of per-source candidate lists, trimmed as it goes — is
fine at iFixit's 104k edges and fatal at Wikipedia's ~170M. Measured at the real
out-degree it runs at 145k edges/s and holds **6.9 KB per source, which is 46 GB
at 7M sources** on a 16 GB machine. It does not run out of memory quickly: it
does so about five hours in, after pass 1 is already paid for. The replacement
sorts each slice with `lexsort` and takes the top 12 per group, folding
candidates back down as it goes: **1.14M edges/s and a flat 0.65 GB**, bounded by
slice size rather than corpus size. Per-slice-then-merge is exact, not an
approximation — an edge in a source's global top 12 is necessarily in its own
slice's top 12. Verified row-for-row against the old implementation on iFixit:
all 85,224 `related` rows, all 78,489 context labels, identical.

**`np.add.at` in PageRank is already the fast path — don't "fix" it.** The same
call is right in one place and wrong in another, which is not obvious from
reading it. For the **float-weighted** rank accumulation numpy 2.5 runs it at
0.42s per 32M edges, marginally *faster* than the equivalent `bincount`. For the
**integer** in/out-degree counts it is 4.74s against 0.61s — eight times slower.
So the degree counters use `bincount` and the PageRank inner loop does not.

**Edges are durable before the checkpoint that accounts for them.** `_flush`
used to COMMIT the document rows and *then* write the edge buffer. A crash in
the gap left up to 50,000 documents with no outbound links — no error, no
warning, just a quietly worse graph discovered hours later. The order is now
inverted and the edge file's byte offset is committed alongside `resume_entry`,
so a resume rewinds the file to the last consistent point instead of appending
to a partial one.

**zstd level 15, not 19.** Level 19 cost 0.94 ms/doc against 0.55 for 15 — a
tenth of the entire per-document budget for the longest pass. On 584 sampled
Wikipedia articles the size difference was 31.05% of the JSON against 31.19%,
about 30 MB on a 7.9 GB body store. On iFixit, where the dictionary is now
trained at the same level it compresses at, level 15 came out **0.13% smaller**
than 19. Override with `--zstd-level` if you want the last fraction.

**maxi and nopic cost the same to build.** Worth knowing before reaching for the
115 GB archive: the extractor rejects image entries on mimetype *before*
`bytes(item.content)` decompresses anything, so it never touches an image
cluster. Both flavours deliver identical 43 KB/doc of article HTML at ~6.4 ms to
read. The file-size difference is invisible here — pick on content freshness,
not on size.

**`related` falls back to similarity.** Link-derived neighbours cover only ~28%
of documents, because once furniture is excluded most guides don't cross-link.
The other 72% get a title-similarity lookup against `fts_quick`, computed at
query time — no storage, and it only runs when the stored list is empty.

## Adapters

Extraction is per-source (`codex/adapters.py`). An adapter decides which
container holds real content, what furniture to discard, which paths to skip
*before* decompressing, and what counts as a stub. Adding a source = adding one
class. Currently `wikipedia`, `ifixit`, `libretexts`, `generic`.

Two hooks exist for sources that are not self-describing, both no-ops by default
so no existing adapter is affected:

- `prepare(archive)` — build an archive-wide index once per worker, called from
  `_worker_init`. Used to load a table of contents.
- `source_for(archive, entry, raw)` — return the HTML to actually parse, which
  is normally the entry's own bytes. Returning `None` drops the entry.

`tools/calibrate.py` calls both, deliberately: without `source_for` the
projection reads routing stubs and confidently predicts a corpus of nothing,
which is precisely the failure it exists to catch.

Things the adapters exist to handle, all found by measurement:

- iFixit `User/` pages are **56%** of HTML entries, median **3 words**.
  Rejecting them by path skips decompression entirely.
- Every redirect in the iFixit archive is an image-dedup redirect, not a title
  alias. Wikipedia's are the opposite and matter enormously for search.
- iFixit emits every guide step **twice** (desktop + mobile). Naive extraction
  doubled the corpus: 67.8M → 49.1M words once deduplicated.
- mwoffliner wraps each section in its own `<section>`, so a flat scan of the
  content root finds no headings and collapses the whole article into one blob.
  Symptom when this regresses: high word counts, near-zero stored bytes.
- **Not every wiki puts prose before the first heading.** Wikipedia always does;
  Wikiversity starts ~30% of its pages on a heading (*Presentation*, *Module
  Overview*) or leaves the first section empty. `fts_quick` indexes title+lead,
  so an empty lead makes a document findable by **title alone** — measured on
  the first wikiversity build, 14,698 of 49,695 documents, every one of which
  had body text. `_derive_lead` takes the first section that actually carries
  text. Watch this number on any new source: `SELECT COUNT(*) FROM doc WHERE
  lead IS NULL OR lead=''`.
- iFixit guides insert a synthetic `Tools` section at index 0, so a blind
  `sections[0]` fallback made the *tool list* the preview. The fallback is
  computed before that insert.

### Will it run on any ZIM?

It will *run* on any ZIM. Whether the result is any good depends on whether an
adapter matches — routing is by the archive's `Name`/`Creator` metadata, not by
filename. Measured across 18 archives on disk:

| routes to | archives | verdict |
|---|---|---|
| `wikipedia` | Wikipedia ×5, Wikiversity, Wikivoyage | good |
| `ifixit` | iFixit | good |
| `generic` | MedlinePlus, NHS, ready.gov, MDN | **built**, usable |
| `generic` | LibreTexts | **bodies in JSON** — needs an adapter |
| `generic` | Aviation + Mechanics StackExchange | **needs an adapter** |
| `generic` | irp.fas.org | PDFs, not HTML |
| `wikipedia` | Wiktionary | **wrong shape** |
| — | maps, TED | **not text** |

Five things go wrong outside the two real adapters, all measured:

- **`GenericAdapter.exclude_prefixes` is empty**, while both real adapters
  exclude user pages (`User:`, `User/`). Sampling Mechanics StackExchange, **4 of
  5** HTML entries were `users/*` profiles. Those would become documents *and*
  accumulate enormous in-degree — every question links its participants — so they
  would dominate PageRank. Any new generic source needs its own exclusion list
  before the graph means anything.
- **Q&A structure is lost.** ~99K StackExchange documents flatten to prose,
  discarding question/answer/accepted boundaries. Worth its own adapter.
- **Dictionaries don't fit the model.** Wiktionary routes to `wikipedia`; 64% of
  entries survive, but the median is 21 words and the *leads come out empty* —
  and `fts_quick` indexes title+lead, so quick search degrades to title-only.
- **The body may not be in the HTML at all.** LibreTexts is a crawled JS app:
  title in a 300-byte HTML stub, prose in a sibling JSON entry. The extractor
  only ever reads `text/html`, so this produced 6 documents from 77,274 entries
  *and exited 0*. See the coverage section above.
- **The archive may not be HTML.** irp.fas.org is 24 PDFs and 2 HTML pages. It
  builds to one document, correctly, and is not worth a codex.

Both of those last two are silent: the exit code is 0 and the log says `DONE`.
The check that catches them is comparing the document count against the archive's
`article_count` — `tools/calibrate.py` prints both before you commit to a build.

MedlinePlus was expected to be the weak one — an earlier probe found a page
titled *"Do you know your family health history"* getting `Genetic Testing` as
its lead, suggesting `content_root` picks the wrong container there. Measured on
the built codex, that did not generalise: **0 empty leads of 14,932**, 1.3%
orphans, and the top pages read correctly (*"Hypertension is abnormally high
blood pressure in the arteries…"*). The misfire is real but rare.

**ready.gov has furniture in its leads.** Every page begins with its language
switcher, so leads start `English / Español` before the actual prose, and 53.3%
of documents are orphans. Usable, and the worst-looking of the four new codexes.
A ready.gov subclass with a junk selector for the switcher would fix it; the
generic adapter's `junk` list is shared, so this needs a subclass rather than an
edit in place.

## The military-medicine PDFs

`irp.fas.org_en_military-medicine.zim` is not a website. 24 of its 54 entries are
PDFs and only 2 are HTML, so a codex build correctly produces one document and
nothing of value. The manuals themselves are worth having — Special Forces
Medical Handbook, Emergency War Surgery, War Psychiatry, Hospital Corpsman,
bandaging, field sanitation — so they are extracted to files instead:

```
<root>/milmed/raw/        the 24 PDFs exactly as stored in the ZIM      72 MB
<root>/milmed/ocr/        the same manuals, every page searchable      330 MB
<root>/milmed/text/       plain text, one file per manual               11 MB
<root>/milmed/figures/    illustrations, <book>/p<page>_<xref>_<n>.png  110 MB
```

(`milmed/` sits next to the project root by default; point `CODEX_MILMED_DIR`
anywhere else. On the original Windows box this was `D:\milmed`.)

The searchable copies are ~4.5x the originals: Tesseract re-encodes the page
images rather than passing the CCITT G4 streams through. That is the price of the
text layer, and 330 MB against 214 GB free is not worth optimising.

Rebuild with `app/tools/milmed_ocr.py` (`--figures-only` re-does just the images).

**OCR is decided per page, not per file.** The obvious reading — "these are
scans, OCR them" — is wrong for four fifths of the pages. Result over the 22
manuals actually processed:

| | |
|---|---:|
| pages | 4,175 |
| pages needing OCR | **814** (19.5%) |
| pages already carrying text | 3,361 (80.5%) |
| words extracted | **1,642,063** |
| figures | 856 |

Re-recognising a page that already has a perfect text layer throws accuracy away
and costs an hour. Pages that already carry text are passed through untouched —
verified byte-for-byte: `corpsman-pt1` reads 5,833 characters over its first six
pages before and after.

Worth knowing if you re-run the triage: a 30-page sample per file suggested 13
manuals were pure text and needed no OCR at all. Checking **every** page found
none — each of those 13 still has a handful of scanned plates or blank leaves, so
17 of 22 come out as mixed and 5 as pure scan. Sampling gets the size of the job
right and its shape wrong.

**`sfhandbook-pt2.pdf` and `-pt3.pdf` are skipped as duplicates.** Hashing every
page image puts 264 of their 265 pages inside `sfhandbook.pdf` (408 unique pages
against 669 across the three files). `sfhandbook-pt1.pdf` is not a PDF at all —
the ZIM stores a 5 KB HTML error page under that name.

**300 DPI is native here, not an upscale.** The embedded CCITT G4 images are
1554×2518 and a 300 DPI render comes out 1554×2517. Dropping to 200 produced
identical body text but lost running heads (the `2-38` folio); going higher only
interpolates. No deskew or denoise: the source is already binarised, and cleaning
filters erode thin strokes on exactly the technique diagrams worth keeping.

**Figures are rendered from the page, never pulled out with `extract_image`.**
Most illustrations in these manuals are stencil masks (`/ImageMask true`) — a
1-bit bitmap that selects where to paint the fill colour, and meaningless on its
own. Extracting the raw stream yields a white-on-black, vertically flipped
negative; a NAVMED competence-for-duty form came out unreadable that way.
Rendering the clip rectangle applies the decode array and the page matrix.

**On image quality, there is nothing to recover.** The page scans are 1-bit, so a
screenshot carries exactly the same information as the stored bitmap and
upscaling adds none. This is not the Kiwix situation: those were downsampled
photographs, these are line art at ~200 DPI, which is genuinely crisp. If a
particular manual deserves better, the answer is re-sourcing it — most are
public-domain US Army and Navy field manuals — not enhancement.

### The codex

`tools/milmed_build.py` turns the OCR'd PDFs into `military-medicine` — the only
codex not built from a ZIM. Everything after extraction is source-agnostic and
reused unchanged (`schema`, `graph.resolve_and_rank`, `index.build_quick` /
`build_deep`), so only pass 1 is replaced.

| | |
|---|---:|
| Documents | **1,147** (22 manual nodes + 1,125 sections) |
| Words | 1,650,994 |
| Median section | 1,644 words |
| Context labels | 98.1% |
| Empty leads / orphans | 0 / 0 |
| Size | 5.7 MB core + 8.4 MB deep |

**Segmented by heading, bounded by size.** Headings alone do not work: 608 across
22 manuals, but `corpsman-pt1` has 3 for 63,005 words while `rhpm` has 75 for
33,450 — segments would run from 446 to 21,002 words. A new document starts at
each heading, anything past ~1,500 words is cut at a page boundary, and anything
under ~200 is folded into its neighbour.

**Every document cites its source three ways** — `doc.meta` carries
`{manual, id, pages, source_url, citation}`, the manual is a `KIND_DEVICE`
document so pass 2's inbound-device rule puts its name on every section as the
context label, and a Source line is appended to the body so a model quoting the
text carries the attribution with it. Manual titles and identifiers (FM 21-11,
ST 31-91B, NAVEDTRA 14295, TB MED 266 …) are a curated table verified against
each document's front matter, because cover-page OCR is unreliable —
`corpsman-pt2` auto-extracts as `CHAPTER 4`.

**Directives to look at a picture are removed.** See
`hygiene.strip_figure_directives` and the design note below. 97.8% of ~2,400
figure pointers are gone; the ~54 survivors are OCR-mangled fragments split
across page breaks.

## The image layer

100 curated pictures in `data/art.db`, 21.4 MB, WebP at ~2 MP. Separate from
the text pipeline in every way that matters: separate file, separate build,
separate tests, and no change to `codex/search.py`.

```bash
python app/tools/art_manifest.py     # resolve + review
python app/tools/art_build.py        # fetch, encode, build
python app/tools/art_build.py --report
```

**Subjects are curated, not ranked.** Top-by-importance on the wikipedia codex is
`Wayback Machine`, `ISBN`, `IMDb`, `United States`, `Association football` —
link-graph furniture, and useless as picture subjects. PageRank answers "what
does this corpus point at most", which is a different question from "what does a
reader need to see". The list in `tools/art_subjects.py` is 100 subjects across
10 disciplines, weighted towards the corpus: anatomy, field medicine, pathogens,
hazards, tools, water and navigation.

**Relevance comes from the article's own lead image.** `prop=pageimages` returns
the picture Wikipedia editors already chose, so no search heuristic is involved.
Measured, that alone is not enough: **29 of 100 leads came back under 1.2 MP**,
some at 0.05 MP, because MediaWiki will not upscale past the original. The
fallback walks the article's other images in page order and ranks them by how
many subject words appear in the filename — ordering only, never rejection,
because `Common-foxglove.jpg` is exactly right for *Digitalis* and shares no word
with it, which is what the aliases in `art_subjects.py` are for.

**Everything substituted is marked `review` and nothing auto-approves.** The
first version of that fallback picked an African elephant skull for *human
skull*, a MediaWiki UI icon for *Vibrio cholerae*, and two `.webm` videos. All
three now fail a check — but the general lesson stuck, and a machine-chosen
picture never reaches `art.db` without appearing in the contact sheet first.

**Licences are allow-listed at ingest**: PD, CC0, CC BY, CC BY-SA. Non-free,
fair-use and NC are dropped with the reason recorded; GFDL-1.2-only is excluded
deliberately, since its full-licence-text obligation is not one this project
meets. `artist` is HTML-stripped, because the API returns markup and the reader
renders it. 29 of the 100 are public domain; the rest carry a visible credit
line, which the BY licences require.

**Never construct a thumbnail URL.** Guessing a width returns `HTTP 400: Use
thumbnail sizes listed on ...`. Ask for `iiurlwidth` and use the `thumburl` that
comes back — which also means downloading ~300 KB instead of an 8.3 MB original.

**Wikimedia rate-limits, and retrying is what escalates it.** At a 1 s baseline:
`Retry-After: 1`, then a sustained `Retry-After: 10`, then a flat
`Retry-After: 600` after 35 images. Retrying a 429 at the *same* rate is the
mistake. `art_commons.polite_get` now widens the interval for the whole run on
every 429 (2 s → 15 s), and treats a `Retry-After` above 180 s as a cooldown to
stop on rather than sit through. Downloads are cached under
`_work/art_cache`, so a stopped run resumes for free. The rebuilt run
took 4 rate-limit hits across 65 images and finished.

Running without `CODEX_CONTACT` is a deliberate choice — no personal address in
anyone's server logs — and it is paid for in rate, not in failures.

**Storage.** `art` holds both derivatives (hero WebP q82 at long-edge 1600, thumb
q70 at 400) plus provenance; `binding` maps `(codex, doc_id) → art_id`. One
image, many bindings: 100 images carry 227 bindings across 10 codexes, because
*Bacteria* is a document in three of them. Measured: 21.4 MB total, largest hero
495 KB against a 500 KB cap held by a quality step-down ladder.

**Serving.** `GET /art/<slug>.webp` and `.thumb.webp` for bytes, immutable
cache headers; `GET /api/art?codex=&id=` for credit metadata. `/api/doc` is
unchanged — the reader fires the art request concurrently rather than widening
the document payload.

`tools/art_build.py` also writes `_work/art_contact_sheet.html`, a local
offline page of every stored image with its credit. Filenames only go so far:
`Cinchona alkaloids.svg` and a photograph of the tree are indistinguishable in a
log line and obvious side by side.

## Tests

```bash
python -m pytest app/tests/ -q
```

Works from any directory: the suite locates `data/` through the same
`codex/paths.py` module the application uses, and the daemon boot test runs a
real daemon on a scratch port. 126 passing on Windows as of V0.6; 138 on Linux
after the portable-layout migration (2026-09-25); 161 on Linux after the canvas
rework (2026-11-15), twelve of them `test_web_assets.py`: no external URLs in
the canvas, every import and `/static/` reference resolves, and the cassette
fixture matches SPEC section 3 without inventing a digest.

Pinned expected hits for 10 queries, ordering and dedup, zstd round-trip against
the stored dictionary, referential integrity of redirects and related rows,
`PRAGMA integrity_check`, latency (quick p95 <30 ms, deep p95 <300 ms), prefix
gating, and the `reflow` rules (compound hyphen vs spaced dash, real paragraph
break vs mid-sentence double newline).

Run these after touching `codex/search.py` or the ranking blend — ranking
changes are easy to make and impossible to eyeball.

## Tools

`calibrate.py` is the useful one: point it at any ZIM to get extraction ratios,
compression, and a projected output size before committing to a long build — and,
just as importantly, the document count it expects, which is what tells you a
build has silently failed. `audit.py` is the second: it scores every roll on the
shelf for the diseases that actually shipped (zimit replay shells, off-host
pages, URL-shaped titles, language-switcher leads, near-empty documents) with
samples and a "would drop" count, so a rebuild is a measured diff rather than a
hope. It deliberately does *not* call a repeated title junk — every book has a
"Chapter 1". `gaps.py` reports what's missing or degraded in a
built codex. `try_hygiene.py` dry-runs the image-reference rules against a built
corpus, `rebuild_deep.py` rebuilds a deep index without a full rebuild, and
`stats.py` is a quick summary. `milmed_ocr.py` rebuilds `milmed/` from the
extracted PDFs and `milmed_build.py` builds the `military-medicine` codex from
them — the two tools here that are about a single source rather than the
pipeline. `art_subjects.py` is the curated subject list, `art_manifest.py`
resolves it to a reviewable manifest without downloading anything, and
`art_build.py` fetches, encodes and builds `art.db`; `art_commons.py` holds the
Wikimedia client and the licence policy they share.

`tools/attic/` holds the one-off probes that produced the numbers quoted
throughout this README. They are kept as evidence and are not maintained — a
claim you can't re-derive is one you'll eventually undo by accident. Several
target the removed image pipeline and won't run unmodified.

## Not built yet

- **Embeddings** (pass 5). `vec` table exists, empty. Plan: bge-small via
  onnxruntime, binary-quantised to 48 bytes, top ~500k documents by importance.
  No GPU on this machine (512 MB iGPU), so it's CPU-bound — hence the subset.
- **TUI** (Textual) and **MCP server**. Both are clients of the daemon's JSON
  API, which is why that API was built first.
- **A StackExchange adapter.** ~99K documents across the two archives on disk,
  currently blocked on `users/*` noise and lost Q&A structure. See *Will it run
  on any ZIM?*
- **A ready.gov subclass** to strip the language switcher out of its leads.
- **Stopwords.** "how plants convert sunlight" returns *Sunlight*, not
  *Photosynthesis*, and "how does a transformer work" is the slowest query
  measured (319 ms) because it relaxes through every tier. Matters more for
  natural-language RAG queries than for keyword search.
- **Extraction-side newline fix.** `model.reflow` repairs these at read time, so
  nothing is broken; but `adapters.py` still emits them, and a source that fixed
  it properly would need no repair.
