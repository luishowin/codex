"""Source-capture artefacts: replay shells, foreign hosts, URL-shaped titles.

Some of what looks like damage in a built codex is not the codex at all -- it
is the archive telling us what it is:

* **zimit / warc2zim captures** store a page under its replayed URL, so an
  entry path can be ``<40-hex>.site.tld/en-US/docs/.../runner.html?uuid=...``.
  The ``runner.html`` stub is a JS shell with 59 words on average; the real
  page may be elsewhere in the archive, or may not have been captured at all.
  A capture also follows links off-site: the MDN ZIM carries two Wikipedia
  pages, a FEMA page set and a GitHub avatar.

* **The archive name carries the origin host.** zimit names the file
  ``developer.mozilla.org_bc74bccb.zim``; the part before the last underscore
  is the site that was captured. That is the only reliable way to know which
  host is "home" -- the majority host by path is not it, because the capture
  origin (``mdnplay.dev``) is exactly the host that produced the shells.

These helpers are shared by the adapters (which drop the artefacts while
building) and ``tools/audit.py`` (which counts them before a rebuild), so the
number the audit promises is the number the build delivers.
"""
from __future__ import annotations

import re

# A title that is a URL, or a host/path like `developer.mozilla.org/...`.
URL_TITLE = re.compile(r"(://|^www\.)", re.I)
HOST_TITLE = re.compile(r"^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}/", re.I)
# zimit stores each captured page under "<40-hex>.site.tld/..."
CAPTURE_ID = re.compile(r"^[0-9a-f]{32,}", re.I)
HOST = re.compile(r"^[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)+$", re.I)

# A replay shell with more prose than this is a captured page, not a shell.
SHELL_WORDS = 80

_WS = re.compile(r"[^a-z0-9]+")

# Language names that appear in a site's language picker. Two or more at the
# very start of a text is a picker, not prose.
LANGS = (
    "English", "Español", "Français", "Deutsch", "Italiano", "Português",
    "Русский", "简体中文", "繁體中文", "日本語", "한국어", "العربية", "עברית",
    "Tiếng Việt", "Kreyòl", "Kreyòl Ayisyen", "Bahasa Indonesia", "Nederlands",
    "Polski", "Türkçe", "ไทย", "हिन्दी", "বাংলা", "Filipino", "Tagalog",
    "Afrikaans", "Swahili", "Kiswahili", "አማርኛ", "فارسی", "اردو",
)
_LANG_PICKER = re.compile(
    r"^\s*(?:(?:%s)\s*[\n\r\t ·|/,+&;\-]*\s*){2,}"
    % "|".join(map(re.escape, LANGS)), re.I)


def title_key(title: str) -> str:
    """Identity of a title for de-duplication.

    Case, punctuation and spacing only: "Tourniquet" and "Tourniquet" are the
    same page, but "Tourniquet (band)" is not.
    """
    return _WS.sub(" ", (title or "").lower()).strip()


def host_of(path: str) -> str:
    """The host of a captured URL, or '' when the path is not URL-shaped.

    Strict on purpose: a Wikipedia article path like ``1._Lig`` must not be
    mistaken for a host, or every plain-text roll reports phantom off-site
    documents. Only the whole first segment, and only if it is domain-shaped.
    """
    seg = (path or "").split("/", 1)[0].lower()
    if not HOST.match(seg) or not re.search(r"\.[a-z]{2,}$", seg):
        return ""
    return ".".join(seg.split(".")[-2:])


def origin_host(archive_name: str) -> str:
    """The site a zimit archive captured, from its own Name metadata.

    ``developer.mozilla.org_bc74bccb`` -> ``developer.mozilla.org``.
    Empty for names that are not a domain (``wikipedia_en_all_nopic_2026-06``),
    because those archives are not URL captures and have no hosts to filter.
    """
    head = (archive_name or "").rsplit("_", 1)[0].lower()
    if not HOST.match(head):
        return ""
    return head


def title_kind(title: str) -> str | None:
    """'url', 'host', 'capture-id', or None for a real name."""
    t = (title or "").strip()
    if not t:
        return None
    if CAPTURE_ID.match(t):
        return "capture-id"
    if URL_TITLE.search(t):
        return "url"
    if HOST_TITLE.match(t):
        return "host"
    return None


def looks_like_shell(path: str, words: int) -> bool:
    """A zimit replay stub: the runner path, and no prose of its own."""
    return "runner.html" in (path or "") and (words or 0) < SHELL_WORDS


def strip_language_switcher(text: str) -> str:
    """Remove a language picker from the start of a text.

    ready.gov opens 84% of its pages with "English / Español / 简体中文 / …"
    before the first real sentence. The guard is what makes this safe
    everywhere: it only fires on two or more language names at the very start,
    separated only by whitespace and list punctuation. A sentence that merely
    mentions languages ("English, French and German are spoken…") has prose
    between the names and does not match.
    """
    if not text:
        return text
    m = _LANG_PICKER.match(text)
    if not m:
        return text
    rest = text[m.end():].lstrip(" \n\r\t·|/,;:-—–")
    return rest or text


# Labels that are page chrome, never a summary. Matched as a whole line.
_LEAD_LABEL = re.compile(
    r"^(?:on this page|in this article|in this section|contents|"
    r"table of contents|jump to|skip to content)$", re.I)

# "Also called: RA" is an alias, not a description.
_LEAD_ALIAS = re.compile(r"^(?:also\s+(?:called|known\s+as)|see\s+also)\s*:", re.I)


def strip_lead_furniture(text: str, title: str = "") -> str:
    """Drop chrome lines that a page puts where its summary should be.

    MedlinePlus leads are 1,818 copies of "On this page" or "Also called: RA";
    a page that repeats its own title as its first line is doing the same thing.
    Only whole leading lines are removed, so a real sentence that happens to
    contain a label survives.
    """
    lines = (text or "").split("\n")
    while True:
        while lines and not lines[0].strip():
            lines.pop(0)
        if not lines:
            return ""
        head = lines[0].strip()
        if _LEAD_LABEL.match(head) or _LEAD_ALIAS.match(head):
            lines.pop(0)
            continue
        if title and head.casefold() == (title or "").strip().casefold():
            lines.pop(0)
            continue
        return "\n".join(lines).strip()


def looks_like_nav_block(text: str) -> bool:
    """A short list of labels where prose should be: a table of contents.

    MedlinePlus tutorial pages open every section with the same
    "Introduction / Break It Up / Word Roots / …" block; taken as a lead it
    says nothing and it repeats on all 20 pages of the tutorial. The guards are
    what make it safe: at least three lines, none of them a sentence, every
    line short, and the block under 40 words.
    """
    lines = [ln.strip() for ln in (text or "").split("\n") if ln.strip()]
    if len(lines) < 3:
        return False
    if sum(len(ln.split()) for ln in lines) > 40:
        return False
    for line in lines:
        if len(line) > 60 or re.search(r"[.!?]\s*$", line):
            return False
    return True
