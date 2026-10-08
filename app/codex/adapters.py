"""Per-source extraction adapters.

Every ZIM is built by a different scraper, so the markup differs wildly. An
adapter knows how to turn one family of pages into a `Doc`: which container holds
the real content, which furniture to discard, and how to recover structure.

Adapters are selected by inspecting the archive's `Name`/`Creator` metadata, and
`GenericAdapter` handles anything unrecognised.
"""
from __future__ import annotations

import json
import re
from urllib.parse import unquote, urljoin

from selectolax.lexbor import LexborHTMLParser

from .hygiene import clean_sections, clean_text
from .model import (KIND_ARTICLE, KIND_CATEGORY, KIND_DEVICE, KIND_GUIDE, Doc,
                    Section, norm)
from .schema import FLAG_IMAGE_DEPENDENT

# Furniture present in essentially every scraped page.
COMMON_JUNK = (
    "script", "style", "noscript", "head", "template", "svg", "form",
    "nav", "footer", "header", "aside",
)

_EXTERNAL = re.compile(r"^(?:[a-z][a-z0-9+.-]*:|//)", re.I)

_HEADING_TAGS = frozenset(("h1", "h2", "h3", "h4", "h5", "h6"))
_HEADING_SEL = "h1,h2,h3,h4,h5,h6"
# Whether a subtree holds any structure worth descending into. Asked once per
# node in the walk below, which is the most-executed query in the whole build.
_STRUCTURE_SEL = _HEADING_SEL + ",table"

# "0 comments", "One comment", "12 comments" - iFixit renders the count inside
# the step body, so it lands in the extracted text unless filtered.
_COMMENT_COUNT = re.compile(r"^(?:\d+|one|no)\s+comments?$", re.I)

_STEP_LINE_SEL = ".stepLine, .step-line, li, p"

# The iFixit guide header strip, in the order it renders.
_GUIDE_HEADER = re.compile(
    r"Written\s+By:\s*.*?(?=Comments:|Difficulty|Steps\b|Time\s+Required|$)"
    r"|Comments?:\s*\d+"
    r"|\bDifficulty\s+(?:Very\s+)?(?:easy|moderate|difficult|hard)\b"
    r"|\bSteps\s+\d+"
    r"|\bTime\s+Required\s+[\d\s\-–]+(?:minutes?|hours?|days?)?"
    r"(?:\s*-\s*[\d\s]*(?:minutes?|hours?))?",
    re.I | re.S)


def _links(tree, base_path: str) -> list[str]:
    """Collect internal outbound links as normalised ZIM paths.

    Skips fragments, external schemes and mailto. Relative paths are resolved
    against the containing document so `../foo/bar` lands where it should.
    """
    out: list[str] = []
    seen = set()
    base_dir = base_path.rsplit("/", 1)[0] + "/" if "/" in base_path else ""
    for a in tree.css("a[href]"):
        href = a.attributes.get("href") or ""
        if not href or href.startswith("#") or _EXTERNAL.match(href):
            continue
        href = href.split("#", 1)[0].split("?", 1)[0]
        if not href:
            continue
        # Resolve ../ and ./ against the document's directory.
        if href.startswith("../") or href.startswith("./"):
            resolved = urljoin("http://x/" + base_dir, href)[len("http://x/"):]
        elif href.startswith("/"):
            resolved = href.lstrip("/")
        else:
            resolved = base_dir + href if base_dir else href
        resolved = unquote(resolved)
        if resolved and resolved not in seen:
            seen.add(resolved)
            out.append(resolved)
    return out


def _derive_lead(sections, limit: int = 600) -> str:
    """A stand-in lead for documents that have no lead paragraph.

    Not every wiki puts prose before the first heading. Wikiversity starts 30%
    of its pages on a heading ("Presentation", "Module Overview") and leaves
    others with an empty first section, so `sections[0]` is the wrong thing to
    reach for twice over. Since `fts_quick` indexes title+lead, an empty lead
    makes a document findable by title alone -- measured on the wikiversity
    codex, 14,698 of 49,695 documents, every one of which had body text.

    Takes the first section that actually carries text, skipping empty ones.
    """
    for s in sections:
        t = s.search_text.strip()
        if t:
            return t[:limit]
    return ""


