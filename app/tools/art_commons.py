"""Wikimedia client and licence policy for the image layer. Build-time only.

Never imported by the daemon. `codex/art.py` is the read side and pulls in no
networking at all, which keeps the "no network call at query time" rule a
property of the import graph rather than a promise.

Two measured facts shape this module:

**Wikimedia rate-limits, and it is not gentle.** Four rapid fetches from
`upload.wikimedia.org` returned `HTTP 429 Too many requests`. Every request here
goes through `polite_get`, which serialises them behind a minimum interval and
honours `Retry-After`. Do not add concurrency; the budget is ~100 images and a
serial run costs about three minutes.

**Never construct a thumbnail URL.** Guessing a width returns
`HTTP 400: Use thumbnail sizes listed on ...`. Ask the API for `iiurlwidth` and
use the `thumburl` it hands back. That also means downloading ~300 KB instead of
the 8.3 MB original, which is the difference between a three-minute run and an
hour of it.
"""
from __future__ import annotations

import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

from selectolax.lexbor import LexborHTMLParser

# MediaWiki asks for a User-Agent that identifies the tool and offers a way to
# get in touch, and throttles generic ones harder. Running without a contact is
# a deliberate choice here -- no personal address in anyone's server logs -- and
# the cost is paid in rate rather than in failures: the adaptive interval below
# settles around 5-7 s/request instead of 2 s. Set CODEX_CONTACT to an address
# or URL to trade that back.
_CONTACT = os.environ.get("CODEX_CONTACT", "").strip()
USER_AGENT = ("codex-art/0.1 (offline reference corpus build"
              + (f"; {_CONTACT}" if _CONTACT else "") + ") python-urllib")

# The API accepts 50 titles per query for anonymous callers.
BATCH = 50

# Measured the hard way. A 1.0 s baseline drew `Retry-After: 1`, then a sustained
# `Retry-After: 10`, then a flat `Retry-After: 600` after 35 images -- because
# retrying a 429 at the *same* baseline rate is what escalates it. The interval
# below is the starting point; every 429 widens it for the rest of the run.
MIN_INTERVAL = 2.0
MAX_INTERVAL = 15.0
MAX_RETRIES = 4
# A Retry-After beyond this is not congestion, it is a cooldown. Sitting through
# it would idle for tens of minutes; stopping is better because the download
# cache makes resuming free.
BLOCKED_AFTER = 180.0

_last_request = 0.0
_interval = MIN_INTERVAL


class FetchError(RuntimeError):
    pass


class RateLimited(RuntimeError):
    """Wikimedia has asked us to go away for a while. Stop, do not grind."""


def current_interval() -> float:
    return _interval


def polite_get(url: str, timeout: int = 30) -> bytes:
    """One serialised request. Honours Retry-After and slows the whole run."""
    global _last_request, _interval
    delay = 2.0
    for attempt in range(MAX_RETRIES + 1):
        wait = _interval - (time.time() - _last_request)
        if wait > 0:
            time.sleep(wait)
        _last_request = time.time()
        try:
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read()
        except urllib.error.HTTPError as exc:
            if exc.code not in (429, 500, 502, 503, 504) or attempt == MAX_RETRIES:
                raise FetchError(f"HTTP {exc.code} for {url[:120]}") from exc
            retry_after = exc.headers.get("Retry-After") if exc.headers else None
            try:
                pause = float(retry_after) if retry_after else delay
            except ValueError:
                pause = delay
            if exc.code == 429:
                if pause > BLOCKED_AFTER:
                    raise RateLimited(
                        f"Retry-After {pause:.0f}s -- rate limited. Rerun later; "
                        f"cached downloads are kept.") from exc
                # The important line: back off globally, not just this request.
                _interval = min(_interval * 1.5, MAX_INTERVAL)
                print(f"    .. 429, pausing {pause:.0f}s and easing the rate to "
                      f"{_interval:.1f}s/request", file=sys.stderr, flush=True)
            time.sleep(min(pause, BLOCKED_AFTER))
            delay = min(delay * 2, 60.0)
        except (urllib.error.URLError, TimeoutError) as exc:
            if attempt == MAX_RETRIES:
                raise FetchError(f"{type(exc).__name__} for {url[:120]}") from exc
            time.sleep(delay)
            delay = min(delay * 2, 60.0)
    raise FetchError(f"gave up on {url[:120]}")


def api(host: str, params: dict[str, str]) -> dict:
    p = dict(params)
    p.setdefault("action", "query")
    p.setdefault("format", "json")
    # formatversion 2 returns `pages` as a list and omits the pageid keying;
    # version 1 hands back a dict and every lookup below silently misses.
    p.setdefault("formatversion", "2")
    url = f"https://{host}/w/api.php?" + urllib.parse.urlencode(p)
    return json.loads(polite_get(url).decode("utf-8", "replace"))


def _alias_map(query: dict) -> dict[str, str]:
    """Fold the API's `normalized` and `redirects` hops into one from->to map."""
    out: dict[str, str] = {}
    for key in ("normalized", "redirects"):
        for hop in query.get(key, []) or []:
            out[hop["from"]] = hop["to"]
    return out


