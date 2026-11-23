# The family reader

Open **Family library** on the Codex home screen, or visit **http://127.0.0.1:8765/reader**. Open **The reading room** to read the Wikipedia specimen or the supplied tea article. **Reference shelf** opens the installed standalone books. The original projector interface remains at the home address.

On a fresh computer, copy the project and the cassettes you want to read. Use stock Python 3.10 or newer with SQLite FTS5. From the project directory run `python3 app/codexd.py` on Linux or macOS, or `py -3 app/codexd.py` on Windows. Keep the process running while reading. The existing platform launchers also start the server. The reading path uses the Python standard library, browser JavaScript, and local fonts. Building books requires the separate build dependencies.

## Reader style

Use the supplied `codex-home.html` as the visual reference for reader screens. The library uses a compact monospace header, outlined controls, ruled lists and upright paper covers with a clipped corner. Set article prose in the local serif face and use the local sans serif for descriptions and table labels. Keep the same search position and neutral light and dark palettes throughout.

## Taking a book with you

A cassette is a folder inside `data/cassettes/`, with a UTF-8 `cassette.json` and one or more books. Copy the entire folder to another installation, or set `CODEX_DATA_DIR` to a data directory on removable storage. Open the library again after inserting or removing media. Book paths resolve relative to the manifest. Folder names can change. Keep the cassette and book IDs stable across copies. IDs use letters, digits, underscores and hyphens. The reader reserves the cassette ID `shelf` for standalone books. When two folders claim the same cassette ID, the reader waits until the ambiguity is resolved.

```json
{
  "version": 1,
  "id": "reading-room",
  "title": "The reading room",
  "books": [
    {"id": "wikipedia", "file": "wikipedia.codex.db"},
    {"id": "tea", "file": "tea.codex.db"}
  ]
}
```

Each core is an independently readable SQLite file. An adjacent `.codex-deep.db` adds full-text search. The specimen builder publishes closed databases in rollback-journal mode so copies also work on read-only media. When moving older databases, follow the project's WAL handling instructions.

## Article format

SQLite schema 1 supports two article representations. Existing books have the original section list. A structured book declares `article_format=2` in `codex_meta`. Its `doc.body` is zlib-compressed UTF-8 JSON containing a section with `k: "rich"` and a `blocks` list. Each node is a string or an object with a semantic HTML `tag` and ordered `children`. The reader supports paragraphs, heading levels, emphasis, lists, quotations, tables, citations and code. Table cells can carry integer spans. Nodes can carry an `anchor`, an in-article `ref`, a book-relative article `path`, or an external `url`. The reader recognizes a fixed set of tags and attributes.

The source path identifies the article. Article metadata carries its source, source identifier, URL, license and any illustration note. Book metadata carries its title, source file, date and build identity. The specimen builder derives the build identity from the book metadata and article contents. Saved routes include the cassette ID, book ID, build identity, document count and original source path.

**Article** provides HTML export, plain-text export, print and bookmarks. To request an amendment, optionally select a passage first. **Reading desk** lists bookmarks and requests and can export the requests as JSON. These records belong to the browser profile on this computer. Use the same server address to return to them. A request retains its quotation, source and edition after the book is removed or replaced.

## Reviewing the Wikipedia edition

The specimen contains the 16 consecutive titles in the supplied index screenshot in their original display order, followed by *A (cuneiform)*, *Kelvin*, and *Impossible trident*. The June 2026 no-picture ZIM provides their texts. Short index descriptions are editorial. The tea article belongs to the separate *Reading specimens* book and credits the supplied adaptation.

| Case | Finding and treatment |
|---|---|
| A (cuneiform) | The original sign survives the previous distillation. The bundled cuneiform font displays it. The source has two opening paragraphs, preserved separately. Empty inline illustration slots are marked. The awkward opening sentence is present in the source. |
| A 5120 and A A Dhand | The old index concealed the subject. Source-grounded descriptions identify the computer and writer before opening either entry. |
| A Aa E Ee and the two films | The disambiguation list and its local film links survive. The source heading restores the space before each parenthetical qualifier. |
| A 4 App and A Album | Track lists use their own source table class. Their order and cells are preserved alongside the other data tables. |
| Kelvin | Check the SI multiples table, units, superscripts and reference markers. The build uses the project's existing formula extraction. |
| Impossible trident | The source describes a visual illusion. The edition marks the missing illustration and lets the reader assess the surviving description. |
| Tea | Check scientific italics, numbered steps, nested lists, a block quotation, table headings, units and print/export. |

To reproduce the review cassette, run `app/tools/reader_specimen.py SOURCE.zim TEA.html NEW_FOLDER` with the build interpreter. The tool requires a fresh destination and rebuilds both optional deep indexes. The included cassette works without either input.

## Pilot and full-build decision

The repeatable pilot samples 1,536 random archive entries using seed 202606. Run `app/tools/reader_pilot.py SOURCE.zim CURRENT.codex.db NEW_FOLDER` with the build interpreter. It writes a core database, a deep index and a JSON reconciliation. The pilot is deliberately off the family shelf. The source remains available for re-distillation.

| Measured outcome | Result |
|---|---:|
| Source archive article count reported by libzim | 19,191,219 |
| Sampled archive entries | 1,536 |
| Included articles | 593 |
| Native redirects / HTML redirects | 798 / 95 |
| Other media / excluded namespaces | 46 / 3 |
| Empty after extraction / failed | 1 / 0 |
| Core / deep index | 3,452,928 / 3,358,720 bytes |
| Matched articles with comparable stored bodies | 585 |
| Existing compressed bodies / candidate compressed bodies | 945,296 / 2,423,505 bytes |

The excluded empty entry, *Stefano Ortale*, had no surviving article text. The pilot audit recorded zero empty leads, furniture leads, replay shells or off-host pages. It flagged 17 short articles for human review. The specimen and pilot omit the full link-graph pass, so their zero in-degrees are expected. Their index sizes include small-database overhead.

On the paired articles the structured bodies took **2.56 times** the existing compressed body space. That comparison includes citations and tables omitted by the older extraction. It does not predict a full archive size. The current core and deep files occupy **32.89 GiB combined**. The pilot gives no basis for promising **30.00 GiB**.

The specimen was approved for reading quality on 2026-11-24. A production build also needs to carry this representation through the streaming Wikipedia builder, its redirect and graph passes, checkpoints, and coverage accounting. Repeat the pilot after changes to encoding or inclusion. Build alongside the existing edition, reconcile all input outcomes, run gaps and audit, and review a fresh sample before changing the shelf.