def _table(node) -> Section | None:
    """Turn a <table> into a structured Section.

    Flattening a table to prose destroys exactly the structure that makes it
    worth reading. Headers and rows are kept separately so the reader can
    render a real table and a model can treat it as data.
    """
    rows_out: list[list[str]] = []
    headers: list[str] = []
    for tr in node.css("tr"):
        cells = tr.css("th, td")
        if not cells:
            continue
        values = [norm(c.text(separator=" ", strip=True)) for c in cells]
        if not any(values):
            continue
        # A row of all <th> and no prior data rows is the header.
        if not headers and not rows_out and all(c.tag == "th" for c in cells):
            headers = values
        else:
            rows_out.append(values)
    if not rows_out and not headers:
        return None
    cap = node.css_first("caption")
    return Section(h=norm(cap.text(strip=True)) if cap else "",
                   kind="table", headers=headers, rows=rows_out)


# Joined selector lists, cached per adapter. Joining is cheap, but at 7M
# documents "cheap" still adds up to seconds.
_JOINED_SELECTORS: dict[tuple, str] = {}


def _drop(tree, selectors) -> None:
    """Strip furniture in a single pass.

    One combined selector rather than one tree.css() per selector: the
    Wikipedia adapter carries 40 of them, and 40 separate passes cost
    0.276 ms/doc against 0.214 for the combined query -- for byte-identical
    output, verified over 400 real articles.
    """
    sel = _JOINED_SELECTORS.get(selectors)
    if sel is None:
        sel = _JOINED_SELECTORS[selectors] = ",".join(selectors)
    for n in tree.css(sel):
        n.decompose()


def _title_of(tree, fallback: str) -> str:
    for sel in ("h1", "title"):
        n = tree.css_first(sel)
        if n:
            t = norm(n.text(strip=True))
            if t:
                return t
    return fallback