def _follow(title: str, aliases: dict[str, str]) -> str:
    seen = set()
    while title in aliases and title not in seen:
        seen.add(title)
        title = aliases[title]
    return title


def _batched(items: list[str]):
    for i in range(0, len(items), BATCH):
        yield items[i:i + BATCH]


def lead_images(titles: list[str], host: str = "en.wikipedia.org"
                ) -> dict[str, dict]:
    """Article title -> its lead image, keyed by the title as passed in.

    The lead image is what this whole approach rests on: Wikipedia editors have
    already picked the one picture that best represents the subject, so relevance
    needs no search heuristic and no judgement call from us.
    """
    out: dict[str, dict] = {}
    for chunk in _batched(titles):
        d = api(host, {"prop": "pageimages", "piprop": "original|name",
                       "redirects": "1", "titles": "|".join(chunk)})
        q = d.get("query", {})
        aliases = _alias_map(q)
        by_title = {p["title"]: p for p in q.get("pages", []) or []
                    if isinstance(p, dict)}
        for asked in chunk:
            page = by_title.get(_follow(asked, aliases))
            if page is None or "missing" in page:
                out[asked] = {"error": "no such article"}
                continue
            name = page.get("pageimage")
            if not name:
                out[asked] = {"error": "article has no lead image"}
                continue
            orig = page.get("original") or {}
            out[asked] = {"article": page["title"], "file": "File:" + name,
                          "orig_width": orig.get("width"),
                          "orig_height": orig.get("height")}
    return out


# `prop=images` returns everything embedded in a page, which includes interface
# chrome and, less obviously, video and audio. Matched against the filename with
# underscores folded to spaces -- the first version of this regex used
# underscores only and let `OOjs UI icon edit-ltr-progressive.svg` through as the
# hero image for Vibrio cholerae.
_FURNITURE = re.compile(
    r"(commons|wikisource|wiktionary|wikiquote|wikibooks|wikispecies|wikidata"
    r"|wikinews|wikiversity)[ -]logo"
    r"|\b(oojs ui|ui icon|icon|logo|ambox|portal|disambig|padlock|nuvola"
    r"|crystal|gnome|emblem|magnify.clip|question book|edit.clear|text document"
    r"|wiki letter|loudspeaker|speakerlink|blue pencil|star full|yes check"
    r"|x mark|red pog|increase|decrease|steady|split.arrows|translation to"
    r"|office.book|symbol [a-z]+ class|folder)\b", re.I)

# Only still images. `prop=images` happily returns .webm and .ogv, and two of
# them were selected as hero images before this existed (Backwashing demo at a
# water filtration plant.webm for water-purification).
IMAGE_MIMES = ("image/jpeg", "image/png", "image/svg+xml", "image/webp",
               "image/gif", "image/tiff")

_TOKEN = re.compile(r"[a-z0-9]+")
# Function words only. `human` was in this list and it cost real quality: with
# it stopped out, `human skull` scored only on `skull` and the best-ranked
# candidate became `African elephant skull`.
_STOPWORDS = frozenset(("the", "a", "an", "of", "and", "in", "on", "for"))

# A statistics plot is topical but it is not a picture of the subject. Demoted,
# not rejected -- some of the best images on the list are diagrams
# (`Recovery position.svg`), and the distinction is in the words, not the format.
_CHARTISH = re.compile(
    r"\b(chart|graph|statistics|statistical|data|index|objective|timeline"
    r"|worldwide|codes|distribution|per capita|by country|rate[sd]?|trends?"
    r"|percentage|histogram|plot)\b", re.I)


def name_overlap(filename: str, phrases: list[str]) -> int:
    """How many distinct subject words appear in a candidate's filename.

    Used to *order* substitution candidates, never to reject them outright.
    Rejecting on a name match loses good pictures -- `Common-foxglove.jpg` is
    exactly the right image for Digitalis and shares no word with it -- so the
    aliases in art_subjects feed this too, and a zero score is a flag for review
    rather than a veto.
    """
    have = set(_TOKEN.findall(filename.lower()))
    want: set[str] = set()
    for p in phrases:
        want |= {t for t in _TOKEN.findall(p.lower())
                 if len(t) > 2 and t not in _STOPWORDS}
    return len(have & want)


def looks_like_a_chart(filename: str) -> bool:
    return bool(_CHARTISH.search(filename.replace("_", " ")))


def article_images(titles: list[str], limit: int = 14,
                   host: str = "en.wikipedia.org") -> dict[str, list[str]]:
    """Article title -> its other images, in page order, chrome removed.

    The fallback for when an article's lead image is too small to use. Measured
    on the curated list, 29 of 100 lead images came back under 1.2 MP -- some at
    0.05 MP -- because MediaWiki will not upscale past the original. Page order
    is kept rather than sorting by size: position in the article approximates
    editorial importance, and the largest image on a page is often a map or a
    chart rather than the subject.

    One title per request, deliberately. `imlimit` is applied across the whole
    batch rather than per page, so asking for 50 articles at once returned about
    three images each and the fallback found almost nothing. Following the
    continuation token would restore the batching, at the cost of more code than
    the ~30 extra requests this costs.
    """
    out: dict[str, list[str]] = {}
    for asked in titles:
        d = api(host, {"prop": "images", "imlimit": "60", "redirects": "1",
                       "titles": asked})
        q = d.get("query", {})
        aliases = _alias_map(q)
        by_title = {p["title"]: p for p in q.get("pages", []) or []
                    if isinstance(p, dict)}
        page = by_title.get(_follow(asked, aliases)) or {}
        names = [im["title"] for im in page.get("images", []) or []
                 if not _FURNITURE.search(im["title"].replace("_", " "))]
        out[asked] = names[:limit]
    return out


