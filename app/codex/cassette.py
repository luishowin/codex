"""Cassette manifests (SPEC.md section 3) built from film on disk.

One implementation, two callers: ``codexd`` serves it on ``/api/library`` and
``app/tools/mock_library.py`` writes the offline fixture. If the shelf and the
fixture ever disagreed, one of them would be lying.

What is built here is a **shelf manifest**, not a sealed cassette: it describes
film that exists, and says so. ``sealed`` is false, every ``sha256`` is null
(a 34 GB digest belongs to the pack step, not to a web request) and
``cassette_id`` is prefixed ``shelf-`` so it cannot be mistaken for the ULID of
a physical cassette. Nothing is invented: a null digest means "not computed".

The fields are exactly the ones in SPEC.md section 3 because the canvas reads
them; ``sealed`` is the one additive key, and readers ignore unknown keys.
"""
from __future__ import annotations

import hashlib
import sqlite3
from pathlib import Path

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

DEFAULT_CREATOR = "Luis Maina"
CORE_SUFFIX = ".codex.db"
DEEP_SUFFIX = ".codex-deep.db"


def summary_of(db: Path) -> tuple[dict[str, str], int, int]:
    """(codex_meta, doc count, word sum) for one roll.

    Words are not in ``codex_meta``; the daemon sums ``doc.word_count`` and so
    does this. Reading a 7M-row roll is seconds of I/O on a cold cache, which
    is why callers pass a ``summaries`` cache and the daemon seeds it from what
    it already counted while loading.
    """
    con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
    try:
        meta = dict(con.execute("SELECT key, value FROM codex_meta"))
        docs = con.execute("SELECT COUNT(*) FROM doc").fetchone()[0]
        words = con.execute("SELECT SUM(word_count) FROM doc").fetchone()[0] or 0
        return meta, int(docs), int(words)
    finally:
        con.close()


def art_by_codex(art_db: Path) -> dict[str, dict]:
    """First bound image per codex, for the cover. Absent art.db -> no covers."""
    if not art_db.is_file():
        return {}
    con = sqlite3.connect(f"file:{art_db}?mode=ro", uri=True)
    try:
        rows = con.execute(
            "SELECT b.codex, a.slug, a.subject, a.discipline "
            "FROM binding b JOIN art a ON a.id = b.art_id "
            "ORDER BY b.codex, a.id").fetchall()
    finally:
        con.close()
    first: dict[str, dict] = {}
    for codex, slug, subject, discipline in rows:
        first.setdefault(codex, {"slug": slug, "subject": subject,
                                 "discipline": discipline})
    return first


def _sha256(path: Path, max_hash: int | None) -> str | None:
    """Digest of one film file.

    ``None`` never hashes (the daemon must not read 34 GB to answer a request),
    0 hashes everything, a positive number is a size cap. Anything skipped is
    reported as null, never as a placeholder.
    """
    if max_hash is None:
        return None
    if max_hash and path.stat().st_size > max_hash:
        return None
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def _shelf_id(name: str, built_at: str) -> str:
    """Stable, obviously-not-physical identity for a roll on a shelf."""
    return "shelf-" + hashlib.sha1(f"{name}|{built_at}".encode()).hexdigest()[:20]


def manifest(db: Path, art: dict | None, creator: str,
             max_hash: int | None,
             summary: tuple[dict[str, str], int, int] | None = None) -> dict:
    """One shelf manifest for one core roll. Film paths stay relative to the
    data directory; a pack step rewrites them to ``film/...``.

    ``summary`` is the daemon's already-computed (meta, docs, words) for a
    loaded roll. Summing ``word_count`` over 7M rows is seconds of I/O, so it
    is never repeated per request when the answer is already in memory.
    """
    name = db.name[:-len(CORE_SUFFIX)]
    meta, docs, words = summary or summary_of(db)
    deep = db.with_name(db.name.replace(CORE_SUFFIX, DEEP_SUFFIX))
    licence, licence_url = LICENCES.get(
        name, LICENCES.get(meta.get("adapter", ""), ("Check at pack time", "")))

    film = [{
        "role": "core",
        "file": db.name,
        "bytes": db.stat().st_size,
        "sha256": _sha256(db, max_hash),
    }]
    if deep.is_file():
        film.append({
            "role": "deep",
            "file": deep.name,
            "bytes": deep.stat().st_size,
            "sha256": _sha256(deep, max_hash),
        })

    built_at = meta.get("built_at", "")
    seed = int(hashlib.sha1(name.encode()).hexdigest(), 16)
    return {
        "schema": 1,
        "cassette_id": _shelf_id(name, built_at),
        "sealed": False,
        "name": name,
        "title": meta.get("title") or name,
        "issue": (meta.get("zim_date") or built_at or "")[:7].replace("-", "."),
        "created_at": built_at,
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
            "palette": PALETTES[seed % len(PALETTES)],
        },
        "licence": {"name": licence, "url": licence_url,
                    "note": "Verify before redistribution"},
        "manifest_sha256": None,
    }


def build(data_dir: Path, art_db: Path, *, creator: str = DEFAULT_CREATOR,
          skip: set[str] | None = None, only: set[str] | None = None,
          max_hash: int | None = None, generated_by: str = "codexd",
          generated_at: str = "",
          summaries: dict[str, tuple[dict[str, str], int, int]] | None = None,
          ) -> dict:
    """The library document: every shelf roll, largest first.

    ``skip`` removes rolls from the shelf (``data/shelf.json``), ``only``
    restricts to named rolls (tests, packing one cassette), and they are
    independent on purpose: an explicitly named roll is never shelf-filtered.

    ``summaries`` is a caller-owned cache keyed by roll name. Fill it with what
    you already know (the daemon does, from loading) and it is used as-is;
    anything missing is read once and stored back.
    """
    skip = skip or set()
    cache = summaries if summaries is not None else {}
    art_by = art_by_codex(art_db)
    cassettes = []
    for db in sorted(data_dir.glob(f"*{CORE_SUFFIX}")):
        name = db.name[:-len(CORE_SUFFIX)]
        if only is not None and name not in only:
            continue
        if only is None and name in skip:
            continue
        if name not in cache:
            cache[name] = summary_of(db)
        cassettes.append(manifest(db, art_by.get(name), creator, max_hash,
                                  summary=cache[name]))

    cassettes.sort(key=lambda c: -c["contents"]["documents"])
    return {
        "schema": 1,
        "generated_at": generated_at,
        "generated_by": generated_by,
        "note": "Shelf manifests built from film on disk. No cassette is sealed; "
                "no manifest digest is claimed.",
        "cassettes": cassettes,
    }
