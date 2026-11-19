"""Cross-codex fusion for /api/search.

`scores from different corpora are not comparable` is the whole problem here.
Each Searcher ranks *within* one codex, where importance (PageRank of that
codex's own link graph) is meaningful. Comparing those numbers across codexes
compares two different graphs, and the bigger graph wins: on "javascript
promise" the full Wikipedia roll returned four articles before MDN's "Using the
Fetch API", and with n=8 MDN did not appear at all.

The fix is not a hand-tuned weight per source. It is the signal a person uses
when they say "that is the right source for this": **specialisation**. Ask each
codex how many of its own titles mention the query's terms. A codex where the
query is *pervasive* (MDN: 6 of 1,231 titles contain "javascript" or
"promise") is more specialised for it than one where it is a rounding error
(Wikipedia: 500 of 7,077,143). The ratio is scale-free, so it needs no absolute
threshold and no per-corpus table -- and it is measured per query, not baked in.

Deliberately absent: a per-codex slot cap. Weights already stop the catch-all
filling the page, and a cap would cut a source that genuinely is the right one
(MedlinePlus on "diabetes").
"""
from __future__ import annotations

from .artifacts import title_key

# A codex needs at least this many matching titles before the signal counts.
# Below it, "1 of 1,147" is coincidence, not specialisation -- it is what would
# otherwise put "2-20. Tourniquet" of a field manual above the encyclopaedia
# article on the same word.
MIN_TITLES = 3

# Multiplier given to the most specialised source in the result set. The
# weakest participants stay at 1.0, so the spread is [1, 1 + SPEC_BOOST].
SPEC_BOOST = 3.0


def weights(pages: list[dict], overrides: dict[str, float] | None = None
            ) -> dict[str, float]:
    """How much to trust each codex for *this* query.

    ``pages`` are the per-codex results: ``{codex, docs, titles, hits}``.
    Codexes with too few matching titles stay at 1.0 rather than being
    penalised -- silence is not evidence.

    ``overrides`` (``data/shelf.json`` -> ``weights``) multiply the derived
    weight, which is the only place a human opinion enters. They default to
    empty; a non-positive or non-finite value is dropped upstream, because a
    typo must not silently erase a whole source from the page.
    """
    overrides = overrides or {}
    if len(pages) < 2:
        # Nothing to compare against: a single codex ranks itself, exactly as
        # it did before there was a merge.
        return {p["codex"]: round(overrides.get(p["codex"], 1.0), 4)
                for p in pages}
    ev = {p["codex"]: (p["titles"] / p["docs"])
          for p in pages
          if p.get("docs") and p.get("titles", 0) >= MIN_TITLES}
    top = max(ev.values()) if ev else 0.0
    out = {}
    for p in pages:
        name = p["codex"]
        share = ev.get(name, 0.0)
        base = 1.0 + SPEC_BOOST * (share / top) if top > 0 else 1.0
        out[name] = round(base * overrides.get(name, 1.0), 4)
    return out


def merge(pages: list[dict], limit: int,
          overrides: dict[str, float] | None = None) -> dict:
    """Fuse per-codex pages into one ranked page.

    Returns ``{hits, total, capped, per_codex, weights}``. Hits are the codex
    payloads with ``codex`` set and ``score`` multiplied by that codex's
    weight; a title seen twice is returned once, with ``also`` naming the
    codexes that agreed on it.
    """
    w = weights(pages, overrides)
    rows = []
    for p in pages:
        name = p["codex"]
        for h in p["hits"]:
            h = dict(h)
            h["codex"] = name
            h["score"] = h["score"] * w.get(name, 1.0)
            rows.append(h)

    rows.sort(key=lambda h: -h["score"])

    out: list[dict] = []
    seen: dict[str, dict] = {}
    for h in rows:
        key = title_key(h.get("title", ""))
        if not key:
            # An untitled document is not evidence that another untitled one is
            # the same page: let it through unmerged.
            out.append(h)
            if len(out) >= limit:
                break
            continue
        first = seen.get(key)
        if first is None:
            seen[key] = h
            out.append(h)
            if len(out) >= limit:
                break
            continue
        if first["codex"] != h["codex"]:
            # Same page served by two codexes: keep the stronger, say who else
            # had it. Dropping it silently would lose a real second source.
            first.setdefault("also", []).append(
                {"codex": h["codex"], "id": h["id"]})
        # Within one codex a repeated title is its own duplicate: drop it.

    return {
        "hits": out,
        "total": sum(p.get("total", 0) for p in pages),
        "capped": any(p.get("capped") for p in pages),
        "per_codex": {p["codex"]: p.get("total", 0) for p in pages},
        "weights": w,
    }
