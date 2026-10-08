"""Remove references to images the codex no longer carries.

A codex is text-only, so "as shown in the first photo" points at nothing. About
16.5% of iFixit documents contain at least one such reference.

Blind deletion is the wrong tool. Three cases behave differently:

  1. The sentence is *only* a pointer  -> drop it.
       "See the image below."
  2. The reference is a subordinate or parenthetical clause -> excise the clause,
     keep the instruction, repair the punctuation.
       "Remove the screw (as shown in the second image)." -> "Remove the screw."
  3. The sentence carries an instruction that genuinely depended on the picture
     -> keep it verbatim and flag the document.
       "The third pic is up against the plastic stop pointed to by the bottom
        yellow arrow."

Case 3 is why this module flags rather than only deletes. That sentence still
tells a technician something real; rewriting it would invent detail we do not
have, and deleting it would lose detail we do. Flagging makes the loss visible
(`WHERE flags & 1`) instead of silent.
"""
from __future__ import annotations

import re

# An image noun must be present for any rule to fire. Matching bare verbs like
# "highlighted in" alone produces false positives -- "Additions are highlighted
# in a darker shade of green" is about iFixit's own UI, not a photo.
_IMG_NOUN = r"(?:image|images|photo|photos|photograph|pic|pics|picture|pictures|" \
            r"figure|figures|diagram|screenshot|thumbnail)"
_ORDINAL = r"(?:first|second|third|fourth|fifth|sixth|last|next|previous|above|" \
           r"below|left|right|top|bottom|these|this|the|following|preceding)"

# Clause forms that can be cut out with the sentence still standing.
_CLAUSE_PATTERNS = [
    # "(as shown in the second image)" / ", as seen in the photo,"
    rf"\s*[(\[]\s*(?:as\s+)?(?:shown|seen|pictured|depicted|illustrated|"
    rf"circled|highlighted|outlined|indicated|marked)\b[^)\]]*?{_IMG_NOUN}[^)\]]*[)\]]",
    rf",\s*(?:as\s+)?(?:shown|seen|pictured|depicted|illustrated)\s+"
    rf"(?:in|on)?\s*(?:{_ORDINAL}\s+)*{_IMG_NOUN}[a-z ]*?(?=[,.;:]|$)",
    rf"\s*[(\[]\s*(?:see|refer to)\s+(?:{_ORDINAL}\s+)*{_IMG_NOUN}[^)\]]*[)\]]",
    r"\s*\(pictured\)",
    rf"\s*[(\[][^)\]]*{_IMG_NOUN}\s+(?:above|below)[^)\]]*[)\]]",
    # Leading clause: "As shown in the photo, the multimeter will read OL."
    rf"^\s*(?:as\s+)?(?:shown|seen|pictured|depicted|illustrated)\s+"
    rf"(?:in|on)\s+(?:{_ORDINAL}\s+)*{_IMG_NOUN}s?\s*,\s*",
]
_CLAUSE_RX = [re.compile(p, re.I) for p in _CLAUSE_PATTERNS]

# A sentence made of nothing but a pointer. The pointer verb is REQUIRED: an
# earlier version matched any line merely *starting* with an image noun, which
# deleted spec fields wholesale ("Image Aspect Ratio: 3:2" -> gone).
_ONLY_REFERENCE = re.compile(
    rf"^\W*(?:please\s+)?(?:see|refer\s+to|view|check|compare|look\s+at)\s+"
    rf"(?:the\s+)?(?:{_ORDINAL}\s+)*{_IMG_NOUN}\b[^.!?]{{0,40}}$", re.I)
_ONLY_REFERENCE_2 = re.compile(
    rf"^\W*(?:as\s+)?(?:shown|seen|pictured|depicted|illustrated)\b[^.!?]{{0,40}}?"
    rf"{_IMG_NOUN}[^.!?]{{0,30}}$", re.I)
# A bare caption stub: "Image 2", "Photo 3.", "Figure 1"
_BARE_CAPTION = re.compile(rf"^\W*{_IMG_NOUN}\s*\d*\W*$", re.I)

