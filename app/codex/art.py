"""The curated image layer: read side.

A codex still stores no images, and that decision is unchanged. Kiwix archives
cannot supply usable ones -- re-sampled across six archives still on disk, 1,049
of 1,050 images were under 2 MP and the median was 0.05 MP. What this module
reads is a separate, hand-curated file sourced externally and licence-filtered at
ingest, which is a different thing arriving by a different route.

`art.db` is optional and detachable, exactly like `codex-deep.db`:

  art.db    subject-keyed images plus the bindings that attach them to documents.
            Absent file means every art feature disappears and nothing else
            notices. Shared by all codexes rather than duplicated per codex,
            because `Bacteria` is a document in three of them.

Two deliberate non-choices:

**It is never ATTACHed to a Searcher connection.** Joining a binding table into
the search CTE is the natural shape and it is the wrong one here: that query's
plan is pinned by measurement (inlining the doc join cost 8x on prefix queries),
and the binding table is a few hundred rows. The daemon holds the whole
`(codex, doc_id) -> art_id` map in a dict and annotates hits after ranking, so
`codex/search.py` needs no change at all.

**No networking is imported here.** Fetching lives in `tools/art_commons.py`,
which the daemon never imports, so "no network call at query time" is a property
of the import graph rather than a promise in a docstring.
"""
from __future__ import annotations

import sqlite3
import threading
from pathlib import Path

# Columns the API hands out. `hero` and `thumb` are excluded on purpose: they are
# blobs served by their own route, not fields to be JSON-encoded.
_FIELDS = ("slug", "subject", "discipline", "width", "height", "artist",
           "credit", "licence", "licence_url", "source_file", "source_url",
           "description")


class ArtStore:
    """Read-only access to art.db, with the bindings held in memory.

    Per-thread connections, for the same reason `Searcher` uses them: one shared
    handle serialises every statement, and a hero image fetch would then queue
    behind whatever else the daemon is doing.
    """

    def __init__(self, path: str | Path):
        self.path = Path(path)
        if not self.path.exists():
            raise FileNotFoundError(self.path)
        self._local = threading.local()
        con = self._connect()
        # The whole point of the dicts: hit annotation and shelf links are
        # lookups, not queries.
        self._binding: dict[tuple[str, int], int] = {}
        self._bound_docs: dict[int, list[tuple[str, int]]] = {}
        for codex, doc_id, art_id in con.execute(
                "SELECT codex, doc_id, art_id FROM binding"):
            self._binding[(codex, doc_id)] = art_id
            self._bound_docs.setdefault(art_id, []).append((codex, doc_id))
        self._meta: dict[int, dict] = {}
        self._by_slug: dict[str, int] = {}
        for row in con.execute(f"SELECT id, {', '.join(_FIELDS)} FROM art"):
            art_id = row["id"]
            rec = {k: row[k] for k in _FIELDS}
            rec["hero_url"] = f"/art/{rec['slug']}.webp"
            rec["thumb_url"] = f"/art/{rec['slug']}.thumb.webp"
            self._meta[art_id] = rec
            self._by_slug[rec["slug"]] = art_id

    @classmethod
    def open_if_present(cls, path: str | Path) -> "ArtStore | None":
        """The graceful-absence path. Mirrors how `has_deep` guards the deep file."""
        try:
            return cls(path)
        except (FileNotFoundError, sqlite3.DatabaseError):
            return None

    def _connect(self) -> sqlite3.Connection:
        con = getattr(self._local, "con", None)
        if con is None:
            con = sqlite3.connect(f"file:{self.path}?mode=ro", uri=True,
                                  check_same_thread=False)
            con.row_factory = sqlite3.Row
            self._local.con = con
        return con

    # --- lookup ------------------------------------------------------------

    def slug_for(self, codex: str, doc_id: int) -> str | None:
        """The hot path: called once per search hit. Two dict lookups."""
        art_id = self._binding.get((codex, doc_id))
        return None if art_id is None else self._meta[art_id]["slug"]

    def for_doc(self, codex: str, doc_id: int) -> dict | None:
        art_id = self._binding.get((codex, doc_id))
        return None if art_id is None else dict(self._meta[art_id])

    def by_slug(self, slug: str) -> dict | None:
        art_id = self._by_slug.get(slug)
        return None if art_id is None else dict(self._meta[art_id])

    def blob(self, slug: str, kind: str = "hero") -> bytes | None:
        if kind not in ("hero", "thumb") or slug not in self._by_slug:
            return None
        row = self._connect().execute(
            f"SELECT {kind} AS b FROM art WHERE slug = ?", (slug,)).fetchone()
        return None if row is None else bytes(row["b"])

    def annotate(self, hits: list[dict]) -> None:
        """Tag search hits that have an image. Mutates in place.

        One field, one dict lookup per hit. Deliberately not a join: see the
        module docstring.
        """
        for h in hits:
            slug = self.slug_for(h.get("codex", ""), h.get("id", -1))
            if slug:
                h["art"] = slug

    def shelf(self, letter: str, loaded: set[str]) -> list[dict]:
        """Curated subjects for one A-Z letter, each with a live doc link.

        Subjects are art-side (title, discipline, thumbnail); the link is the
        subject's binding, wikipedia preferred, restricted to `loaded` codexes
        so every card opens. Subjects with no loaded binding are skipped, and
        an empty letter yields an empty list the canvas hides.
        """
        out = []
        for art_id, rec in self._meta.items():
            subject = rec.get("subject") or ""
            initial = subject[:1].upper()
            key = initial if "A" <= initial <= "Z" else "#"
            if key != letter:
                continue
            docs = [d for d in self._bound_docs.get(art_id, [])
                    if d[0] in loaded]
            if not docs:
                continue
            pick = next((d for d in docs if d[0] == "wikipedia"), docs[0])
            out.append({
                "subject": subject,
                "discipline": rec.get("discipline", ""),
                "slug": rec["slug"],
                "thumb_url": rec["thumb_url"],
                "codex": pick[0],
                "doc_id": pick[1],
            })
        out.sort(key=lambda i: i["subject"].lower())
        return out

    # --- introspection -----------------------------------------------------

    def stats(self) -> dict:
        con = self._connect()
        total = con.execute(
            "SELECT COALESCE(SUM(LENGTH(hero)+LENGTH(thumb)), 0) FROM art"
        ).fetchone()[0]
        by_codex: dict[str, int] = {}
        for codex, _ in self._binding:
            by_codex[codex] = by_codex.get(codex, 0) + 1
        return {"images": len(self._meta), "bindings": len(self._binding),
                "bytes": total, "file_bytes": self.path.stat().st_size,
                "by_codex": by_codex}

    def __len__(self) -> int:
        return len(self._meta)