class GenericAdapter:
    """Fallback: strip furniture, split on headings, keep paragraphs."""

    name = "generic"
    kind = KIND_ARTICLE
    junk: tuple = COMMON_JUNK
    container: tuple = ("main", "article", "#content", "#mw-content-text", "body")

    # Path prefixes that never contain knowledge worth indexing. Checked before
    # the entry is decompressed, so rejecting here costs nothing.
    exclude_prefixes: tuple = ()
    # Below this many words a page is a stub with no informational content.
    min_words: int = 20
    # A short page that links out to many kept pages is a navigation hub and is
    # worth keeping even though it has little prose of its own.
    hub_min_links: int = 5

    @classmethod
    def matches(cls, meta: dict) -> bool:
        return False

    def prepare(self, archive) -> None:
        """Build any archive-wide index this adapter needs, once per worker.

        Nothing to do for a source whose pages are self-describing, which is
        every mwoffliner archive. Overridden by adapters that have to consult a
        table of contents to know what a page is or where it sits.
        """

    def source_for(self, archive, entry, raw: str) -> str | None:
        """The HTML to actually parse for this entry.

        Normally the entry's own bytes. An archive that stores routing stubs in
        its HTML entries and the real prose elsewhere overrides this to go and
        fetch it. Returning None drops the entry.
        """
        return raw

    def skip_path(self, path: str) -> bool:
        """Cheap pre-filter: reject by path without touching the cluster."""
        return path.startswith(self.exclude_prefixes) if self.exclude_prefixes else False

    def should_keep(self, doc: Doc) -> bool:
        """Reject stubs and dead ends after parsing."""
        if doc.word_count >= self.min_words:
            return True
        return len(doc.links) >= self.hub_min_links

    def content_root(self, tree):
        for sel in self.container:
            n = tree.css_first(sel)
            if n is not None:
                return n
        return tree.css_first("body")

    def parse(self, raw: str, path: str, title_hint: str = "") -> Doc | None:
        tree = LexborHTMLParser(raw)
        # Title first: <title> lives in <head>, which the strip removes.
        title = _title_of(tree, title_hint or path)

        _drop(tree, self.junk)
        root = self.content_root(tree)
        if root is None:
            return None

        # Links are collected from the cleaned content root, never the raw tree.
        # A link inside a nav bar or a citation is an artefact of the page
        # furniture, not an editorial signal that two topics are related, and
        # counting them lets boilerplate targets dominate the ranking.
        links = _links(root, path)

        sections = self._split_headings(root)
        sections, dependent = clean_sections(sections)
        lead = ""
        if sections and not sections[0].h and sections[0].kind == "text":
            lead = sections[0].t
            sections = sections[1:]
        if not lead:
            lead = _derive_lead(sections)
        if not lead and not sections:
            return None
        lead, lead_dep = clean_text(lead)

        return Doc(path=path, title=title, kind=self.kind, lead=lead,
                   sections=sections, links=links,
                   flags=FLAG_IMAGE_DEPENDENT if (dependent or lead_dep) else 0)

    def _split_headings(self, root) -> list[Section]:
        """Split into heading-delimited sections, in document order.

        Headings are not reliably direct children of the content root: mwoffliner
        wraps each section in its own <section> element, so a flat scan of the
        root's children finds no headings at all and collapses the whole article
        into one blob. Recurse into any subtree that contains a heading, and take
        the text wholesale from any subtree that does not.
        """
        events: list[tuple[str, str]] = []

        def walk(node) -> None:
            for child in node.iter(include_text=False):
                tag = child.tag
                if tag in _HEADING_TAGS:
                    events.append(("h", norm(child.text(strip=True))))
                elif tag == "table":
                    tbl = _table(child)
                    if tbl is not None:
                        events.append(("tbl", tbl))
                elif child.css_first(_STRUCTURE_SEL) is not None:
                    # Contains a heading or a table deeper down - descend so we
                    # don't swallow the structure. Asked as one query rather
                    # than a heading check followed by a table check: same
                    # decision, 0.642 -> 0.367 ms/doc.
                    walk(child)
                else:
                    txt = child.text(separator="\n", strip=True)
                    if txt:
                        events.append(("t", txt))

        walk(root)

        sections: list[Section] = []
        cur_h, buf = "", []

        def flush():
            t = norm("\n\n".join(buf))
            if t or cur_h:
                sections.append(Section(h=cur_h, t=t))

        for kind, val in events:
            if kind == "h":
                flush()
                cur_h, buf = val, []
            elif kind == "tbl":
                flush()
                # The table inherits the current heading, then prose resumes
                # under it without repeating the heading.
                val.h = val.h or cur_h
                sections.append(val)
                cur_h, buf = "", []
            elif val:
                buf.append(val)
        flush()

        return [s for s in sections
                if s.kind == "table" or len(s.t) > 1 or s.h]


