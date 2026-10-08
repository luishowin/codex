#!/usr/bin/env python3
"""Turn the irp.fas.org military-medicine PDFs into text and searchable PDFs.

Two thirds of these pages already carry a real text layer and must not be
OCR'd -- re-recognising a page that already has perfect text throws accuracy
away and costs an hour. Measured per page rather than per file, because four of
the manuals are hybrids: a text body with scanned plates dropped into it.

    TEXT-OK   13 files, 2,949 pages   extract directly
    OCR-SOME   4 files,   621 pages   OCR only the pages that are short of text
    OCR-ALL    7 files,   870 pages   OCR everything

`sfhandbook-pt2.pdf` and `-pt3.pdf` are skipped: page-image hashing puts 264 of
their 265 pages inside `sfhandbook.pdf`, so OCR'ing them is 261 pages of
duplicate work. `sfhandbook-pt1.pdf` is not a PDF at all -- the ZIM stores an
HTML error page under that name.

Pages are rendered at 300 DPI, which for these scans is native: the embedded
CCITT G4 images are 1554x2518, and a 300 DPI render comes out 1554x2517. Going
higher would interpolate without adding information; going to 200 loses running
heads (measured: identical body text, dropped the "2-38" folio).
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

import fitz

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from codex.paths import MILMED_DIR

RAW = MILMED_DIR / "raw"
TEXT = MILMED_DIR / "text"
OCR = MILMED_DIR / "ocr"
FIGS = MILMED_DIR / "figures"

# Windows default kept for the machine this tool was written on; override with
# TESSERACT_CMD on any other setup.
TESSERACT = Path(os.environ.get(
    "TESSERACT_CMD", r"C:\Program Files\Tesseract-OCR\tesseract.exe"))
DPI = 300
# Figures are line art; 200 DPI over the placed rectangle is plenty and keeps
# the folder browsable.
FIGURE_DPI = 200
# Below this many characters a page is not carrying its own text.
TEXT_MIN = 200
# An image covering most of the page is the page scan itself, not a figure.
FIGURE_MAX_COVERAGE = 0.80

# Wholly contained in sfhandbook.pdf (264/265 pages by image hash).
SKIP = {"sfhandbook-pt2.pdf": "duplicate of sfhandbook.pdf",
        "sfhandbook-pt3.pdf": "duplicate of sfhandbook.pdf"}


def log(msg: str) -> None:
    print(msg, flush=True)


def ocr_images(paths: list[Path], out_stem: Path) -> bool:
    """Run tesseract over an image list, producing one searchable PDF.

    Tesseract takes a file of image paths and emits a multi-page PDF with the
    image kept and an invisible text layer over it, which is exactly the
    "clean text PDF" shape wanted here -- and it means no Ghostscript, which
    needs admin rights this session does not have.
    """
    with tempfile.NamedTemporaryFile("w", suffix=".txt", delete=False,
                                     encoding="utf-8") as fh:
        fh.write("\n".join(str(p) for p in paths))
        listing = fh.name
    try:
        r = subprocess.run(
            [str(TESSERACT), listing, str(out_stem), "pdf", "txt"],
            capture_output=True, text=True)
        if r.returncode != 0:
            log(f"      !! tesseract exit {r.returncode}: {r.stderr.strip()[:200]}")
            return False
        return True
    finally:
        Path(listing).unlink(missing_ok=True)


def extract_figures(doc: fitz.Document, name: str) -> int:
    """Save embedded figures that are not the page scan itself.

    Rendered from the page rather than pulled out with `extract_image`. Most
    illustrations in these manuals are **stencil masks** (`/ImageMask true`):
    a 1-bit bitmap that selects where to paint the fill colour, meaningless on
    its own. Extracting the raw stream gives a white-on-black, vertically
    flipped negative -- verified on a NAVMED form that came out unreadable.
    Rendering the clip region applies the decode array and the page matrix, so
    the figure comes out as it actually appears.
    """
    out = FIGS / Path(name).stem
    n = 0
    for pno in range(doc.page_count):
        page = doc[pno]
        parea = abs(page.rect.width * page.rect.height) or 1
        seen: set[int] = set()
        for info in page.get_images(full=True):
            xref = info[0]
            if xref in seen:
                continue
            seen.add(xref)
            try:
                rects = page.get_image_rects(xref)
            except Exception:
                continue
            for ri, rect in enumerate(rects):
                if rect.is_empty or rect.is_infinite:
                    continue
                # Clip to the page: an image placed partly off-page gives a
                # rect that renders to zero pixels in one axis, and MuPDF
                # raises "invalid bandwriter header dimensions" on save.
                rect = rect & page.rect
                if rect.is_empty:
                    continue
                area = abs(rect.width * rect.height)
                if not area or area / parea > FIGURE_MAX_COVERAGE:
                    continue
                if rect.width < 48 or rect.height < 48:
                    continue  # rules, bullets, logos
                try:
                    pix = page.get_pixmap(clip=rect, dpi=FIGURE_DPI)
                    if not pix.width or not pix.height:
                        continue
                    out.mkdir(parents=True, exist_ok=True)
                    pix.save(out / f"p{pno + 1:04d}_{xref}_{ri}.png")
                except Exception as exc:
                    log(f"      .. {name} p{pno + 1} xref {xref}: {exc}")
                    continue
                n += 1
    return n


def process(path: Path) -> dict:
    name = path.name
    doc = fitz.open(path)
    n = doc.page_count
    texts = [(doc[i].get_text() or "").strip() for i in range(n)]
    lean = [i for i, t in enumerate(texts) if len(t) < TEXT_MIN]
    mode = "TEXT-OK" if not lean else ("OCR-ALL" if len(lean) == n else "OCR-SOME")
    log(f"  {name:24s} {n:5d} pages  {len(lean):5d} need OCR  [{mode}]")

    rec = {"file": name, "pages": n, "ocr_pages": len(lean), "mode": mode}

    if not lean:
        # Already searchable. Copy it through unchanged rather than round-trip
        # it through a renderer that can only lose fidelity.
        (TEXT / f"{path.stem}.txt").write_text("\n\n".join(texts), encoding="utf-8")
        (OCR / name).write_bytes(path.read_bytes())
    else:
        with tempfile.TemporaryDirectory(prefix="milmed_") as td:
            tmp = Path(td)
            imgs = []
            for i in lean:
                pix = doc[i].get_pixmap(dpi=DPI)
                p = tmp / f"page_{i + 1:04d}.png"
                pix.save(p)
                imgs.append(p)
            stem = tmp / "ocr_out"
            if not ocr_images(imgs, stem):
                rec["error"] = "tesseract failed"
                doc.close()
                return rec

            lean_set = set(lean)
            ocr_pdf = fitz.open(str(stem) + ".pdf")
            out = fitz.open()
            k = 0
            for i in range(n):
                if i in lean_set:
                    # The OCR page keeps the same image and adds an invisible
                    # text layer, so swapping it in loses nothing.
                    out.insert_pdf(ocr_pdf, from_page=k, to_page=k)
                    k += 1
                else:
                    out.insert_pdf(doc, from_page=i, to_page=i)
            out.save(OCR / name, garbage=3, deflate=True)
            out.close()
            ocr_pdf.close()

            ocr_txt = Path(str(stem) + ".txt").read_text(encoding="utf-8",
                                                         errors="replace")
            # Tesseract separates pages with a form feed.
            pages_ocr = ocr_txt.split("\f")
            merged, j = [], 0
            for i in range(n):
                if i in lean_set:
                    merged.append(pages_ocr[j] if j < len(pages_ocr) else "")
                    j += 1
                else:
                    merged.append(texts[i])
            (TEXT / f"{path.stem}.txt").write_text("\n\n".join(merged),
                                                   encoding="utf-8")

    rec["figures"] = extract_figures(doc, name)
    rec["words"] = len((TEXT / f"{path.stem}.txt").read_text(
        encoding="utf-8", errors="replace").split())
    doc.close()
    log(f"      -> {rec['words']:,} words, {rec['figures']} figures")
    return rec


def main() -> int:
    for d in (TEXT, OCR, FIGS):
        d.mkdir(parents=True, exist_ok=True)

    # Re-extract figures without redoing OCR.
    if "--figures-only" in sys.argv:
        total = 0
        for path in sorted(RAW.glob("*.pdf")):
            if path.name in SKIP:
                continue
            doc = fitz.open(path)
            n = extract_figures(doc, path.name)
            doc.close()
            total += n
            log(f"  {path.name:24s} {n:5d} figures")
        log(f"\ntotal figures: {total:,}")
        return 0

    if not TESSERACT.exists():
        log(f"tesseract not found at {TESSERACT}")
        return 1

    results, skipped = [], []
    for path in sorted(RAW.glob("*.pdf")):
        if path.name in SKIP:
            skipped.append({"file": path.name, "reason": SKIP[path.name]})
            log(f"  {path.name:24s} SKIPPED - {SKIP[path.name]}")
            continue
        try:
            results.append(process(path))
        except Exception as exc:
            log(f"  !! {path.name}: {type(exc).__name__}: {exc}")
            results.append({"file": path.name, "error": str(exc)})

    (MILMED_DIR / "report.json").write_text(
        json.dumps({"processed": results, "skipped": skipped}, indent=2))
    ok = [r for r in results if "error" not in r]
    log(f"\n{len(ok)}/{len(results)} processed, {len(skipped)} skipped")
    log(f"total words: {sum(r.get('words', 0) for r in ok):,}")
    log(f"total figures: {sum(r.get('figures', 0) for r in ok):,}")
    log(f"pages OCR'd: {sum(r.get('ocr_pages', 0) for r in ok):,}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
