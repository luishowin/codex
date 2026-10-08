#!/usr/bin/env python
"""Phase 1: resolve the curated subject list to a reviewable manifest.

Fetches no image bytes. It resolves each subject to a Commons file, records the
licence and credit, and works out which documents in which codexes the image
should bind to -- then writes the lot to JSON for you to read before anything is
downloaded. Quality is the point of the exercise, and a manifest is the only
place a human can cheaply veto a bad picture.

    .venv/Scripts/python.exe tools/art_manifest.py
    .venv/Scripts/python.exe tools/art_manifest.py --only anatomy,tools

Then read <root>/_work/art_manifest.json, set `"status": "dropped"` on anything
unwanted, and run tools/art_build.py.
"""
from __future__ import annotations

import argparse
import glob
import json
import os
import sqlite3
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

import art_commons as ac
from art_subjects import SUBJECTS, check, display_name, slug_for

from codex.paths import data_dir, work_dir

TARGET_WIDTH = 1600
MIN_MP = 1.2            # below this the picture is not worth a hero slot
CODEX_GLOB = str(data_dir() / "*.codex.db")
OUT = str(work_dir() / "art_manifest.json")

# Reading every (id, title) pair is fine on a small codex and ruinous on
# wikipedia: doc.title carries no index, so a title match there is a full scan
# of a 21 GB file. Measured on this box, ORDER BY on an unindexed doc column
# took 78 s. Path and redirect lookups are indexed and used on every codex.
TITLE_SCAN_MAX_DOCS = 200_000


def path_variants(title: str) -> set[str]:
    """Wiki codexes store the underscored article title verbatim as doc.path."""
    d = display_name(title)
    out = {title, d, title.replace(" ", "_"), d.replace(" ", "_")}
    return {v for v in out if v}