class WikipediaAdapter(GenericAdapter):
    """MediaWiki/mwoffliner output.

    Navboxes, reference lists and inline <style> blocks account for well over
    half the extracted text on a long article, and none of it is prose worth
    indexing. Infoboxes are dropped from the body but their key/value pairs are
    genuinely useful, so they are preserved separately.
    """

    name = "wikipedia"
    kind = KIND_ARTICLE
    container = (".mw-parser-output", "#mw-content-text", "main", "body")
    # Non-article namespaces: maintenance pages, not knowledge.
    exclude_prefixes = ("Category:", "Template:", "Help:", "Portal:", "File:",
                        "Special:", "Talk:", "Wikipedia:", "Module:", "Draft:",
                        "MediaWiki:", "User:", "Book:", "TimedText:")
    # Even a two-line stub is legitimate encyclopaedic content.
    min_words = 12
    junk = COMMON_JUNK + (
        ".navbox", ".vertical-navbox", ".navbox-inner",
        ".mw-references-wrap", ".reflist", ".references", "sup.reference",
        "cite", ".citation", ".reference-text", ".mw-cite-backlink",
        # Image furniture. With no images stored, a caption describes nothing.
        "figure", "figcaption", ".thumb", ".thumbcaption", ".gallerybox",
        ".mwe-math-fallback-image-inline", ".mwe-math-fallback-image-display",
        ".mw-editsection", ".hatnote", ".metadata", ".noprint",
        ".sistersitebox", ".portal", ".mbox-small", ".ambox", ".sidebar",
        ".shortdescription", ".mw-empty-elt", ".catlinks", "#catlinks",
        ".printfooter", ".mw-jump-link", ".thumbcaption .magnify",
        "table.infobox", "table.vertical-navbox", ".gallery",
        "details.mw-collapsible", ".mw-kartographer-maplink",
    )

    @classmethod
    def matches(cls, meta: dict) -> bool:
        name = (meta.get("Name") or "").lower()
        creator = (meta.get("Creator") or "").lower()
        return "wikipedia" in name or "wikipedia" in creator or "wikivoyage" in name \
            or "wikiversity" in name or "wiktionary" in name

    def parse(self, raw: str, path: str, title_hint: str = "") -> Doc | None:
        tree = LexborHTMLParser(raw)
        title = _title_of(tree, title_hint or path)
        # Read the infobox before the strip removes it.
        infobox = self._infobox(tree)
        self._mathml_to_latex(tree)

        _drop(tree, self.junk)
        root = self.content_root(tree)
        if root is None:
            return None

        # Prose links only. Reference lists and navboxes are already gone, which
        # keeps citation targets such as newspapers and web archives from
        # swamping PageRank -- they are cited by everything and about nothing.
        links = _links(root, path)

        sections = self._split_headings(root)
        sections, dependent = clean_sections(sections)
        # mwoffliner emits the lead before any heading.
        lead = ""
        if sections and not sections[0].h and sections[0].kind == "text":
            lead = sections[0].t
            sections = sections[1:]

        # Sections that are pure link-farms carry no prose.
        sections = [s for s in sections
                    if s.h.lower() not in ("see also", "references", "external links",
                                           "further reading", "notes", "bibliography",
                                           "sources", "citations")]
        # Wikipedia proper always has a lead; its siblings do not. Derived after
        # the link-farm filter so a "See also" list never becomes the preview.
        if not lead:
            lead = _derive_lead(sections)
        if not lead and not sections:
            return None

        doc = Doc(path=path, title=title, kind=self.kind, lead=lead,
                  sections=sections, links=links,
                  flags=FLAG_IMAGE_DEPENDENT if dependent else 0)
        if infobox:
            doc.meta["infobox"] = infobox
        return doc

    @staticmethod
    def _mathml_to_latex(tree) -> None:
        """Replace MathML blocks with their LaTeX source.

        mwoffliner emits every formula three ways: hidden MathML, an SVG
        fallback image, and a LaTeX string in the <math> tag's `alttext`.
        Extracting the text of the MathML yields character soup, and the SVG is
        a binary we do not store -- but the LaTeX is exact, compact, greppable
        and renderable. Pythagorean theorem carries 99 of these.
        """
        for el in tree.css(".mwe-math-element"):
            m = el.css_first("math[alttext]")
            latex = (m.attributes.get("alttext") or "").strip() if m else ""
            if latex.startswith("{\\displaystyle") and latex.endswith("}"):
                latex = latex[len("{\\displaystyle"):-1].strip()
            latex = " ".join(latex.split())
            el.replace_with(f" $ {latex} $ " if latex else " ")

    def _infobox(self, tree) -> dict:
        box = tree.css_first("table.infobox")
        if box is None:
            return {}
        out = {}
        for row in box.css("tr"):
            th, td = row.css_first("th"), row.css_first("td")
            if th is None or td is None:
                continue
            k = norm(th.text(separator=" ", strip=True))
            v = norm(td.text(separator=" ", strip=True))
            if k and v and len(k) < 60 and len(v) < 400:
                out[k] = v
        return out


