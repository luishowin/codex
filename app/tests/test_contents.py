"""Contents: a codex that is a shelf of books is browsed as one.

The bug these pin: military-medicine is 22 manuals + 1,125 sections, every
section naming its manual in `context_id`. Browsing that alphabetically put
"APPENDIX 1..9" next to each other under A, fracturing ten books into one pile.
The film was always right; only the browse query flattened it.

Two invariants matter more than any list of titles:

* Children are returned in `id` order -- the order the source was read, which
  is page order for military-medicine. The appendices belong after chapter 9.
* Nothing walks *up*. libretexts and iFixit link containers in a loop
  (Fundamentals of Nursing -> Nursing -> Fundamentals), so a parent walk would
  never terminate. Expanding one level at a time cannot follow a loop.
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from codex.search import Searcher  # noqa: E402

DATA = Path(__file__).resolve().parent.parent.parent / "data"


def open_codex(name: str) -> Searcher:
    path = DATA / f"{name}.codex.db"
    if not path.is_file():
        pytest.skip(f"no {name} codex on disk")
    return Searcher(str(path))


@pytest.fixture(scope="module")
def milmed() -> Searcher:
    return open_codex("military-medicine")


@pytest.fixture(scope="module")
def flat() -> Searcher:
    return open_codex("ready-gov")


class TestMilitaryMedicine:
    def test_the_book_structure_is_read_from_the_film(self, milmed):
        st = milmed.structure()
        assert st["mode"] == "contents"
        assert len(st["roots"]) == 22
        assert st["sections"] == 1_125
        assert sum(r["children"] for r in st["roots"]) == st["sections"]

    def test_roots_carry_their_section_counts(self, milmed):
        roots = {r["title"]: r for r in milmed.structure()["roots"]}
        war = next(r for t, r in roots.items() if t.startswith("War Psychiatry"))
        derm = next(r for t, r in roots.items() if t.startswith("Military Dermatology"))
        assert war["children"] == 191
        assert derm["children"] == 176

    def test_letters_count_books_not_sections(self, milmed):
        page = milmed.contents("A")
        assert page["mode"] == "contents"
        assert page["letters"].get("A", 0) == 0      # no manual starts with A
        assert page["items"] == []
        b = milmed.contents("B")
        assert [i["title"] for i in b["items"]] == ["Bandaging and Splinting (FM 8-50)"]
        assert b["letter"] == "B"

    def test_without_a_letter_the_whole_shelf_is_returned(self, milmed):
        page = milmed.contents(None)
        assert page["letter"] == ""
        assert page["total"] == 22
        assert len(page["items"]) == 22          # all books on one page
        assert page["items"] == sorted(page["items"],
                                       key=lambda r: Searcher.sort_key(r["title"]))

    def test_children_stay_in_book_order(self, milmed):
        root = next(r for r in milmed.structure()["roots"]
                    if r["title"].startswith("Division and Brigade"))
        page = milmed.children(root["id"])
        assert page is not None and page["ordered"] == "id"
        ids = [i["id"] for i in page["items"]]
        assert ids == sorted(ids)
        assert len(page["items"]) == 40
        # The appendices (ids 940-950) sit after the chapters, not under A.
        at = [n for n, i in enumerate(page["items"], 1)
              if i["title"].upper().startswith("APPENDIX")]
        assert at and min(at) > 20
        assert all(i["children"] == 0 for i in page["items"])

    def test_unknown_root_is_not_an_error(self, milmed):
        assert milmed.children(10 ** 9) is None


class TestBookNavigation:
    """Reading a manual: where am I in the book, and what is next."""

    def test_a_section_knows_its_place(self, milmed):
        d = milmed.get(940)          # APPENDIX 1 in Division and Brigade
        assert d["context"].startswith("Division and Brigade")
        nav = d["nav"]
        assert nav["position"] == 25 and nav["total"] == 40
        assert nav["prev"]["id"] == 939
        assert nav["next"]["id"] == 941 and nav["next"]["title"] == "APPENDIX 2"

    def test_the_first_and_last_sections_have_one_neighbour(self, milmed):
        root = next(r for r in milmed.structure()["roots"]
                    if r["title"].startswith("Division and Brigade"))
        kids = milmed.children(root["id"])["items"]
        first = milmed.get(kids[0]["id"])["nav"]
        last = milmed.get(kids[-1]["id"])["nav"]
        assert first["prev"] is None and first["position"] == 1
        assert last["next"] is None and last["position"] == last["total"]

    def test_a_flat_document_has_no_book_navigation(self, flat):
        d = flat.get(1)
        assert d["nav"] is None and d["context_id"] is None


class TestFlatCodex:
    def test_no_anchors_means_no_contents(self, flat):
        assert flat.structure()["mode"] == "flat"
        page = flat.contents()
        assert page["mode"] == "flat"
        assert page["letters"] == {} and page["total"] == 0

    def test_children_of_a_flat_codex_is_none(self, flat):
        assert flat.children(1) is None


class TestCycles:
    def test_a_container_loop_is_never_followed_upward(self):
        """libretexts contains pairs of containers that are each other's context.

        The pair is found in the data rather than hard-coded: ids are reassigned
        by every rebuild, and a test that pins one would only test that one.
        """
        s = open_codex("libretexts-med")
        assert s.structure()["mode"] == "contents"
        pair = s.con.execute(
            "SELECT d.id, d.context_id FROM doc d JOIN doc p "
            "ON p.id = d.context_id WHERE p.context_id = d.id LIMIT 1").fetchone()
        assert pair, "the film no longer contains a container loop"
        a_id, b_id = pair
        a, b = s.children(a_id), s.children(b_id)
        assert a is not None and b is not None
        ids_a = {i["id"] for i in a["items"]}
        ids_b = {i["id"] for i in b["items"]}
        assert b_id in ids_a and a_id in ids_b      # the loop exists in the film
        assert a_id not in ids_a and b_id not in ids_b   # a node is not its own child
        # Both calls returned: the lookup is one level, never a walk.

    def test_nested_containers_report_their_own_depth(self):
        """A child that is itself a container gets a count, so the canvas can
        offer to open it -- without the server walking anywhere."""
        s = open_codex("libretexts-med")
        st = s.structure()
        assert st["sections"] > len(st["roots"])   # more sections than roots
        # 847 of the 869 containers have a parent: nested chapters exist.
        parent, child = s.con.execute(
            "SELECT context_id, id FROM doc "
            "WHERE kind=2 AND context_id IS NOT NULL LIMIT 1").fetchone()
        page = s.children(parent)
        row = next(i for i in page["items"] if i["id"] == child)
        assert row["children"] > 0, "nested container lost its own count"


class TestIfttt:
    def test_many_containers_still_page_by_letter(self):
        s = open_codex("ifixit")
        st = s.structure()
        assert st["mode"] == "contents"
        assert len(st["roots"]) > 1_500      # 1,573 after the 2026-11-20 rebuild
        page = s.contents("A", limit=10)
        assert len(page["items"]) == 10
        assert all(i["title"][:1].upper() == "A" for i in page["items"])
        # keyset paging across a page
        more = s.contents("A", after=page["items"][-1]["title"], limit=10)
        assert more["items"] and more["items"][0]["title"] > page["items"][-1]["title"]
