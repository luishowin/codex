"""Cross-codex fusion: specialisation, de-duplication, honesty of the counts.

These pin the two failures that were measured on the real shelf before the
merge existed, and the two rules that keep the fix from doing damage:

    javascript promise        4 Wikipedia articles, no MDN at n=8
    hurricane evacuation kit  Wikipedia + Wikiversity, no ready.gov

The fix is not a taste table. It asks each codex how many of its *own titles*
mention the query's terms; a codex where the query is pervasive is specialised
for it. Counts below MIN_TITLES are treated as coincidence, which is what stops
"2-20. Tourniquet" of a field manual outranking the encyclopaedia article.

The fixtures are the numbers measured on 2026-11-19, not invented ones.
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from codex import merge, paths  # noqa: E402


def page(codex: str, docs: int, titles: int, hits: list[tuple[str, float]],
         total: int | None = None, capped: bool = False) -> dict:
    return {
        "codex": codex, "docs": docs, "titles": titles,
        "total": len(hits) if total is None else total, "capped": capped,
        "hits": [{"id": i + 1, "title": t, "score": s, "snippet": "",
                  "tier": "quick"} for i, (t, s) in enumerate(hits)],
    }


def javascript_promise() -> list[dict]:
    return [
        page("wikipedia", 7_077_143, 500,
             [("Babel (transcompiler)", 14.89), ("Async/await", 12.4),
              ("River Trail (JavaScript engine)", 11.1)]),
        page("wikiversity", 49_886, 111,
             [("Applied Programming/Internet Data/JavaScript", 8.08)]),
        page("mdn", 1_231, 6, [("Using the Fetch API", 6.13)]),
        page("libretexts-med", 20_926, 0, [("11: Dietary Protein", 7.08)]),
    ]


class TestSpecialisation:
    def test_specialist_wins_its_home_turf(self):
        got = merge.merge(javascript_promise(), limit=8)
        assert got["hits"][0]["codex"] == "mdn", [h["codex"] for h in got["hits"]]
        assert got["weights"]["mdn"] == 4.0
        # Wikipedia is not penalised for being big, only for being diffuse here.
        assert got["weights"]["wikipedia"] < 1.05

    def test_a_single_title_is_not_evidence(self):
        """Tourniquet: every codex has one matching title. No opinion."""
        pages = [
            page("wikipedia", 7_077_143, 1, [("Tourniquet", 96.41)]),
            page("military-medicine", 1_147, 1,
                 [("2-20. Tourniquet (081-831-1017)", 5.30)]),
        ]
        got = merge.merge(pages, limit=5)
        assert got["weights"] == {"wikipedia": 1.0, "military-medicine": 1.0}
        assert got["hits"][0]["codex"] == "wikipedia"

    def test_relies_on_measured_counts(self):
        """ready-gov: 56 of 2,006 titles mention hurricane/evacuation/kit."""
        pages = [
            page("wikipedia", 7_077_143, 500, [("Hurricane Georges", 18.09)]),
            page("ready-gov", 2_006, 56,
                 [("Hurricane Season Preparedness Digital Toolkit", 9.06)]),
            page("medlineplus", 14_932, 5, [("Hurricanes", 11.14)]),
        ]
        got = merge.merge(pages, limit=8)
        assert got["hits"][0]["codex"] == "ready-gov"
        assert got["hits"][0]["score"] == 9.06 * 4.0

    def test_one_codex_ranks_itself(self):
        """An explicit &codex= query must behave exactly as before."""
        got = merge.merge([page("ifixit", 82_269, 500,
                                [("iPhone Battery Replacement FAQ", 27.55)])],
                          limit=4)
        assert got["weights"] == {"ifixit": 1.0}
        assert got["hits"][0]["score"] == 27.55

    def test_override_multiplies_the_derived_weight(self):
        pages = javascript_promise()
        base = merge.merge(pages, limit=8)["weights"]["wikipedia"]
        got = merge.merge(pages, limit=8,
                          overrides={"wikipedia": 1.5, "nope": 9.0})
        assert got["weights"]["wikipedia"] == pytest.approx(base * 1.5, abs=1e-4)
        assert "nope" not in got["weights"]


class TestDedupe:
    def test_within_one_codex_a_repeated_title_appears_once(self):
        """Measured: ready.gov served "Home Safety" seven times."""
        pages = [page("ready-gov", 2_006, 0,
                      [("Home Safety", 9.0)] * 7 + [("Build A Kit", 4.0)])]
        got = merge.merge(pages, limit=10)
        titles = [h["title"] for h in got["hits"]]
        assert titles.count("Home Safety") == 1
        assert "Build A Kit" in titles

    def test_two_codexes_on_one_title_are_kept_and_labelled(self):
        """A shared title from a second source is information, not noise."""
        pages = [
            page("medlineplus", 14_932, 5, [("Hurricanes", 11.14)]),
            page("ready-gov", 2_006, 56, [("Hurricanes", 9.06)]),
        ]
        got = merge.merge(pages, limit=5)
        assert len(got["hits"]) == 1
        hit = got["hits"][0]
        assert hit["codex"] == "ready-gov"          # weighted higher
        assert hit["also"] == [{"codex": "medlineplus", "id": 1}]

    def test_untitled_documents_do_not_collapse(self):
        pages = [page("x", 10, 0, [("", 1.0), ("", 2.0)])]
        assert len(merge.merge(pages, limit=5)["hits"]) == 2

    def test_title_key_normalises_only_style(self):
        assert merge.title_key("Tourniquet!") == merge.title_key(" tourniquet ")
        assert merge.title_key("Tourniquet (band)") != merge.title_key("Tourniquet")
        assert merge.title_key("") == ""


class TestPageShape:
    def test_limit_totals_and_caps_are_preserved(self):
        pages = javascript_promise()
        got = merge.merge(pages, limit=2)
        assert len(got["hits"]) == 2
        assert got["total"] == sum(p["total"] for p in pages)
        assert got["capped"] is False
        assert got["per_codex"] == {p["codex"]: p["total"] for p in pages}

    def test_empty_pages(self):
        got = merge.merge([page("a", 1, 0, []), page("b", 1, 0, [])], limit=5)
        assert got["hits"] == [] and got["weights"] == {"a": 1.0, "b": 1.0}


class TestWeightConfig:
    def test_weights_are_optional_and_parsed(self, tmp_path, monkeypatch):
        monkeypatch.setenv("CODEX_DATA_DIR", str(tmp_path))
        assert paths.source_weights() == {}
        (tmp_path / "shelf.json").write_text(
            '{"weights": {"mdn": 1.25, "bad": "nope", "zero": 0}}',
            encoding="utf-8")
        assert paths.source_weights() == {"mdn": 1.25}