class IFixitAdapter(GenericAdapter):
    """iFixit repair guides, device pages and wiki topics.

    Guides have real structure worth preserving: difficulty, time, tools, parts
    and numbered steps. Flattening that to prose would throw away exactly what
    makes a repair guide useful, so each becomes its own section.
    """

    name = "ifixit"
    container = ("#mainBody", "#main", "body")
    # User profiles are 56% of all HTML entries and carry a median of 3 words.
    # images/ and assets/ are pure media: 575k of the 895k entries, and every
    # redirect in the archive is an image-dedup redirect rather than a title
    # alias, so none of it survives extraction anyway.
    exclude_prefixes = ("User/", "Team/", "Talk/", "Contribute/", "Store/",
                        "Answers/", "News/", "Search/", "Boilerplate/",
                        "images/", "assets/", "media/")
    junk = COMMON_JUNK + (
        "#banner", ".comments", "#comments", ".comment", ".commentsContainer",
        # The comment count is rendered inside the step body. These are the
        # class tokens iFixit actually uses -- ".comments" does not match
        # "js-comment-container", which is why counts kept leaking into text.
        ".js-comment-container", ".js-comment-count", ".comments-header",
        ".comments-button-container", ".add-comment-button-container",
        ".guide-comments-container", ".js-page-comments",
        ".site-footer", ".breadcrumbs", ".chakra-modal__content",
        ".guide-prereqs-modal", ".js-comments", ".social", ".newsletter",
        ".related-guides-header", ".patrol-actions", ".guide-flags",
        ".authorInfo", ".author-info", ".reputation", ".vote-box",
        # Image furniture: with no images stored these are dangling captions.
        "figure", "figcaption", ".stepImage", ".step-images", ".media-wrapper",
        ".guide-image", ".thumbnail-list", ".image-caption",
    )

    @classmethod
    def matches(cls, meta: dict) -> bool:
        return "ifixit" in (meta.get("Name") or meta.get("Creator") or "").lower()

    def parse(self, raw: str, path: str, title_hint: str = "") -> Doc | None:
        if path.startswith("Guide/"):
            return self._parse_guide(raw, path, title_hint)
        kind = KIND_DEVICE if path.startswith("Device/") else (
            KIND_CATEGORY if path.startswith("Category/") else KIND_ARTICLE)
        doc = super().parse(raw, path, title_hint)
        if doc:
            doc.kind = kind
        return doc

    def _parse_guide(self, raw: str, path: str, title_hint: str) -> Doc | None:
        tree = LexborHTMLParser(raw)
        title = _title_of(tree, title_hint or path)
        _drop(tree, self.junk)
        links = _links(tree, path)

        meta = {}
        intro_node = tree.css_first("#guide-intro")
        intro = ""
        if intro_node is not None:
            # #guide-intro is one flat div holding the title, byline, comment
            # count, difficulty/time/steps strip AND the introduction prose.
            # Taking its text wholesale puts "Written By: ... Comments: 87"
            # into the search preview, so split it on its own headings and keep
            # only what sits under "Introduction".
            for sec in self._split_headings(intro_node):
                if sec.h.lower().startswith("introduction") and sec.t:
                    intro = sec.t
                    break
            stats = norm(" ".join(p.text(separator=" ", strip=True)
                                  for p in intro_node.css("p")))
            if stats:
                meta["stats"] = stats

        tools = [norm(n.text(strip=True)) for n in tree.css(".guide-tools .tool-title, "
                                                           ".requirement-title")]
        tools = [t for t in tools if t]

        # Each step is a .step block containing a heading and bullet lines.
        # iFixit emits every step twice -- a desktop and a mobile variant -- so
        # a naive pass yields "Step 1, Step 1, Step 2, Step 2" and doubles the
        # word count. Keep the richest copy of each step heading.
        by_head: dict[str, str] = {}
        order: list[str] = []
        for step in tree.css(".step"):
            head = step.css_first(".step-title, h2")
            hname = norm(head.text(strip=True)) if head else "Step"
            # The page header block carries the guide's own title and renders as
            # "Written By: ... Comments: 87 Difficulty ... Time Required ...".
            # That is metadata, not a step.
            if hname == title:
                continue
            lines = []
            for line in step.css(_STEP_LINE_SEL):
                # Skip wrapper elements: if a candidate contains another
                # candidate, its text is the concatenation of its children and
                # taking both repeats the whole step verbatim.
                if line.css(_STEP_LINE_SEL):
                    continue
                t = norm(line.text(separator=" ", strip=True))
                if not t or t in lines or _COMMENT_COUNT.match(t):
                    continue
                if hname and t == hname:
                    continue          # the step title, already the heading
                lines.append(t)
            body = "\n".join(lines)
            if not body:
                continue
            if hname not in by_head:
                order.append(hname)
                by_head[hname] = body
            elif len(body) > len(by_head[hname]):
                by_head[hname] = body

        sections: list[Section] = [Section(h=h, t=by_head[h]) for h in order]

        if not sections:
            # A guide with no steps (iFixit has many). Generic extraction picks
            # up the byline/comment header as the preview, so prefer the real
            # introduction when we managed to isolate one.
            doc = super().parse(raw, path, title_hint)
            if doc:
                doc.kind = KIND_GUIDE
                for sec in doc.sections:
                    if sec.kind == "text":
                        sec.t = self._scrub_header(sec.t)
                # A heading left with nothing under it is noise -- typically the
                # page header block once the byline strip is scrubbed away.
                doc.sections = [s for s in doc.sections
                                if s.kind == "table" or s.t.strip()]
                doc.lead = intro or self._scrub_header(doc.lead)
                if not doc.lead:
                    # Scrubbing can empty a lead that was nothing but the byline
                    # strip. Prefer real body text over no preview at all.
                    for sec in doc.sections:
                        body = sec.search_text.strip()
                        if body:
                            doc.lead = body[:400]
                            break
            return doc

        sections, dependent = clean_sections(sections)
        # A heading with nothing under it is noise: either the page header block
        # after scrubbing, or a step whose only content was a photo.
        sections = [s for s in sections
                    if s.kind == "table" or self._scrub_header(s.t)]
        for s in sections:
            if s.kind == "text":
                s.t = self._scrub_header(s.t)
        # Derived before the Tools section is prepended, or a guide with no
        # intro would take its tool list as the preview -- "iFixit Opening Tool
        # Phillips #000 Screwdriver" tells a searcher nothing about the repair.
        fallback = _derive_lead(sections, 400)
        if tools:
            sections.insert(0, Section(h="Tools", t="\n".join(tools)))

        intro, intro_dep = clean_text(intro)
        doc = Doc(path=path, title=title, kind=KIND_GUIDE,
                  lead=intro or fallback,
                  sections=sections, links=links,
                  flags=FLAG_IMAGE_DEPENDENT if (dependent or intro_dep) else 0)
        if tools:
            doc.meta["tools"] = tools
        if meta.get("stats"):
            doc.meta["stats"] = meta["stats"]
        return doc

    def should_keep(self, doc: Doc) -> bool:
        # iFixit's 404 interstitial is emitted as a real page thousands of times.
        if doc.title.strip().lower() in ("oups", "oops", "external content"):
            return False
        return super().should_keep(doc)

    @staticmethod
    def _scrub_header(text: str) -> str:
        """Strip the byline/stats strip from a lead.

        Guides with no parseable steps fall through to generic extraction, which
        picks up "Written By: Adam O'Camb Comments: 87 Difficulty Moderate
        Steps 49 Time Required 1 - 2 hours" as their preview. That is metadata,
        and it is the first thing shown in search results.
        """
        if not text:
            return text
        text = _GUIDE_HEADER.sub(" ", text)
        return norm(" ".join(text.split()))