def bind_codex(core: str, wanted: dict[str, str]) -> dict[str, tuple[int, str, float]]:
    """slug -> (doc_id, title, importance) for one codex.

    `wanted` maps every candidate path/title spelling to the slug that claims it.
    One or two queries for the whole subject list, not one per subject.
    """
    name = Path(core).name.replace(".codex.db", "")
    con = sqlite3.connect(f"file:{core}?mode=ro", uri=True)
    con.row_factory = sqlite3.Row
    found: dict[str, tuple[int, str, float]] = {}

    def offer(slug: str, row) -> None:
        prev = found.get(slug)
        if prev is None or row["importance"] > prev[2]:
            found[slug] = (row["id"], row["title"], row["importance"])

    keys = list(wanted)
    marks = ",".join("?" * len(keys))
    try:
        for row in con.execute(
                f"SELECT id, path, title, importance FROM doc WHERE path IN ({marks})",
                keys):
            offer(wanted[row["path"]], row)
        # A redirect is a real hit: `Malaria` may exist only as a pointer.
        for row in con.execute(
                "SELECT r.from_path AS fp, d.id, d.title, d.importance "
                f"FROM redirect r JOIN doc d ON d.id = r.to_id "
                f"WHERE r.from_path IN ({marks})", keys):
            offer(wanted[row["fp"]], row)

        n_docs = con.execute("SELECT COUNT(*) FROM doc").fetchone()[0]
        if n_docs <= TITLE_SCAN_MAX_DOCS:
            lower = {k.lower(): v for k, v in wanted.items()}
            for row in con.execute(
                    "SELECT id, title, importance FROM doc WHERE lower(title) IN "
                    f"({','.join('?' * len(lower))})", list(lower)):
                offer(lower[row["title"].lower()], row)
    except sqlite3.DatabaseError as exc:
        print(f"  !! {name}: {exc}", file=sys.stderr)
    finally:
        con.close()
    return found


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", help="comma-separated disciplines")
    ap.add_argument("--width", type=int, default=TARGET_WIDTH)
    ap.add_argument("--min-mp", type=float, default=MIN_MP)
    ap.add_argument("--out", default=OUT)
    args = ap.parse_args()

    problems = check()
    if problems:
        for p in problems:
            print(f"  !! {p}", file=sys.stderr)
        return 2

    subjects = SUBJECTS
    if args.only:
        keep = {s.strip() for s in args.only.split(",")}
        subjects = [s for s in SUBJECTS if s[0] in keep]
    if not subjects:
        print("no subjects selected", file=sys.stderr)
        return 2

    if not ac._CONTACT:
        print("  running anonymously (no CODEX_CONTACT); expect a slower rate\n")

    titles = [t for _, t, _ in subjects]
    print(f"resolving {len(titles)} subjects ...")
    t0 = time.time()
    leads = ac.lead_images(titles)
    files = sorted({v["file"] for v in leads.values() if v.get("file")})
    print(f"  {len(files)} distinct lead images -> fetching metadata")
    info = ac.image_info(files, args.width)

    def megapixels(ii: dict) -> float:
        return (ii["thumb_width"] or 0) * (ii["thumb_height"] or 0) / 1e6

    def usable(fname: str) -> bool:
        ii = info.get(fname, {})
        if not ii or ii.get("error"):
            return False
        if ii.get("mime") not in ac.IMAGE_MIMES:
            return False
        if not ac.licence_ok(ii)[0]:
            return False
        # SVG is exempt from the floor. It is vector: the thumbnailer rasterises
        # it crisply at whatever width we ask for, so the pixel count of a given
        # render says nothing about quality the way it does for a photograph.
        if ii["mime"] == "image/svg+xml":
            return True
        return megapixels(ii) >= args.min_mp

    # Fall back to the article's other images wherever the lead is unusable.
    # Measured: 29 of 100 leads came back under 1.2 MP and 4 more had no lead or
    # a licence we will not carry, so without this the run yields 67 pictures.
    needy = [t for t in titles
             if leads.get(t, {}).get("error") or not usable(leads[t]["file"])]
    substitutions: dict[str, str] = {}
    candidates: dict[str, list[str]] = {}
    if needy:
        print(f"  {len(needy)} unusable leads -> searching article bodies")
        by_subject = {t: leads.get(t, {}).get("article", t) for t in needy}
        alts = ac.article_images(list(by_subject.values()))
        extra = sorted({f for names in alts.values() for f in names} - set(info))
        print(f"  {len(extra)} candidate images -> fetching metadata")
        info.update(ac.image_info(extra, args.width))
        aliases_by_title = {t: a for _, t, a in subjects}
        for t in needy:
            phrases = [display_name(t), *aliases_by_title.get(t, ())]
            viable = [c for c in alts.get(by_subject[t], []) if usable(c)]
            candidates[t] = viable
            if not viable:
                continue
            # Best name overlap wins, a photograph beats a chart, page order
            # breaks the rest. Ordering only -- a zero-overlap pick is still
            # taken, and flagged for review.
            best = max(range(len(viable)), key=lambda i: (
                ac.name_overlap(viable[i], phrases),
                not ac.looks_like_a_chart(viable[i]), -i))
            substitutions[t] = viable[best]
    print(f"  metadata in {time.time() - t0:.1f}s, "
          f"{len(substitutions)}/{len(needy)} substituted")

    # One candidate->slug map covering every subject, reused for all codexes.
    wanted: dict[str, str] = {}
    for _, title, aliases in subjects:
        slug = slug_for(title)
        for cand in (title, *aliases):
            for v in path_variants(cand):
                wanted.setdefault(v, slug)

    cores = sorted(p for p in glob.glob(CODEX_GLOB) if p.endswith(".codex.db"))
    print(f"binding across {len(cores)} codexes ...")
    per_codex: dict[str, dict] = {}
    for core in cores:
        name = Path(core).name.replace(".codex.db", "")
        t1 = time.time()
        per_codex[name] = bind_codex(core, wanted)
        print(f"  {name:<20} {len(per_codex[name]):>3} bound  {time.time()-t1:.1f}s")

    entries = []
    counts = {"ok": 0, "review": 0, "flagged": 0, "dropped": 0}
    for discipline, title, aliases in subjects:
        slug = slug_for(title)
        e: dict = {"slug": slug, "subject": display_name(title),
                   "discipline": discipline, "wikipedia_title": title,
                   "aliases": list(aliases), "notes": []}
        lead = leads.get(title, {})
        chosen = substitutions.get(title) or lead.get("file")
        if not chosen:
            e["status"] = "dropped"
            e["notes"].append(lead.get("error", "no image found"))
        else:
            ii = info.get(chosen, {})
            e["article"] = lead.get("article", title)
            e["file"] = chosen
            if title in substitutions:
                e["notes"].append(
                    "lead image unusable; substituted from article body"
                    + (f" (lead was {lead['file']})" if lead.get("file") else ""))
            if ii.get("error"):
                e["status"] = "dropped"
                e["notes"].append(ii["error"])
            else:
                ok, why = ac.licence_ok(ii)
                mp = megapixels(ii)
                is_svg = ii.get("mime") == "image/svg+xml"
                e.update({k: ii[k] for k in (
                    "thumb_url", "thumb_width", "thumb_height", "mime",
                    "orig_width", "orig_height", "orig_bytes", "artist",
                    "credit", "description", "licence", "licence_code",
                    "licence_url", "source_url", "restrictions")})
                e["megapixels"] = round(mp, 3)
                if not ok:
                    e["status"] = "dropped"
                    e["notes"].append(why)
                elif ii.get("mime") not in ac.IMAGE_MIMES:
                    e["status"] = "dropped"
                    e["notes"].append(f"not a still image ({ii.get('mime')})")
                else:
                    e["status"] = "ok"
                    if mp < args.min_mp and not is_svg:
                        e["status"] = "flagged"
                        e["notes"].append(
                            f"only {mp:.2f} MP - MediaWiki does not upscale, so "
                            f"the original is smaller than {args.width}px")
                    if is_svg:
                        e["notes"].append(
                            "SVG rasterised at target width; exempt from the "
                            "megapixel floor because it is vector")
                    if ii.get("restrictions"):
                        e["notes"].append(f"restrictions: {ii['restrictions']}")
                    if not ii.get("artist"):
                        e["notes"].append("no artist recorded upstream")
                    if title in substitutions:
                        # Never silently accept a machine-chosen picture. The
                        # first version of this fallback picked an African
                        # elephant skull for `human-skull` and a MediaWiki UI
                        # icon for `vibrio-cholerae`, both of which passed every
                        # mechanical check that existed at the time.
                        overlap = ac.name_overlap(
                            chosen, [e["subject"], *e["aliases"]])
                        e["status"] = "review"
                        e["notes"].append(
                            f"substituted image, name overlap {overlap}"
                            + (" - NO shared words with the subject"
                               if not overlap else ""))
                        e["alternatives"] = [
                            c for c in candidates.get(title, []) if c != chosen][:6]

        e["bindings"] = [
            {"codex": name, "doc_id": hit[0], "title": hit[1],
             "importance": round(hit[2], 4)}
            for name, hits in per_codex.items() if (hit := hits.get(slug))
        ]
        if e["status"] != "dropped" and not e["bindings"]:
            e["notes"].append("binds to no document in any codex")
        counts[e["status"]] += 1
        entries.append(e)

    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    manifest = {
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "target_width": args.width, "min_megapixels": args.min_mp,
        "counts": counts, "subjects": entries,
    }
    Path(args.out).write_text(json.dumps(manifest, indent=1, ensure_ascii=False),
                              encoding="utf-8")

    total_bind = sum(len(e["bindings"]) for e in entries)
    unbound = [e["slug"] for e in entries
               if e["status"] != "dropped" and not e["bindings"]]
    print(f"\n{counts['ok']} ok, {counts['review']} need review, "
          f"{counts['flagged']} flagged, {counts['dropped']} dropped   "
          f"{total_bind} bindings")
    for e in entries:
        if e["status"] == "review":
            print(f"  review   {e['slug']:<28} {e['file'].replace('File:','')[:52]}")
        elif e["status"] != "ok":
            print(f"  {e['status']:<8} {e['slug']:<28} {'; '.join(e['notes'])[:70]}")
    if unbound:
        print(f"  unbound: {', '.join(unbound)}")
    print(f"\nwrote {args.out}")
    print("review it, set \"status\": \"dropped\" on anything unwanted, "
          "then run tools/art_build.py")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
