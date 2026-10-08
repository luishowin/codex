"""Alphabetical browse (A-Z strip) regression tests.

Browse is retrieval, not ranking: titles share the requested initial and come
back in title order, paged by keyset. Run against the default ifixit codex
(CODEX_DB overrides, mirroring test_search_quality.py).
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from codex.paths import data_dir
from codex.search import Searcher

CODEX = os.environ.get("CODEX_DB", str(data_dir() / "ifixit.codex.db"))


def _s() -> Searcher:
    return Searcher(CODEX)


class TestBrowse:
    def test_titles_share_initial_and_sort(self):
        hits = _s().browse("I", limit=50)
        assert hits, "expected I-titles in ifixit"
        titles = [h["title"] for h in hits]
        assert titles == sorted(titles)
        assert all(t[:1].upper() == "I" for t in titles)

    def test_limit_and_invalid_prefix(self):
        s = _s()
        assert len(s.browse("I", limit=5)) <= 5
        assert s.browse("?", limit=5) == []
        assert s.browse("", limit=5) == []

    def test_keyset_pages_forward(self):
        s = _s()
        p1 = s.browse("I", limit=10)
        assert len(p1) == 10
        p2 = s.browse("I", limit=10, after=p1[-1]["title"])
        assert p2, "expected a second page"
        assert all(h["title"] > p1[-1]["title"] for h in p2)

    def test_misc_bucket_holds_no_a_to_z(self):
        for h in _s().browse("#", limit=50):
            assert not ("A" <= h["title"][:1].upper() <= "Z")

    def test_hit_shape_fits_reader_rows(self):
        h = _s().browse("I", limit=1)[0]
        for k in ("id", "path", "title", "snippet", "context"):
            assert k in h
