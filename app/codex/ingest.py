"""Ingestion funnel: every source becomes a stream of documents.

A codex is built from `(title, sections, outlinks)` tuples no matter where
they came from -- a ZIM archive, a directory of markdown, OCR'd PDFs. An
ingester's only job is producing that stream; everything downstream
(compression, graph, indexes) is source-agnostic and shared.

Conventions an ingester must honour, because the graph resolves on them:

- `Doc.path` is the document's stable identity. Links must name it exactly
  (markdown: relative POSIX path with suffix, e.g. ``notes/tea.md``).
- `Doc.links` are raw outbound identities in the same space. A source with
  no links yields no edges: valid, but the film is then BM25-only by
  construction (every document an orphan, no context labels, no related).
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path
from typing import Iterator

from libzim.reader import Archive

from .adapters import GenericAdapter, pick_adapter
from .model import KIND_ARTICLE, Doc, Section


@dataclass
class Redirect:
    """A title alias: from_path names to_path. Mirrors ZIM redirects."""
    from_path: str
    to_path: str


class Ingester:
    """One source type. Yield ("doc", Doc) | ("redirect", Redirect)."""

    name = "base"

    def iter_docs(self, source: str) -> Iterator:
        raise NotImplementedError


def archive_meta(a: Archive) -> dict:
    """Archive-wide metadata, minus illustrations. Moved here from build so
    every ZIM reader shares the one copy."""
    meta = {}
    for k in a.metadata_keys:
        if k.startswith("Illustration"):
            continue
        try:
            meta[k] = bytes(a.get_metadata(k)).decode("utf-8", "replace")
        except Exception:
            pass
    return meta


def _extract_one(a: Archive, adapter, i: int) -> tuple[str, object] | None:
    """Return ('doc', Doc) | ('redirect', (from, to)) | None.

    Moved here from build so the sequential ingester and the mp workers
    share it. Same behaviour, one copy.
    """
    try:
        e = a._get_entry_by_id(i)
    except Exception:
        return None
    path = e.path
    if adapter.skip_path(path):
        return None
    try:
        if e.is_redirect:
            target = e.get_redirect_entry().path
            return ("redirect", (path, target))
        item = e.get_item()
        if not item.mimetype.startswith("text/html"):
            return None
        raw = bytes(item.content).decode("utf-8", "replace")
        # The body is not always in the entry we are standing on. A crawled
        # single-page app stores a routing stub here and the prose in a sibling
        # JSON entry, so the adapter gets to say where to actually read from.
        raw = adapter.source_for(a, e, raw)
        if raw is None:
            return None
    except Exception:
        return None

    try:
        doc = adapter.parse(raw, path, e.title)
    except Exception:
        return None
    if doc is None or not adapter.should_keep(doc):
        return None
    return ("doc", doc)


class ZimIngester(Ingester):
    """Sequential ZIM enumeration. The mp fast path in build.extract_pass
    does the same work per entry (see _extract_one); this is the readable
    reference and what calibrate-style tooling uses."""

    name = "zim"

    def iter_docs(self, source: str) -> Iterator:
        a = Archive(source)
        adapter = pick_adapter(archive_meta(a))
        adapter.prepare(a)
        n = a.all_entry_count
        for i in range(n):
            got = _extract_one(a, adapter, i)
            if got is None:
                continue
            tag, payload = got
            if tag == "redirect":
                yield ("redirect", Redirect(payload[0], payload[1]))
            else:
                yield ("doc", payload)


_LINK_WIKI = re.compile(r"\[\[([^\]|]+)(?:\|[^\]]*)?\]\]")
_LINK_MD = re.compile(r"\[[^\]]*\]\(([^)\s]+)\)")
_H_GUARD = ("http://", "https://", "mailto:", "data:")


class MarkdownIngester(Ingester):
    """A directory of `.md` files. The proof that the funnel is general.

    Title: first `# ` heading, else the file stem. Sections split on `## `.
    Lead: first paragraph. Links: `[[target]]` wikilinks and
    `[text](target.md)`; resolved against the linking file, relative POSIX,
    suffix kept, anchors dropped. External URLs are dropped, not documents:
    there is nothing to resolve them to.
    """

    name = "markdown"
    min_words = 20
    hub_min_links = 5

    def iter_docs(self, source: str) -> Iterator:
        root = Path(source)
        for p in sorted(root.rglob("*.md")):
            doc = self._parse(p, root)
            if doc is not None:
                yield ("doc", doc)

    def _parse(self, path: Path, root: Path) -> Doc | None:
        try:
            text = path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            return None
        rel = path.relative_to(root).as_posix()
        lines = text.replace("\r\n", "\n").split("\n")
        title = ""
        body_lines: list[str] = []
        for ln in lines:
            if title == "" and ln.startswith("# "):
                title = ln[2:].strip()
                continue
            body_lines.append(ln)
        if not title:
            title = path.stem
        chunks = re.split(r"^##\s+", "\n".join(body_lines),
                          flags=re.MULTILINE)
        sections: list[Section] = []
        lead = ""
        for ci, chunk in enumerate(chunks):
            chunk = chunk.strip()
            if not chunk:
                continue
            parts = chunk.split("\n", 1)
            if ci == 0 and not chunk.startswith("#"):
                paras = [pp.strip() for pp in
                         re.split(r"\n\s*\n", chunk) if pp.strip()]
                if paras:
                    lead = paras[0]
                    if len(paras) > 1:
                        sections.append(Section(h="", t="\n\n".join(paras[1:])))
            else:
                head = parts[0].strip()
                rest = parts[1].strip() if len(parts) > 1 else ""
                # A deeper heading (###) inside a ## section is body text;
                # the funnel only splits one level, like _split_headings.
                sections.append(Section(h=head, t=re.sub(
                    r"^#{1,6}\s+", "", rest, flags=re.MULTILINE)))
        links = self._links(text, Path(rel).parent, root)
        doc = Doc(path=rel, title=title, kind=KIND_ARTICLE, lead=lead,
                  sections=sections, links=links)
        # No lead, no preview, title-only findable (the wikiversity lesson):
        # fall back to the body's first paragraph.
        if not doc.lead and doc.sections:
            doc.lead = doc.sections[0].t.split("\n\n")[0]
        if doc.word_count >= self.min_words:
            return doc
        if len(doc.links) >= self.hub_min_links:
            return doc
        return None

    def _links(self, text: str, parent: Path, root: Path) -> list[str]:
        out: list[str] = []
        seen: set[str] = set()
        raws = _LINK_WIKI.findall(text)
        raws += [m.split("#")[0] for m in _LINK_MD.findall(text)]
        for raw in raws:
            raw = raw.strip().split("#")[0]
            if not raw or raw.startswith(_H_GUARD):
                continue
            if raw.startswith("/"):
                cand = Path(raw.lstrip("/"))
            else:
                cand = Path(*parent.parts, raw) if str(parent) != "." \
                    else Path(raw)
            # Normalise without touching the disk: pure POSIX collapse.
            norm = Path(*[p for p in cand.parts if p not in ("", ".")])
            parts: list[str] = []
            for p in norm.parts:
                if p == "..":
                    if parts:
                        parts.pop()
                else:
                    parts.append(p)
            if not parts:
                continue
            cand = Path(*parts)
            if not cand.suffix:
                cand = cand.with_suffix(".md")
            s = cand.as_posix()
            if s not in seen:
                seen.add(s)
                out.append(s)
        return out


def pick_ingester(source: str) -> Ingester:
    """Directory -> markdown, .zim -> ZIM. Anything else is an error, loudly:
    a build that guesses its source is how silent 6-document corpora happen."""
    if Path(source).is_dir():
        return MarkdownIngester()
    if source.endswith(".zim"):
        return ZimIngester()
    raise ValueError(f"unknown source (want a directory or a .zim): {source}")