def image_info(files: list[str], width: int, host: str = "en.wikipedia.org"
               ) -> dict[str, dict]:
    """File title -> size, licence, credit and a *valid* scaled thumb URL.

    Queried against en.wikipedia rather than Commons: the shared-repo lookup
    resolves Commons-hosted and locally-hosted files through one endpoint, so a
    file that never made it to Commons still returns metadata instead of
    `missing`.
    """
    out: dict[str, dict] = {}
    for chunk in _batched(files):
        d = api(host, {"prop": "imageinfo",
                       "iiprop": "url|size|mime|extmetadata",
                       "iiurlwidth": str(width), "titles": "|".join(chunk)})
        q = d.get("query", {})
        aliases = _alias_map(q)
        by_title = {p["title"]: p for p in q.get("pages", []) or []
                    if isinstance(p, dict)}
        for asked in chunk:
            page = by_title.get(_follow(asked, aliases))
            # A Commons-hosted file comes back `"missing": true` with
            # `"imagerepository": "shared"` and a complete imageinfo block --
            # "missing" means "not local to en.wikipedia", not "does not exist".
            # Testing `missing` here rejects almost every file on the list.
            if page is None or not page.get("imageinfo"):
                out[asked] = {"error": "no image info"}
                continue
            ii = page["imageinfo"][0]
            em = ii.get("extmetadata") or {}

            def field(key: str) -> str:
                return str((em.get(key) or {}).get("value", "")).strip()

            out[asked] = {
                "orig_width": ii.get("width"),
                "orig_height": ii.get("height"),
                "orig_bytes": ii.get("size"),
                "mime": ii.get("mime", ""),
                "thumb_url": ii.get("thumburl"),
                "thumb_width": ii.get("thumbwidth"),
                "thumb_height": ii.get("thumbheight"),
                "source_url": ii.get("descriptionurl", ""),
                "artist": strip_markup(field("Artist")),
                "credit": strip_markup(field("Credit")),
                "description": strip_markup(field("ImageDescription"))[:400],
                "licence": field("LicenseShortName"),
                "licence_code": field("License").lower(),
                "licence_url": field("LicenseUrl"),
                "usage_terms": field("UsageTerms"),
                "restrictions": field("Restrictions"),
                "non_free": field("NonFree"),
            }
    return out


# --- licence policy --------------------------------------------------------

# Allowlist by the machine-readable `License` code, falling back to the short
# name. Deliberately narrow: everything here permits redistribution provided
# attribution is carried, which is why `artist` and `licence` are NOT NULL-ish
# columns in art.db and why the reader renders a credit line rather than
# treating it as optional decoration.
_ALLOWED = re.compile(
    r"""^(
          cc0                     |
          cc-by(-sa)?-\d          |
          cc-by(-sa)?$            |
          pd(-.*)?$               |
          public[ -]domain        |
          copyrighted[ -]free[ -]use
        )""", re.X)

# Bare "copyright" is deliberately not here. It matched Commons' "Copyrighted
# free use" template, which is a free licence, and dropped a usable image.
_DENIED = re.compile(r"non[- ]free|fair[ -]use|all rights reserved|"
                     r"with permission|noncommercial|non-commercial", re.I)


def licence_ok(info: dict) -> tuple[bool, str]:
    """(accepted, reason). Reason is recorded either way, so drops are auditable."""
    if (info.get("non_free") or "").strip().lower() in ("true", "1", "yes"):
        return False, "flagged NonFree"
    code = (info.get("licence_code") or "").strip().lower()
    short = (info.get("licence") or "").strip()
    terms = info.get("usage_terms") or ""
    if _DENIED.search(short) or _DENIED.search(terms):
        return False, f"denied licence {short or code or '?'!r}"
    for candidate in (code, short.lower().replace(" ", "-")):
        if candidate and _ALLOWED.match(candidate):
            return True, short or code
    if short.lower().startswith("public domain") or code.startswith("pd"):
        return True, short or code
    return False, f"unrecognised licence {short or code or '(none)'!r}"


def strip_markup(html: str) -> str:
    """The API returns `Artist` and `Credit` as HTML, not text.

    Measured: `<a href="//commons.wikimedia.org/wiki/User:RCraig09" ...>`. The
    credit line is rendered into the reader, so this has to be text -- injecting
    upstream markup into the page would be both a rendering bug and an XSS hole.
    """
    if not html:
        return ""
    if "<" in html:
        html = LexborHTMLParser(html).text(separator=" ")
    return re.sub(r"\s+", " ", html).strip()
