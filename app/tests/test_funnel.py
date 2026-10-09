"""Ingestion funnel proof: a markdown directory builds searchable film.

Hermetic on purpose -- no ZIM, no network, tiny corpus, seconds to run.
Exercises the whole funnel: MarkdownIngester -> build_stream (pass 1) ->
graph -> FTS -> Searcher reads (including the zlib body path).
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from codex import build as B
from codex.ingest import MarkdownIngester, pick_ingester
from codex.search import Searcher


def _corpus(root: Path) -> None:
    (root / "tea.md").write_text(
        "# Tea\n\nTea is a hot drink made from cured leaves steeped in water.\n\n"
        "## Brewing\n\nSteep the leaves for three minutes in fresh water. "
        "See [[kettle]] for heating water to the right temperature first.\n",
        encoding="utf-8")
    (root / "kettle.md").write_text(
        "# Kettle\n\nA kettle boils water for hot drinks like [[tea]] and "
        "coffee every morning.\n\n"
        "## Care\n\nDescale the kettle monthly with vinegar and clean water "
        "to keep it working well.\n",
        encoding="utf-8")
    (root / "notes" / "scones.md").parent.mkdir(parents=True, exist_ok=True)
    (root / "notes" / "scones.md").write_text(
        "# Scones\n\nScones are a baked good served warm with butter and jam, "
        "often alongside a pot of [[tea]] in the afternoon.\n\n"
        "## Baking\n\nBake the scones at high heat until golden brown on top.\n",
        encoding="utf-8")


class TestFunnel:
    def test_pick_ingester_routes_directories(self, tmp_path):
        assert pick_ingester(str(tmp_path)).name == "markdown"

    def test_markdown_corpus_builds_and_searches(self, tmp_path):
        src = tmp_path / "src"
        src.mkdir()
        _corpus(src)
        paths = B.plan_paths(str(tmp_path / "out"), "tea-test",
                             str(tmp_path / "scratch"))
        n = B.build_stream(
            paths, MarkdownIngester(), str(src),
            {"source_dir": "src", "title": "Tea test"}, no_deep=True)
        assert n == 3

        s = Searcher(str(paths.core))
        try:
            assert s.con.execute(
                "SELECT value FROM codex_meta WHERE key='body_codec'"
            ).fetchone()[0] == "zlib"
            hits = s.search("kettle boils water", limit=5)
            assert hits and hits[0]["title"] == "Kettle"
            # The zlib read path round-trips real sections.
            doc = s.get(hits[0]["id"])
            assert doc["sections"], "body did not survive the funnel"
            # [[tea]] resolved to a real edge, not a dangling string.
            assert s.con.execute("SELECT COUNT(*) FROM related").fetchone()[0] > 0
            # Browse serves the same titles in order.
            titles = [h["title"] for h in s.browse("T", limit=10)]
            assert "Tea" in titles
        finally:
            s.close()