# "Label: value" spec fields are data, not prose. iFixit device pages are full
# of them ("Image Resolution: 1920x1080") and they must survive untouched.
_SPEC_FIELD = re.compile(r"^\s*[A-Z][A-Za-z0-9 ()/.'-]{0,40}:\s*\S")

# Uses of image vocabulary that are not references to a picture at all.
_FALSE_POSITIVE = re.compile(
    r"\bfigure[sd]?\s+out\b"                    # "figure out how to..."
    r"|\b\w+-(?:perfect|ready|quality)\b"       # "picture-perfect"
    r"|\b(?:bootable|disk|iso|system|firmware|recovery|backup|drive|docker|"
    r"container|partition|rom|os)\s+images?\b"  # disk images, not photographs
    r"|\bimage\s+(?:file|resolution|sensor|quality|stabili[sz]|aspect|display|"
    r"processor|signal|format|size)\b",         # spec vocabulary
    re.I)

# Sentences that still carry instruction but lean on the picture to be complete.
# The trailing \b matters: without it "blue liner tab" matches "blue line".
_DEPENDENT = re.compile(
    rf"\b(?:{_IMG_NOUN}\b|"
    rf"(?:red|blue|green|yellow|orange|purple|white|black)\s+"
    rf"(?:box|boxes|outline|circle|arrow|arrows|highlight|rectangle|line|dot)\b)",
    re.I)

# Split on sentence boundaries without eating the delimiter or bullet newlines.
_SENT_SPLIT = re.compile(r"(?<=[.!?])\s+|\n")

_PUNCT_FIX = [
    (re.compile(r"\s+([,.;:!?])"), r"\1"),
    (re.compile(r"\(\s*\)"), ""),
    (re.compile(r"\[\s*\]"), ""),
    (re.compile(r",\s*\."), "."),
    (re.compile(r"\s{2,}"), " "),
    (re.compile(r"\.{2,}"), "."),
]


def _tidy(s: str) -> str:
    for rx, rep in _PUNCT_FIX:
        s = rx.sub(rep, s)
    return s.strip()


def clean_text(text: str) -> tuple[str, bool]:
    """Strip dangling image references.

    Returns (cleaned_text, image_dependent). The flag is True when a sentence
    was kept that still relies on an image to be fully understood.
    """
    if not text:
        return text, False
    # Cheap reject: most text has no image vocabulary at all.
    if not _DEPENDENT.search(text):
        return text, False

    if _FALSE_POSITIVE.search(text) and not _CLAUSE_RX[0].search(text):
        # Cheap path for text whose only image vocabulary is non-pictorial.
        if not any(rx.search(text) for rx in _CLAUSE_RX[1:]):
            stripped = _FALSE_POSITIVE.sub("", text)
            if not _DEPENDENT.search(stripped):
                return text, False

    dependent = False
    out_lines: list[str] = []

    for line in text.split("\n"):
        if not line.strip():
            out_lines.append(line)
            continue
        # Spec rows are structured data; never touch them.
        if _SPEC_FIELD.match(line):
            out_lines.append(line)
            continue

        kept: list[str] = []
        for sentence in _SENT_SPLIT.split(line):
            s = sentence.strip()
            if not s:
                continue

            # 0. image vocabulary used in a non-pictorial sense
            if _FALSE_POSITIVE.search(s):
                kept.append(s)
                continue

            # 1. pure pointer -> drop entirely
            if (_ONLY_REFERENCE.match(s) or _ONLY_REFERENCE_2.match(s)
                    or _BARE_CAPTION.match(s)):
                continue

            # 2. excise removable clauses
            before = s
            for rx in _CLAUSE_RX:
                s = rx.sub("", s)
            if s != before:
                s = _tidy(s)
                # If excision left only a fragment, drop it.
                if len(re.findall(r"[A-Za-z]{2,}", s)) < 2:
                    continue
                # Removing a leading clause ("As shown in the photo, the
                # multimeter...") leaves the sentence starting lower-case.
                if s and before[:1].isupper() and s[:1].islower():
                    s = s[0].upper() + s[1:]

            # 3. still references an image -> keep, but mark the document
            if _DEPENDENT.search(s):
                dependent = True

            kept.append(s)

        if kept:
            out_lines.append(" ".join(kept) if len(kept) > 1 else kept[0])

    cleaned = "\n".join(out_lines)
    # Collapse blank runs the removals may have opened up.
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned).strip()
    return cleaned, dependent


