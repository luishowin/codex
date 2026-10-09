#!/usr/bin/env python3
"""Build the `military-medicine` codex from the OCR'd manuals in D:\\milmed\\.

The only codex not built from a ZIM. Everything after extraction is source
agnostic and reused unchanged -- `schema.init_core`, `graph.resolve_and_rank`,
`index.build_quick` / `build_deep` -- so only pass 1 is replaced here.

Reads `D:\\milmed\\ocr\\*.pdf` rather than the flat text files: the PDFs carry
exact page numbers and the citations need them.

Three things this does that the ZIM path does not:

  * **Strips figure directives.** The codex holds no images, so "as illustrated
    in Figure 4-25" points at nothing. `hygiene.strip_figure_directives` removes
    the directive and keeps the instruction. Costs 0.3% of the text.
  * **Cites every document** -- manual title and page range in `doc.meta`, the
    manual as the context label, and a Source line in the body so a model
    quoting the text carries the attribution.
  * **Segments by heading with a size bound.** Headings alone do not work here:
    608 across 22 manuals, but corpsman-pt1 has 3 for 63,005 words while rhpm
    has 75 for 33,450.

    python tools/milmed_build.py [--out <data dir>] [--name military-medicine]
"""
from __future__ import annotations

import argparse
import json
import os
import re
import struct
import sys
import time
import zlib
from collections import Counter
from pathlib import Path

import fitz

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from codex import graph as G
from codex import index as I
from codex.build import EDGE_STRUCT, ZLIB_LEVEL, log, path_hash
from codex.hygiene import strip_figure_directives
from codex.model import KIND_ARTICLE, KIND_DEVICE, Doc, Section, norm
from codex.paths import MILMED_DIR, data_dir
from codex.schema import (BUILD_PRAGMAS, SCHEMA_VERSION, apply_pragmas,
                          init_core, init_core_indexes, init_deep,
                          init_fts_quick, set_meta)
import sqlite3

SRC = MILMED_DIR / "ocr"
BASE_URL = "https://irp.fas.org/doddir/milmed/"

# Curated, not auto-extracted: cover-page OCR is unreliable -- corpsman-pt2
# yields "CHAPTER 4". Identifiers verified against each document's own front
# matter; where a manual states none, the field is left out rather than guessed.
CITATIONS: dict[str, tuple[str, str]] = {
    "bandage":       ("Bandaging and Splinting", "FM 8-50"),
    "childbirth":    ("Childbirth: A Reference Guide for Students",
                      "Medical Self-Help Training Course, Lesson 11"),
    "corpsman-pt1":  ("Hospital Corpsman, Part 1", "NAVEDTRA 14295"),
    "corpsman-pt2":  ("Hospital Corpsman, Part 2", "NAVEDTRA 14295"),
    "corpsman-pt3":  ("Hospital Corpsman, Part 3", "NAVEDTRA 14295"),
    "dental":        ("Disinfection and Sterilization of Dental Instruments "
                      "and Materials", "TB MED 266"),
    "dosimetry":     ("Personnel Dosimetry Guidance and Dose Recording "
                      "Procedures for Personnel Occupationally Exposed to "
                      "Ionizing Radiation", "DA PAM 40-18 / DLAI 1000.30"),
    "duequip":       ("Handling Procedures for Equipment Contaminated with "
                      "Depleted Uranium or Radioactive Commodities",
                      "DA PAM 700-48"),
    "family":        ("Family Guide: Emergency Health Care",
                      "Medical Self-Help Training Course"),
    "first":         ("First Aid", "FM 4-25.11 / NTRP 4-02.1 / AFMAN 44-163(I)"),
    "malaria":       ("Pocket Guide to Malaria Prevention and Control",
                      "Navy Environmental Health Center"),
    "milderm":       ("Military Dermatology", "Textbook of Military Medicine"),
    "preventive":    ("Preventive Medicine", "DA PAM 40-11"),
    "prevserv":      ("Preventive Medicine Services", "FM 4-02.17"),
    "rhpm":          ("Radiation Health Protection Manual", "NAVMED P-5055"),
    "sanitation":    ("Unit Field Sanitation Team", "FM 4-25.12"),
    "sfhandbook":    ("US Army Special Forces Medical Handbook", "ST 31-91B"),
    "ships":         ("The Ship's Medicine Chest and Medical Aid at Sea",
                      "US Public Health Service"),
    "soldiers":      ("First Aid for Soldiers", "FM 21-11"),
    "sterile":       ("Sterilizing Medical, Surgical, Dental, and Veterinary "
                      "Materiel", "TB MED 2"),
    "surghand":      ("Division and Brigade Surgeons' Handbook", "FM 4-02.21"),
    "warpsychiatry": ("War Psychiatry", "Textbook of Military Medicine"),
}

