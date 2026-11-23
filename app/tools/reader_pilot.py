"""Measure the candidate article format on a repeatable random sample of a ZIM."""
import argparse
import json
import random
import sqlite3
from collections import Counter
from pathlib import Path

from reader_specimen import Archive, LexborHTMLParser, article, book, plain
from rebuild_deep import main as build_deep
from codex.adapters import WikipediaAdapter


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("zim", type=Path)
    parser.add_argument("current", type=Path, help="Existing Wikipedia core for paired measurements")
    parser.add_argument("out", type=Path, help="New directory outside the family shelf")
    parser.add_argument("--sample", type=int, default=1536)
    args = parser.parse_args()
    archive = Archive(args.zim)
    seed = 202606
    ids = random.Random(seed).sample(range(archive.entry_count), args.sample)
    args.out.mkdir(parents=True, exist_ok=False)
    adapter = WikipediaAdapter()
    counts = Counter()
    rows = []
    exceptions = []
    old_body_bytes = new_body_bytes = matched = 0
    with sqlite3.connect(args.current.resolve().as_uri() + "?mode=ro", uri=True) as old:
        for slot in sorted(ids):
            path = None
            try:
                entry = archive._get_entry_by_id(slot)
                path = entry.path
                if entry.is_redirect:
                    counts["redirect"] += 1
                    continue
                if adapter.skip_path(path):
                    counts["non_article_namespace"] += 1
                    continue
                item = entry.get_item()
                if not item.mimetype.startswith("text/html"):
                    counts["other_media"] += 1
                    continue
                raw = bytes(item.content)
                dom = LexborHTMLParser(raw)
                if dom.css_first('meta[http-equiv="refresh" i]'):
                    counts["html_redirect"] += 1
                    continue
                title = dom.css_first("h1")
                if title is None or dom.css_first(".mw-parser-output") is None:
                    counts["no_article_container"] += 1
                    exceptions.append([slot,path,"no article container"])
                    continue
                blocks = article(raw, ".mw-parser-output")
                if not any(plain(b).strip() for b in blocks):
                    counts["empty"] += 1
                    exceptions.append([slot,path,"no surviving blocks"])
                    continue
                intro = next((plain(b).strip() for b in blocks if b["tag"] == "p"), "")
                label = title.text().strip()
                credit = {"source": "English Wikipedia contributors", "source_id": path,
                          "url": "https://en.wikipedia.org/wiki/" + path, "licence": "CC BY-SA 4.0"}
                rows.append((path,label,intro,blocks,credit))
                counts["included"] += 1
            except Exception as exc:
                counts["failed"] += 1
                exceptions.append([slot,path,str(exc)])
        book(args.out,"pilot","Wikipedia pilot",args.zim.name,"June 2026 · Pilot",rows)
        core = args.out / "pilot.codex.db"
        with sqlite3.connect(core) as cand:
            for path, size in cand.execute("select path,length(body) from doc"):
                match = old.execute("select length(body) from doc where path=?", (path,)).fetchone()
                if match and match[0]:
                    matched += 1
                    old_body_bytes += match[0]
                    new_body_bytes += size
        build_deep(str(core))
    deep = args.out / "pilot.codex-deep.db"
    report = {"source": args.zim.name, "archive_entries": archive.entry_count,
              "archive_article_count": archive.article_count, "seed": seed, "sampled_slots": len(ids),
              "outcomes": dict(counts), "exceptions": exceptions, "core_bytes": core.stat().st_size,
              "deep_bytes": deep.stat().st_size, "paired_documents": matched,
              "paired_existing_body_bytes": old_body_bytes, "paired_candidate_body_bytes": new_body_bytes}
    assert sum(counts.values()) == len(ids)
    (args.out / "measurement.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf8")
    print(json.dumps({k:v for k,v in report.items() if k != "exceptions"},indent=2))


if __name__ == "__main__":
    main()
