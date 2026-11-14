#!/usr/bin/env python3
"""Generate the UI's library fixture from the real databases.

The web canvas needs cassette manifests before the cassette tooling exists.
Rather than invent numbers, this reads every ``*.codex.db`` in the data
directory (read-only), plus ``art.db`` for cover art, and writes
``app/web/mock/library.json`` in the shape frozen in SPEC.md section 3.

    python3 app/tools/mock_library.py            # write the fixture
    python3 app/tools/mock_library.py --check    # exit 1 if it is stale

A ``sha256`` is computed only for film files up to ``--max-hash`` bytes;
larger ones are left null with a note, because the real digest belongs to
the pack step, not to a UI fixture. The field is never fabricated.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sqlite3
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from codex import paths  # noqa: E402

OUT = paths.APP_DIR / "web" / "mock" / "library.json"
DEFAULT_HASH_CAP = 2 * 1000 * 1000 * 1000  # 2 GB

# Licence as published by each source. `verify` is not decoration: the
# cassette tool must re-confirm before a cassette leaves the machine.
LICENCES = {
    "wikipedia": ("CC BY-SA 4.0", "https://creativecommons.org/licenses/by-sa/4.0/"),
    "wikipedia-100": ("CC BY-SA 4.0", "https://creativecommons.org/licenses/by-sa/4.0/"),
    "wikipedia-climate": ("CC BY-SA 4.0", "https://creativecommons.org/licenses/by-sa/4.0/"),
    "wikipedia-medicine": ("CC BY-SA 4.0", "https://creativecommons.org/licenses/by-sa/4.0/"),
    "wikiversity": ("CC BY-SA 4.0", "https://creativecommons.org/licenses/by-sa/4.0/"),
    "wikivoyage-europe": ("CC BY-SA 4.0", "https://creativecommons.org/licenses/by-sa/4.0/"),
    "ifixit": ("CC BY-NC-SA 3.0", "https://creativecommons.org/licenses/by-nc-sa/3.0/"),
    "libretexts-med": ("Varies by book (CC BY-NC-SA typical)",
                       "https://libretexts.org/platform-home/licensing-information"),
    "mdn": ("CC BY-SA 2.5", "https://creativecommons.org/licenses/by-sa/2.5/"),
    "medlineplus": ("Public domain (US Government)", "https://medlineplus.gov/about/using/"),
    "ready-gov": ("Public domain (US Government)", "https://www.ready.gov/"),
    "nhs-medicines": ("Open Government Licence v3.0",
                      "https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/"),
    "military-medicine": ("Check per document", "https://irp.fas.org/"),
}

PALETTES = ("ink", "ember", "moss", "slate", "wine", "sand")


def _summary(db: Path) -> tuple[dict[str, str], int, int]:
    """(codex_meta, doc count, word sum). Words are not in codex_meta; the
    daemon sums doc.word_count and so does this fixture."""
    con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
    try:
        meta = dict(con.execute("SELECT key, value FROM codex_meta"))
        docs = con.execute("SELECT COUNT(*) FROM doc").fetchone()[0]
        words = con.execute("SELECT SUM(word_count) FROM doc").fetchone()[0] or 0
        return meta, int(docs), int(words)
    finally:
        con.close()


def _sha256(path: Path, cap: int) -> str | None:
    if cap and path.stat().st_size > cap:
        return None
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def _art(art_db: Path) -> tuple[dict[str, dict], str | None]:
    """(codex -> first bound image) and a global fallback slug."""
    if not art_db.is_file():
        return {}, None
    con = sqlite3.connect(f"file:{art_db}?mode=ro", uri=True)
    try:
        rows = con.execute(
            "SELECT b.codex, a.slug, a.subject, a.discipline "
            "FROM binding b JOIN art a ON a.id = b.art_id "
            "ORDER BY b.codex, a.id").fetchall()
        fallback = con.execute(
            "SELECT slug FROM art WHERE discipline != '' ORDER BY id LIMIT 1").fetchone()
    finally:
        con.close()
    first: dict[str, dict] = {}
    for codex, slug, subject, discipline in rows:
        first.setdefault(codex, {"slug": slug, "subject": subject,
                                 "discipline": discipline})
    return first, (fallback[0] if fallback else None)


def build(data_dir: Path, art_db: Path, creator: str, cap: int) -> dict:
    art_by_codex, _fallback = _art(art_db)
    cassettes = []
    for db in sorted(data_dir.glob("*.codex.db")):
        if db.name.endswith("-deep.db"):
            continue
        name = db.name[:-len(".codex.db")]
        meta, docs, words = _summary(db)
        deep = db.with_name(db.name.replace(".codex.db", ".codex-deep.db"))
        art = art_by_codex.get(meta.get("adapter", "")) or art_by_codex.get(name)
        licence, licence_url = LICENCES.get(
            name, LICENCES.get(meta.get("adapter", ""), ("Check at pack time", "")))

        film = [{
            "role": "core",
            "file": f"film/{db.name}",
            "bytes": db.stat().st_size,
            "sha256": _sha256(db, cap),
        }]
        if deep.is_file():
            film.append({
                "role": "deep",
                "file": f"film/{deep.name}",
                "bytes": deep.stat().st_size,
                "sha256": _sha256(deep, cap),
            })

        cassettes.append({
            "schema": 1,
            "cassette_id": "mock-" + hashlib.sha1(name.encode()).hexdigest()[:12],
            "name": name,
            "title": meta.get("title") or name,
            "issue": (meta.get("zim_date") or meta.get("built_at") or "")[:7].replace("-", "."),
            "created_at": meta.get("built_at", ""),
            "created_by": creator,
            "contents": {
                "documents": docs,
                "words": words,
                "language": meta.get("language", ""),
                "adapter": meta.get("adapter", ""),
                "source": meta.get("source_zim", ""),
                "source_date": meta.get("zim_date", ""),
                "schema": int(meta.get("schema_version") or 1),
            },
            "film": film,
            "cover": {
                "hero_slug": (art or {}).get("slug"),
                "subject": (art or {}).get("subject") or "",
                "palette": PALETTES[int(hashlib.sha1(name.encode()).hexdigest(), 16) % len(PALETTES)],
            },
            "licence": {"name": licence, "url": licence_url,
                        "note": "Verify before redistribution"},
            "manifest_sha256": None,
            "_mock": True,
        })

    cassettes.sort(key=lambda c: -c["contents"]["documents"])
    return {
        "schema": 1,
        "generated_at": "",
        "generated_by": "app/tools/mock_library.py",
        "note": "Fixture for the UI. Not a cassette. No manifest digest is claimed.",
        "cassettes": cassettes,
    }


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--data", type=Path, default=paths.data_dir())
    ap.add_argument("--art", type=Path, default=paths.art_db_path())
    ap.add_argument("--out", type=Path, default=OUT)
    ap.add_argument("--creator", default="Luis Maina")
    ap.add_argument("--max-hash", type=int, default=DEFAULT_HASH_CAP,
                    help="skip sha256 above this many bytes (0 = hash everything)")
    ap.add_argument("--check", action="store_true",
                    help="exit 1 when the existing fixture differs")
    a = ap.parse_args()

    doc = build(a.data, a.art, a.creator, a.max_hash)
    text = json.dumps(doc, indent=1, ensure_ascii=False) + "\n"

    if a.check:
        old = a.out.read_text() if a.out.is_file() else ""
        if old != text:
            print(f"{a.out} is stale; rerun without --check", file=sys.stderr)
            return 1
        print(f"{a.out} is current ({len(doc['cassettes'])} cassettes)")
        return 0

    a.out.parent.mkdir(parents=True, exist_ok=True)
    a.out.write_text(text)
    hashed = sum(1 for c in doc["cassettes"]
                 for f in c["film"] if f["sha256"])
    total = sum(1 for c in doc["cassettes"] for f in c["film"])
    print(f"wrote {a.out}: {len(doc['cassettes'])} cassettes, "
          f"{hashed}/{total} film files hashed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