# Section headings as these manuals write them: "CHAPTER 4", "Section III.",
# "1-4. BACTERIAL SKIN INFECTIONS", "9.2 Nutrition".
HEADING = re.compile(r"""^(?:
    (?:CHAPTER|Chapter|SECTION|Section|PART|Part|APPENDIX|Appendix)\s+[0-9IVXL]+\b.{0,60}
  | \d+-\d+\.?\s+[A-Z][A-Za-z].{0,70}
  | \d+\.\d+\s+[A-Z][A-Za-z].{0,70}
)$""", re.X)

# OCR debris: table-of-contents dot leaders and runs of stray one/two-letter
# tokens. 0.5% of all lines, concentrated in front matter.
GARBAGE = re.compile(r"\.{4,}|(?:\b[a-z]{1,2}\b[ ,]+){5,}")

# A trailing period that is an abbreviation, not a sentence end.
ABBREV_END = re.compile(
    r"\b(?:figs?|illus|no|nos|vol|pp|p|ch|sec|para|approx|etc|e\.g|i\.e|"
    r"dr|mr|mrs|ms|st|jr|sr|inc|dept|min|max|hr|hrs|wt|vs|cf)\.$", re.I)

TARGET_WORDS = 1500     # split a document longer than this at a page boundary
MIN_WORDS = 200         # merge a document shorter than this into its neighbour
LEAD_CHARS = 600
# A line repeated on this share of a manual's pages is a running head or folio.
FURNITURE_SHARE = 0.30


def reflow(text: str) -> list[str]:
    """Join OCR hard-wraps into paragraphs.

    These pages wrap mid-sentence, often after one or two words in a narrow
    column. Treating each line as a unit shreds the prose -- an early pass that
    did so appeared to lose 7.2% of the corpus to figure removal when the true
    figure was 0.3%; the rest was self-inflicted.
    """
    text = text.replace("\r\n", "\n")
    # "regi-\nmen" -> "regimen"
    text = re.sub(r"(\w)[-\u2010-\u2015]\n\s*(\w)", r"\1\2", text)
    out, buf = [], []
    for line in text.split("\n"):
        s = line.strip()
        if not s:
            if buf:
                out.append(" ".join(buf))
                buf = []
            continue
        buf.append(s)
        # Not every trailing period ends a sentence. "(fig." wraps constantly in
        # these columns, and breaking there splits the reference in half --
        # "(fig." then "1-17)" -- so neither piece is recognisable and the
        # pointer survives into the corpus.
        if re.search(r"[.!?:]\"?\)?$", s) and not ABBREV_END.search(s):
            out.append(" ".join(buf))
            buf = []
    if buf:
        out.append(" ".join(buf))
    return out


def furniture(pages: list[str], n_pages: int) -> set[str]:
    """Lines that appear on enough pages to be a running head, not content."""
    seen: Counter = Counter()
    for text in pages:
        for line in {l.strip() for l in text.split("\n") if l.strip()}:
            if len(line) <= 60:
                seen[line] += 1
    floor = max(3, int(n_pages * FURNITURE_SHARE))
    return {line for line, n in seen.items() if n >= floor}


def clean_page(text: str, drop: set[str]) -> tuple[list[str], list[str], bool]:
    """Return (paragraphs, headings_found, image_dependent) for one page."""
    keep = [l for l in text.split("\n")
            if l.strip() and l.strip() not in drop and not GARBAGE.search(l)]
    heads = [l.strip() for l in keep if HEADING.match(l.strip())]
    paras, dependent = [], False
    for para in reflow("\n".join(keep)):
        cleaned, dep = strip_figure_directives(para)
        dependent = dependent or dep
        cleaned = norm(cleaned)
        if cleaned:
            paras.append(cleaned)
    return paras, heads, dependent