# ---------------------------------------------------------------------------
# Figure directives -- opt-in, for closed technical corpora only
# ---------------------------------------------------------------------------
#
# `clean_text` above is deliberately conservative because it runs over every
# corpus. This does not: it is called only by the military-medicine builder,
# where the vocabulary below is unambiguous.
#
# It must never be folded into `clean_text`. "fig", "plate", "chart" and "illus"
# are exactly the words that misfire on a general corpus -- plate tectonics, a
# chart of results, figs the fruit -- and `clean_text` is shared by 7.3M
# documents that would silently change meaning.
#
# Longest alternative first, with \b. Putting "fig" before "figure" turns
# "The square knot illustrated in figure 3 is the best..." into
# "The square knot ure 3 is the best..." -- measured, not hypothetical.
#
# "plate" and "chart" are deliberately absent. In these manuals they are
# overwhelmingly clinical, not pictorial -- "perpendicular plate of the ethmoid
# bone", "dentures, braces, or partial plates", "the Physiological Heat Exposure
# Limit (PHEL) chart". Measured on the first build: 112 of 1,700 flag hits came
# from those two words and not one was a picture reference.
_FIG = (r"(?:figures|figure|figs|fig|illustrations|illustration|illus|"
        r"photographs|photograph|photos|photo|pictures|picture|diagrams|"
        r"diagram)\b[.:]?")   # OCR turns "fig." into "fig:" often enough
# Figure numbers in these manuals take more shapes than a bare integer:
#   4-25   1-2   21   no. 4          plain
#   215D   3-31B                     panel letter attached to the number
#   A-1A   B-2                       appendix figures, letter first
#   3-31B and 3-31C   3-36C—E        ranges and pairs
# Missing any of these leaves the whole reference in place, which is how 178
# "(Figure ...)" pointers survived the first pass.
#   APP-I-3   B22                    multi-letter and unseparated appendix ids
#   7-6 OR 7-7   2-3A, 2-3B, and 2-3C   "or" and ", and" joiners
# (?-i:) matters: these patterns run case-insensitively, so a plain [0-9A-Z]
# also matches lowercase and the joiner below happily eats the word "and" as if
# it were a figure number -- which truncated "(figs. 2-3A, 2-3B, and 2-3C)"
# halfway and left the reference in the text.
_FIGPART = r"(?-i:[0-9A-Z])[0-9A-Za-z]*(?:[-–.][0-9A-Za-z]+)*"
_FIGNUM = (rf"(?:\s*(?:no\.?\s*)?{_FIGPART}"
           rf"(?:(?:\s*(?:,|and|or|to|through|thru|&|[-–—])\s*)+{_FIGPART})*)?")
_SHOWN = r"(?:shown|seen|illustrated|depicted|pictured|indicated)"

# A qualifier riding along inside the bracket: "(see figure 7-18, view A)",
# "(see Fig. 3, top)". Without this the whole reference survives.
_FIG_TAIL = r"(?:\s*,\s*(?:views?|panels?|insets?|details?|top|bottom|left|"
_FIG_TAIL += r"right|above|below)\b[^)\]]{0,16})?"