class LibreTextsAdapter(GenericAdapter):
    """mindtouch2zim output - LibreTexts and anything else that scraper produces.

    The only adapter whose documents are not in the entry they are read from.
    Every `index/page_N` entry is a 300-byte meta-refresh stub carrying nothing
    but a <title>; the prose lives in `content/page_content_N.json` as
    `{"htmlBody": "<p>..."}`. Measured on the medicine library: 7.5 MB of HTML
    against 348 MB of JSON. A generic build reads only the stubs and produces
    **6 documents from 77,274 entries**, exits 0, and reports success.

    There is also no link graph in the prose. Across 400 sampled bodies: 459
    fragment anchors, 173 absolute off-site URLs, and not one link back into the
    archive. Left alone that means uniform PageRank, no `related`, and no
    context labels -- on a corpus where `Front Matter`, `TitlePage`, `InfoPage`,
    `Table of Contents` and `Back Matter` each repeat once per book across
    ~1,500 books. That is the iFixit *Safety Precautions x42* problem an order of
    magnitude larger.

    Both are fixed from `content/shared.json`, a 4.9 MB table of contents listing
    every page as {id, title, path} with a real hierarchy
    (`Bookshelves/.../Book_Title/Chapter/Page`). All 23,155 content pages appear
    in it and 100% resolve to a parent, so the graph is *reconstructed exactly*
    rather than guessed: containers link down to their children, every page links
    up to its nearest ancestor that has a body, and container pages are marked
    KIND_DEVICE so pass 2's existing inbound-device rule assigns each page its
    book as a context label.
    """

    name = "libretexts"

    _PAGE = "index/page_"
    _BODY = "content/page_content_"

    # Class-level defaults so an instance that never had prepare() called still
    # behaves -- it degrades to "no hierarchy" rather than raising.
    _archive = None
    _title: dict = {}
    _path: dict = {}
    _id_at: dict = {}
    _kids: dict = {}
    _body_cache: dict = {}

    # Draft and scratch areas -- the LibreTexts equivalent of `User:` pages.
    # Under_Construction/Purgatory is full of "1.2: Untitled Page 01".
    exclude_sections = frozenset(("Under_Construction", "Workbench", "Sandboxes"))

    # Top-level shelving. Nothing at or above this level is a book.
    _SHELVES = frozenset((
        "", "Courses", "Bookshelves", "Learning_Objects",
        "Under_Construction", "Workbench", "Sandboxes"))
    # A chapter or a section: "5: Lipids", "7.3: Water Soluble Vitamins".
    _NUMBERED = re.compile(r"^\d+(?:\.\d+)*\s*[:.]")
    # Skeleton pages every book repeats, useless as a label.
    _STRUCTURAL = frozenset((
        "front matter", "back matter", "table of contents", "infopage",
        "titlepage", "index", "glossary", "detailed licensing", "references",
        "about the authors"))

    @classmethod
    def matches(cls, meta: dict) -> bool:
        # Match the scraper, not the site: every LibreTexts library (med, chem,
        # bio, ...) is built by mindtouch2zim and has exactly this shape.
        return "mindtouch2zim" in (meta.get("Scraper") or "").lower() \
            or "libretexts" in (meta.get("Creator") or "").lower()

    def prepare(self, archive) -> None:
        # Held so parse() can resolve the hierarchy; parse() is handed only the
        # raw text and a path, and the graph has to be built from the TOC.
        self._archive = archive
        self._title: dict[str, str] = {}
        self._path: dict[str, str] = {}
        self._id_at: dict[str, str] = {}
        self._kids: dict[str, list[str]] = {}
        self._body_cache: dict[str, bool] = {}
        try:
            raw = bytes(archive.get_entry_by_path("content/shared.json")
                        .get_item().content).decode("utf-8", "replace")
            pages = json.loads(raw).get("pages", [])
        except Exception:
            return
        for p in pages:
            pid = p.get("id")
            if not pid:
                continue
            self._title[pid] = p.get("title") or ""
            self._path[pid] = p.get("path") or ""
            self._id_at[self._path[pid]] = pid
        for pid, pa in self._path.items():
            if not pa:
                continue
            parent = pa.rsplit("/", 1)[0] if "/" in pa else ""
            self._kids.setdefault(parent, []).append(pid)

        # Which nodes are books, and every page's book. The immediate parent is
        # the wrong label: the same textbook is remixed into many courses, so
        # "5: Lipids" names 23 different chapters and "Front Matter" 161. The
        # book name is the thing that actually disambiguates, and it is the
        # nearest ancestor that is neither shelving, nor numbered like a
        # chapter, nor one of the skeleton pages every book repeats. Measured:
        # 99.6% of pages resolve, and the share pointing at a duplicated label
        # drops from 17.5% to 9.6%.
        self._books: set[str] = {
            pa for pa in self._id_at
            if "/" in pa and pa not in self._SHELVES
            and not self._NUMBERED.match(self._title.get(self._id_at[pa], ""))
            and self._title.get(self._id_at[pa], "").strip().lower()
            not in self._STRUCTURAL}
        self._descendants: dict[str, list[str]] = {}
        for pid, pa in self._path.items():
            book = self._book_of(pa)
            if book is not None:
                self._descendants.setdefault(book, []).append(pid)

    def _book_of(self, path: str) -> str | None:
        while "/" in path:
            path = path.rsplit("/", 1)[0]
            if path in self._SHELVES:
                return None
            if path in self._books:
                return path
        return None

    def _has_body(self, archive, pid: str) -> bool:
        hit = self._body_cache.get(pid)
        if hit is None:
            hit = archive.has_entry_by_path(f"{self._BODY}{pid}.json")
            self._body_cache[pid] = hit
        return hit

    def _nearest_ancestor(self, archive, path: str) -> str | None:
        """The closest ancestor that is a real document.

        1,538 of the 24,693 TOC nodes are pure shelving with no page of their
        own, so linking blindly to the immediate parent would dead-end for them.
        """
        while "/" in path:
            path = path.rsplit("/", 1)[0]
            pid = self._id_at.get(path)
            if pid and self._has_body(archive, pid):
                return pid
        return None

    def skip_path(self, path: str) -> bool:
        # An accept-list rather than a reject-list: everything that is not a page
        # stub is MathJax, JS bundles, or a handful of scraped third-party pages
        # (cnx.org shells, chemspider image handlers, a flickr page).
        if not path.startswith(self._PAGE):
            return True
        toc = self._path.get(path[len(self._PAGE):])
        if toc is None:
            return False
        return toc.split("/", 1)[0] in self.exclude_sections

    def source_for(self, archive, entry, raw: str) -> str | None:
        pid = entry.path[len(self._PAGE):]
        if not self._has_body(archive, pid):
            return None
        blob = bytes(archive.get_entry_by_path(f"{self._BODY}{pid}.json")
                     .get_item().content).decode("utf-8", "replace")
        return json.loads(blob).get("htmlBody") or None

    def parse(self, raw: str, path: str, title_hint: str = "") -> Doc | None:
        doc = super().parse(raw, path, title_hint)
        if doc is None:
            return None
        pid = path[len(self._PAGE):]
        # The TOC title beats anything in the fragment: htmlBody has no <title>,
        # and its first <h1> is often a section heading rather than the page name.
        doc.title = self._title.get(pid) or title_hint or doc.title
        archive = self._archive
        pa = self._path.get(pid, "")
        out = [k for k in self._kids.get(pa, []) if self._has_body(archive, k)]
        is_book = pa in self._books
        if is_book:
            # A book links to every page under it, not just its direct children.
            # Pass 2 takes context from the highest-ranked *inbound* device page
            # (graph.py), so this edge is what puts the book's name on a section
            # six levels down instead of its immediate parent's.
            out += [k for k in self._descendants.get(pa, ())
                    if self._has_body(archive, k)]
        links = [self._PAGE + k for k in dict.fromkeys(out) if k != pid]
        anc = self._nearest_ancestor(archive, pa)
        if anc:
            links.append(self._PAGE + anc)
        # Replaces the HTML-derived links, which are all off-site and were
        # dropped as external anyway.
        doc.links = links
        # Only books are devices: chapters must not be context candidates, or
        # they win the label and we are back to "5: Lipids".
        doc.kind = KIND_DEVICE if is_book else KIND_ARTICLE
        return doc


ADAPTERS = (WikipediaAdapter, IFixitAdapter, LibreTextsAdapter)


def pick_adapter(meta: dict) -> GenericAdapter:
    for cls in ADAPTERS:
        if cls.matches(meta):
            return cls()
    return GenericAdapter()