def segment(pages: list[tuple[int, list[str], list[str], bool]],
            manual: str) -> list[dict]:
    """Group pages into documents: heading-anchored, size-bounded.

    A new document starts on a page that opens a heading. Anything that runs
    past TARGET_WORDS is cut at the next page boundary, and anything under
    MIN_WORDS is folded into the previous document.
    """
    docs: list[dict] = []
    cur: dict | None = None

    def start(pno, heading):
        return {"title": heading, "first": pno, "last": pno,
                "paras": [], "words": 0, "dependent": False}

    for pno, paras, heads, dep in pages:
        opens = bool(heads)
        if cur is None or opens or cur["words"] >= TARGET_WORDS:
            if cur is not None:
                docs.append(cur)
            cur = start(pno, heads[0] if heads else "")
        cur["last"] = pno
        cur["paras"].extend(paras)
        cur["words"] += sum(len(p.split()) for p in paras)
        cur["dependent"] = cur["dependent"] or dep
    if cur is not None:
        docs.append(cur)

    merged: list[dict] = []
    for d in docs:
        if merged and d["words"] < MIN_WORDS and not d["title"]:
            prev = merged[-1]
            prev["paras"].extend(d["paras"])
            prev["words"] += d["words"]
            prev["last"] = d["last"]
            prev["dependent"] = prev["dependent"] or d["dependent"]
        else:
            merged.append(d)
    return [d for d in merged if d["words"] >= 25]


def build_docs(stem: str) -> tuple[Doc, list[Doc]]:
    title, ident = CITATIONS.get(stem, (stem, ""))
    src_url = f"{BASE_URL}{stem}.pdf"
    pdf = fitz.open(SRC / f"{stem}.pdf")
    raw_pages = [(pdf[i].get_text() or "") for i in range(pdf.page_count)]
    pdf.close()

    drop = furniture(raw_pages, len(raw_pages))
    pages = []
    for i, text in enumerate(raw_pages):
        paras, heads, dep = clean_page(text, drop)
        if paras or heads:
            pages.append((i + 1, paras, heads, dep))

    manual_path = f"milmed/{stem}"
    out: list[Doc] = []
    for n, seg in enumerate(segment(pages, stem), 1):
        pages_txt = (f"p. {seg['first']}" if seg["first"] == seg["last"]
                     else f"pp. {seg['first']}-{seg['last']}")
        heading = seg["title"].strip()
        doc_title = heading or f"{title}, {pages_txt}"
        cite = f"{title}" + (f" ({ident})" if ident else "") + f", {pages_txt}."
        body = "\n\n".join(seg["paras"])
        sections = [Section(h=heading, t=body),
                    Section(h="Source", t=f"{cite} {src_url}")]
        out.append(Doc(
            path=f"{manual_path}/s{n:04d}", title=doc_title, kind=KIND_ARTICLE,
            lead=body[:LEAD_CHARS], sections=sections, links=[manual_path],
            meta={"manual": title, "id": ident, "pages": [seg["first"], seg["last"]],
                  "source_url": src_url, "citation": cite},
            flags=1 if seg["dependent"] else 0))

    # The manual itself: a container document, so pass 2's inbound-device rule
    # puts the manual's name on every section as a context label.
    toc = "\n".join(f"{d.title}" for d in out)
    manual_doc = Doc(
        path=manual_path, title=title + (f" ({ident})" if ident else ""),
        kind=KIND_DEVICE,
        lead=f"{title}. {ident}. {len(out)} sections, "
             f"{sum(len(d.text.split()) for d in out):,} words.",
        sections=[Section(h="Contents", t=toc),
                  Section(h="Source", t=f"{title}"
                          + (f" ({ident})" if ident else "") + f". {src_url}")],
        links=[d.path for d in out],
        meta={"manual": title, "id": ident, "source_url": src_url,
              "sections": len(out)})
    return manual_doc, out