_FIG_CLAUSE = [
    # Leading clause FIRST: "As illustrated in figure 3, a turn is made ..."
    # If the trailing-clause rule below runs first it eats the same words and
    # leaves the sentence starting on a comma.
    re.compile(rf"^\s*(?:as\s+)?{_SHOWN}\s*(?:in|on)?\s*[(\[]?\s*"
               rf"{_FIG}{_FIGNUM}\s*[)\]]?\s*,\s*", re.I),
    # A whole bracket that is only a pointer: "(see figure 4-2)", "(fig. 21)",
    # "(see figure 7-18, view A)".
    re.compile(rf"\s*[(\[]\s*(?:also\s+)?(?:see|refer\s+to|as\s+shown\s+in|shown\s+in)?\s*"
               rf"{_FIG}{_FIGNUM}{_FIG_TAIL}\s*\.?\s*[)\]]", re.I),
    # A pointer riding *inside* a bracket that carries real content too:
    # "(the depression in the anterior region of the elbow, see figure 7-4)".
    # Strip the pointer, keep the bracket.
    re.compile(rf"\s*[,;]\s*(?:see|refer\s+to)\s+(?:the\s+)?{_FIG}{_FIGNUM}"
               rf"{_FIG_TAIL}(?=\s*[)\]])", re.I),
    # "... as illustrated in Figure 4-25"
    re.compile(rf",?\s*(?:as\s+)?{_SHOWN}\s+(?:in|on)\s+(?:the\s+)?"
               rf"{_FIG}{_FIGNUM}{_FIG_TAIL}", re.I),
    # A whole directive sitting mid-paragraph rather than at a sentence start:
    # "4-1. Kinds of Fractures See figure 4-1 for detailed illustration."
    # Reflowing joins a heading to the line under it, so this never reaches the
    # sentence-initial rule. The trailing "for ..." goes with it -- it describes
    # the picture, not the procedure.
    re.compile(rf"\s*(?:also\s+)?(?:see|refer\s+to)\s+(?:the\s+)?"
               rf"{_FIG}{_FIGNUM}{_FIG_TAIL}(?:\s+for\b[^.;]{{0,60}})?\s*\.?",
               re.I),
]
# A sentence that is entirely a parenthetical aside is a caption note, not an
# instruction. Excising a figure clause out of one leaves a broken fragment
# ("(Narrow sling is shown in illustration for clarity.)" -> "(Narrow sling is
# for clarity.)"), so drop the whole aside instead of repairing it.
_WHOLE_PAREN = re.compile(r"^\s*\([^()]*\)\s*\.?\s*$")
# A sentence that is nothing but a pointer: "See figure 4-3."
_FIG_ONLY = re.compile(
    rf"^\W*(?:please\s+)?(?:see|refer\s+to|note|view)\s+(?:the\s+)?"
    rf"{_FIG}{_FIGNUM}\s*\.?\W*$", re.I)
# A stranded caption: "Figure 21."
_FIG_CAPTION = re.compile(rf"^\W*{_FIG}{_FIGNUM}\s*\.?\W*$", re.I)
# A sentence whose whole job is to send you to a picture, even when it carries
# trailing words: "See figure 4-1 for detailed illustration.", "See figures 4-16
# and 4-18 for proper finger positioning." Dropping the trailing clause with it
# is right -- it describes what the picture shows, not what to do.
_FIG_DIRECTIVE = re.compile(
    rf"^\W*(?:please\s+)?(?:see|refer\s+to)\s+(?:the\s+)?{_FIG}", re.I)
# Excision can hollow out a parenthetical: "(Narrow sling is shown in
# illustration for clarity.)" -> "(Narrow sling is for clarity.)". Below this
# many words the remnant is not a sentence, so drop the whole bracket.
_THIN_PAREN = re.compile(r"\(([^()]*)\)")
_MIN_PAREN_WORDS = 3

# Split after terminal punctuation, keeping any closing quote with the sentence
# it belongs to, and only where a new sentence plausibly starts.
#
# The lookahead is load-bearing. "fig." is an abbreviation, so a naive split on
# "." tears "(see fig. 7-8)" into "(see fig." + "7-8)" -- after which neither
# half looks like a figure reference and the pointer survives into the corpus.
# Requiring a capital, quote or bracket next means a digit continuation like
# "7-8)" is not a sentence boundary.
#
# The negative lookbehinds are the other half of the same problem: "fig." ends
# in a period and is routinely followed by a capitalised appendix id, as in
# "(fig. APP-I-3)". Splitting there separates the noun from its number and the
# reference survives intact.
_FIG_SENT_SPLIT = re.compile(
    r"(?<!\bfig\.)(?<!\bFig\.)(?<!\bfigs\.)(?<!\bFigs\.)"
    r"(?<!\billus\.)(?<!\bno\.)(?<!\bNo\.)(?<!\bpp\.)"
    r"(?:(?<=[.!?][\"'”’)\]])|(?<=[.!?]))\s+(?=[A-Z\"“(\[])")


