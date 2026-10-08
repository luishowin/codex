"""Core data model shared by every extraction adapter."""
from __future__ import annotations

import re
from dataclasses import dataclass, field

# Document kinds. Stored as integers in doc.kind.
KIND_ARTICLE = 0
KIND_GUIDE = 1
KIND_DEVICE = 2
KIND_CATEGORY = 3

KIND_NAMES = {
    KIND_ARTICLE: "article",
    KIND_GUIDE: "guide",
    KIND_DEVICE: "device",
    KIND_CATEGORY: "category",
}

_WS = re.compile(r"[ \t ​]+")
_NL = re.compile(r"\n\s*\n\s*(\n\s*)+")
_EDGE = re.compile(r"^[ \t]+|[ \t]+$", re.MULTILINE)

# -- reflow -----------------------------------------------------------------

_NL_RUN = re.compile(r"\n+")
# Punctuation that belongs to the word before it: no space may be inserted.
# A dash counts only when it runs straight into the next word -- "photopigment
# \n-bearing" is a compound and must close up, but "energy\n- typically from"
# is a spaced dash and closing it up gives "energy- typically".
_ATTACH_NEXT = re.compile(r"^(?:[,.;:!?)\]}%'’]|[-‐-―](?!\s))")
# Characters after which a following word must not be pushed away either.
_ATTACH_PREV = re.compile(r"[(\[{'‘]$|[-‐-―](?<!\s.)$")
# A sentence genuinely ended / began here.
_SENTENCE_END = re.compile(r"[.!?:”\"')\]]$")
_STARTS_NEW = re.compile(r"^[A-Z0-9“\"']")
# A fragment that cannot be the start of a list item: it continues a sentence.
_CONTINUES = re.compile(r"^[a-z,.;:!?)\]}%'’-]")
# Below this share of continuing fragments the block is a list, not prose.
_MIN_CONTINUING = 0.25


def reflow(text: str) -> str:
    """Undo the newlines HTML extraction leaves inside sentences.

    Selectolax applies its separator at *every* element boundary, inline ones
    included, so `The <a>iPhone 6</a> and <a>iPhone 6 Plus</a> are ...` is
    stored as "The\\niPhone 6\\nand\\niPhone 6 Plus\\nare". Every Wikipedia lead
    in the corpus carries these; measured across 400 documents there are 32,279
    of them against 5,192 genuine breaks.

    Newline *count* cannot separate the two -- extraction emits mid-sentence
    double newlines as well ("autotrophic\\n\\norganisms"). Sentence shape can:
    a break is real only where the text before it ends a sentence and the text
    after it starts one. Everything else is rejoined, inserting no space where
    the next fragment opens with punctuation ("photopigment\\n-bearing" must not
    become "photopigment -bearing").

    Applied at read time rather than at extraction, so it repairs the corpora
    already built without a rebuild.

    Only prose is touched. A tool list, a spec sheet and a see-also list are all
    newline-separated too, and merging those destroys exactly the field
    boundaries worth keeping -- "CPU: AMD A10 / Max Turbo Speed: 3.3 GHz /
    Cache: 2 MB" must not become one run-on line. Prose is told apart by how its
    fragments begin: shredding a sentence at its inline tags leaves many
    fragments starting mid-clause, while list items nearly all start with a
    capital. Measured over ~1,500 sections of each corpus, the fraction of
    fragments starting lowercase or with attaching punctuation:

        iFixit      median 0.00,  82% have none   (lists, specs, tool lists)
        Wikipedia   median 0.40,  11% have none   (prose, and its own lists)

    so a section below the threshold is left exactly as stored.
    """
    if not text or "\n" not in text:
        return text
    parts = [p for p in (p.strip() for p in _NL_RUN.split(text)) if p]
    if len(parts) < 2:
        return parts[0] if parts else ""
    continues = sum(1 for p in parts if _CONTINUES.match(p))
    if continues / len(parts) < _MIN_CONTINUING:
        return text
    out = parts[0]
    for nxt in parts[1:]:
        if _SENTENCE_END.search(out) and _STARTS_NEW.match(nxt):
            out += "\n\n" + nxt
        elif _ATTACH_NEXT.match(nxt) or _ATTACH_PREV.search(out):
            out += nxt
        else:
            out += " " + nxt
    return out


def norm(text: str) -> str:
    """Collapse the whitespace explosion that comes out of HTML text extraction.

    Selectolax emits a separator per element boundary, so a deeply nested page
    yields runs of dozens of newlines. Collapse horizontal runs to one space and
    vertical runs to at most one blank line.
    """
    if not text:
        return ""
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = _WS.sub(" ", text)
    text = _EDGE.sub("", text)
    text = _NL.sub("\n\n", text)
    return text.strip()


@dataclass(slots=True)
class Section:
    """One heading-delimited chunk of a document.

    Most sections are prose. A table section keeps its rows intact instead:
    flattening a table to text destroys every cell boundary, which is exactly
    the structure that makes it worth reading -- for a person and for a model.
    """

    h: str = ""            # heading text ("" for the lead / preamble)
    t: str = ""            # body text, already whitespace-normalised
    kind: str = "text"     # "text" | "table"
    headers: list[str] = field(default_factory=list)
    rows: list[list[str]] = field(default_factory=list)

    def as_json(self) -> dict:
        if self.kind == "table":
            return {"k": "table", "h": self.h,
                    "headers": self.headers, "rows": self.rows}
        return {"h": self.h, "t": self.t}

    @property
    def search_text(self) -> str:
        """Flat text for the FTS index and word counting."""
        if self.kind != "table":
            return self.t
        parts = [" ".join(self.headers)] if self.headers else []
        parts.extend(" ".join(r) for r in self.rows)
        return "\n".join(parts)


@dataclass(slots=True)
class Doc:
    """A single extracted document, before compression and indexing."""

    path: str
    title: str
    kind: int = KIND_ARTICLE
    lead: str = ""
    sections: list[Section] = field(default_factory=list)
    links: list[str] = field(default_factory=list)  # raw outbound ZIM paths
    meta: dict = field(default_factory=dict)  # adapter-specific extras
    flags: int = 0  # see FLAG_* in schema.py

    @property
    def text(self) -> str:
        """Full plain text, used for the deep FTS index and for word counting."""
        parts = []
        if self.lead:
            parts.append(self.lead)
        for s in self.sections:
            if s.h:
                parts.append(s.h)
            body = s.search_text
            if body:
                parts.append(body)
        return "\n\n".join(parts)

    @property
    def word_count(self) -> int:
        return self.text.count(" ") + 1 if self.text else 0