def main() -> int:
    ap = argparse.ArgumentParser(prog="milmed_build")
    ap.add_argument("--out", default=str(data_dir()))
    ap.add_argument("--name", default="military-medicine")
    ap.add_argument("--compress-level", type=int, default=ZLIB_LEVEL)
    args = ap.parse_args()

    out_dir = Path(args.out)
    core_path = out_dir / f"{args.name}.codex.db"
    deep_path = out_dir / f"{args.name}.codex-deep.db"
    edges_path = out_dir / f"{args.name}.edges.bin"
    for p in (core_path, deep_path):
        p.unlink(missing_ok=True)

    stems = sorted(p.stem for p in SRC.glob("*.pdf"))
    log(f"milmed: {len(stems)} manuals from {SRC}")

    all_docs: list[Doc] = []
    for stem in stems:
        manual_doc, sections = build_docs(stem)
        all_docs.append(manual_doc)
        all_docs.extend(sections)
        log(f"  {stem:16s} {len(sections):4d} sections  "
            f"{sum(len(d.text.split()) for d in sections):8,d} words")

    # Bodies as JSON bytes; compressed per row below (zlib, no dictionary).
    bodies = [json.dumps([s.as_json() for s in d.sections],
                         ensure_ascii=False, separators=(",", ":")).encode()
              for d in all_docs]

    con = sqlite3.connect(str(core_path), isolation_level=None)
    apply_pragmas(con, BUILD_PRAGMAS)
    init_core(con)

    log(f"pass 1: writing {len(all_docs):,} documents")
    rows, edge_buf = [], bytearray()
    for doc_id, (doc, body_json) in enumerate(zip(all_docs, bodies), 1):
        rows.append((doc_id, doc.path, doc.title, doc.kind, doc.word_count,
                     doc.lead, zlib.compress(body_json, args.compress_level),
                     json.dumps(doc.meta, ensure_ascii=False,
                                separators=(",", ":")), doc.flags))
        for link in doc.links:
            edge_buf += EDGE_STRUCT.pack(doc_id, path_hash(link))
    edges_path.write_bytes(bytes(edge_buf))
    con.execute("BEGIN")
    con.executemany(
        "INSERT INTO doc(id, path, title, kind, word_count, lead, body, meta, "
        "flags) VALUES(?,?,?,?,?,?,?,?,?)", rows)
    con.execute("COMMIT")

    set_meta(con, schema_version=SCHEMA_VERSION,
             source_zim="irp.fas.org_en_military-medicine_2026-05.zim",
             source_bytes=sum((SRC / f"{s}.pdf").stat().st_size for s in stems),
             adapter="milmed", title="Military Medicine", language="eng",
             zim_date="2026-05", body_codec="zlib",
             compress_level=args.compress_level,
             built_by="milmed_build", docs=len(all_docs))

    log("building core indexes")
    init_core_indexes(con)

    max_id = con.execute("SELECT MAX(id) FROM doc").fetchone()[0]
    stats = G.resolve_and_rank(con, edges_path, max_id)
    set_meta(con, graph_done="1", **{f"graph_{k}": v for k, v in stats.items()})

    init_fts_quick(con)
    I.build_quick(con)

    deep = sqlite3.connect(str(deep_path), isolation_level=None)
    apply_pragmas(deep, BUILD_PRAGMAS)
    init_deep(deep)
    I.build_deep(con, deep)
    set_meta(deep, table="deep_meta", schema_version=SCHEMA_VERSION,
             core=core_path.name, docs=len(all_docs))
    deep.execute("PRAGMA journal_mode=WAL")
    deep.close()

    set_meta(con, built_at=time.strftime("%Y-%m-%dT%H:%M:%S"))
    log("vacuuming core")
    con.execute("PRAGMA journal_mode=WAL")
    os.environ.setdefault("SQLITE_TMPDIR", str(out_dir))
    con.execute("PRAGMA temp_store=FILE")
    con.execute("VACUUM")
    con.close()
    edges_path.unlink(missing_ok=True)

    log("")
    log(f"DONE  {len(all_docs):,} documents")
    log(f"  core  {core_path.stat().st_size/1e6:,.1f} MB")
    log(f"  deep  {deep_path.stat().st_size/1e6:,.1f} MB")
    return 0


if __name__ == "__main__":
    sys.exit(main())
