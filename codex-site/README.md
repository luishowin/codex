# Codex: offline knowledge corpus site

A single-page site for **Codex**, built from `x-design.md` (the X / x.ai design
language): near-black `#0A0A0A`, the xVf variable font, pill shapes, hairline
borders, one orange accent, and the rotating hero word with the rainbow
underline. Plain HTML, CSS, JS: no frameworks, no network calls.

## Open it

```
# static only (animations + embedded stats work; live search shows a hint):
xdg-open index.html

# full experience, including live search over the real DBs:
python3 serve.py          # -> http://127.0.0.1:8766/
```

`serve.py` is stdlib-only. It serves this folder and adds:

- `/api/search?q=<term>`: real FTS5 over `fts_quick` (title + lead) across
  every `*.codex.db`, merged and rank-ordered. `&codex=NAME` restricts.
- `/api/corpora`, `/api/health`

If the corpus lives somewhere else:
`python3 serve.py --codex /path/to/codex --port 8766`

## Where the numbers come from

`corpora.js` is generated from the real databases: doc counts, word counts,
byte sizes, demo query results and timings. Nothing in it is hand-written.

To regenerate (after building a new codex):

```
python3 gen_codex_data.py     # reads <codex dir>/*.codex.db + art.db -> corpora.json
python3 -c "import json; open('corpora.js','w').write(
    'window.CODEX_DATA=' + json.dumps(json.load(open('corpora.json'))) + ';\n')"
```

## Layout

- `index.html`: page
- `styles.css`: the design system applied (tokens at the top)
- `app.js`: entrance animation, word rotation, counters, terminal tabs, live search
- `corpora.js`: corpus data (generated)
- `serve.py`: static server + search API
- `fonts/`: xVf + GeistMono (self-hosted, from the x-design kit)