def _drop_thin_parens(s: str) -> str:
    return _THIN_PAREN.sub(
        lambda m: m.group(0) if len(m.group(1).split()) >= _MIN_PAREN_WORDS else "",
        s)


# Excising a pointer from inside a bracket leaves "... elbow )".
_FIG_SPACE_FIX = [
    (re.compile(r"\s+([)\]])"), r"\1"),
    (re.compile(r"([(\[])\s+"), r"\1"),
]

# `_SPEC_FIELD` above allows brackets in the label, which is right for iFixit
# but wrong here: "Taping a Sprained Ankle (fig: 78) Cut 14 strips" parses as a
# Label: value row and the whole line gets waved through untouched. A real spec
# label has no bracket in it.
_FIG_SPEC_FIELD = re.compile(r"^\s*[A-Z][A-Za-z0-9 /'-]{0,40}:\s*\S")


def strip_figure_directives(text: str) -> tuple[str, bool]:
    """Remove instructions to look at a picture the codex does not carry.

    Returns (cleaned_text, still_dependent). Same three tiers as `clean_text`:
    a sentence that is only a pointer is dropped, a pointer clause inside a real
    instruction is excised and the instruction kept, and anything still leaning
    on an image is kept verbatim and reported so the loss stays visible.

        "See figure 4-3."                                    -> dropped
        "Apply a cravat to immobilize a fractured jaw as
         illustrated in Figure 4-25."                        -> "Apply a cravat
                                                                to immobilize a
                                                                fractured jaw."

    Costs 0.3% of the military-medicine corpus (4,077 words of 1,626,719).
    """
    if not text:
        return text, False

    dependent = False
    out: list[str] = []
    for line in text.split("\n"):
        raw = line.strip()
        if not raw:
            continue
        # Structured "Label: value" rows are data; leave them alone.
        if _FIG_SPEC_FIELD.match(raw):
            out.append(raw)
            continue
        if (_FIG_CAPTION.match(raw) or _FIG_ONLY.match(raw)
                or _FIG_DIRECTIVE.match(raw)):
            continue

        kept: list[str] = []
        for sentence in _FIG_SENT_SPLIT.split(raw):
            s = sentence.strip()
            if not s:
                continue
            if (_FIG_ONLY.match(s) or _FIG_CAPTION.match(s)
                    or _FIG_DIRECTIVE.match(s)):
                continue
            before = s
            for rx in _FIG_CLAUSE:
                s = rx.sub(" ", s)
            if s != before:
                if _WHOLE_PAREN.match(before):
                    continue
                s = _drop_thin_parens(s)
                # Excision can strand the punctuation that joined the clause to
                # the rest of the sentence.
                s = re.sub(r"^\s*[,;:]\s*", "", s)
                for rx, rep in _FIG_SPACE_FIX:
                    s = rx.sub(rep, s)
                s = _tidy(s)
                if len(re.findall(r"[A-Za-z]{2,}", s)) < 2:
                    continue
                if s and before[:1].isupper() and s[:1].islower():
                    s = s[0].upper() + s[1:]
            if re.search(_FIG, s, re.I):
                dependent = True
            kept.append(s)

        if kept:
            out.append(" ".join(kept))

    return "\n".join(out).strip(), dependent


def clean_sections(sections) -> tuple[list, bool]:
    """Apply clean_text across a document's sections, dropping any left empty."""
    any_dependent = False
    out = []
    for sec in sections:
        if sec.kind == "table":
            out.append(sec)
            continue
        cleaned, dep = clean_text(sec.t)
        any_dependent = any_dependent or dep
        sec.t = cleaned
        # A step whose entire text was a photo pointer has nothing left to say,
        # but keep it if it still has a heading so step numbering stays intact.
        if cleaned or sec.h:
            out.append(sec)
    return out, any_dependent
