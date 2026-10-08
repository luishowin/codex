"""Search quality and latency regression suite.

Ranking changes are easy to make and hard to evaluate by eye, so the expected
top hits are pinned here. Run this after touching anything in codex/search.py
or the ranking blend.

    pytest tests/ -v
"""
from __future__ import annotations

import json
import os
import re
import sys
import time
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from codex.model import reflow
from codex.paths import data_dir
from codex.search import Searcher, escape_query

CODEX = os.environ.get("CODEX_DB", str(data_dir() / "ifixit.codex.db"))

# (query, one of these substrings must appear in the top N titles, N)
EXPECTED = [
    ("iphone battery replacement", ("iphone", "battery"), 3),
    ("macbook pro screen", ("macbook", "screen", "display"), 5),
    ("pentalobe", ("pentalobe", "screwdriver", "driver"), 5),
    ("thermal paste", ("thermal", "paste"), 5),
    ("nintendo switch joycon drift", ("switch", "joy", "joycon"), 5),
    ("samsung galaxy screen replacement", ("samsung", "galaxy", "screen"), 5),
    ("ipad air battery", ("ipad", "battery"), 5),
    ("dyson vacuum", ("dyson", "vacuum"), 5),
    ("playstation 4 hard drive", ("playstation", "ps4", "hard drive"), 5),
    ("spudger", ("spudger",), 5),
]


@pytest.fixture(scope="module")
def searcher():
    if not Path(CODEX).exists():
        pytest.skip(f"codex not built: {CODEX}")
    s = Searcher(CODEX)
    yield s
    s.close()


class TestQueryEscaping:
    def test_only_last_term_is_a_prefix(self):
        # Prefixing every term makes `"a"*` expand to the whole "a" vocabulary,
        # which cost 16.9s on a five-word query against the Wikipedia codex.
        assert escape_query("iphone battery") == '"iphone" "battery"*'

    def test_single_term_still_prefixes(self):
        # The hotkey launcher sends one word and expects autocomplete.
        assert escape_query("iphone") == '"iphone"*'

    def test_or_mode_also_prefixes_only_last(self):
        assert escape_query("iphone battery", "OR") == '"iphone" OR "battery"*'

    def test_strips_fts5_syntax(self):
        # A user typing quotes or operators means them literally.
        out = escape_query('iphone "battery" -screen')
        assert '"' in out and "-" not in out.replace('"', "")

    def test_empty(self):
        assert escape_query("") == ""
        assert escape_query("   ***  ") == ""

    def test_no_injection(self):
        # Must not raise: FTS5 syntax errors would surface as exceptions.
        assert escape_query("a OR b NEAR(c)") != ""

    def test_short_last_term_is_not_a_prefix(self):
        # `"ba"*` matches 1,924,470 documents and takes 1.9s; `"b"*` matches
        # 5,693,928 and takes 9.4s. Both arrive on the way to typing a real
        # word, which is what made the search box appear dead.
        assert escape_query("ba") == '"ba"'
        assert escape_query("b") == '"b"'
        assert escape_query("iphone ba") == '"iphone" "ba"'

    def test_prefix_resumes_at_min_length(self):
        assert escape_query("bat") == '"bat"*'


class TestReflow:
    """HTML extraction leaves a newline at every inline element boundary."""

    def test_inline_links_are_rejoined(self):
        assert reflow("The\niPhone 6\nand\niPhone 6 Plus\nare\nsmartphones") == \
            "The iPhone 6 and iPhone 6 Plus are smartphones"

    def test_punctuation_does_not_gain_a_space(self):
        assert reflow("by\nApple\n. They are") == "by Apple. They are"
        assert reflow("organisms\n, such as") == "organisms, such as"

    def test_compound_hyphen_closes_up(self):
        assert reflow("photopigment\n-bearing\nplants") == "photopigment-bearing plants"

    def test_spaced_dash_keeps_its_space(self):
        # The same character as the compound hyphen, used as punctuation. Told
        # apart by whether a space follows it.
        assert reflow("light energy\n— typically from\nsunlight") == \
            "light energy — typically from sunlight"

    def test_real_paragraph_break_survives(self):
        assert reflow("Ends here.\n\nA new one starts.") == \
            "Ends here.\n\nA new one starts."

    def test_mid_sentence_double_newline_is_merged(self):
        # Extraction emits these too, so newline count alone cannot decide.
        assert reflow("autotrophic\n\norganisms") == "autotrophic organisms"

    def test_lowercase_after_period_is_not_a_break(self):
        assert reflow("the\nU.S.\nstates that") == "the U.S. states that"

    def test_text_without_newlines_is_untouched(self):
        s = "nothing to do here"
        assert reflow(s) is s

    # -- lists must survive ------------------------------------------------
    # An earlier version merged these. It altered 61.8% of iFixit sections and
    # most of that was damage: spec sheets and tool lists flattened to run-on
    # lines. With the guard the rate is 8.2%, and that remainder is real prose.

    def test_spec_sheet_keeps_its_field_boundaries(self):
        s = ("CPU: AMD A10 9600P / 2.4 GHz\nMax Turbo Speed: 3.3 GHz\n"
             "Number of Cores: Quad-Core\nCache: 2 MB")
        assert reflow(s) == s

    def test_tool_list_is_not_merged(self):
        s = "Essential Electronics Toolkit\n\nSolder Leaded 63/37 Rosin Core"
        assert reflow(s) == s

    def test_link_list_is_not_merged(self):
        s = "Wikipedia: Magnavox\nWikipedia: Cassette Tape\nWikipedia: Boombox"
        assert reflow(s) == s

    def test_prose_among_capitals_still_reflows(self):
        # Proper nouns make many fragments start capitalised; what marks this as
        # prose is that some fragments continue a clause.
        assert reflow("The\niPhone 6\nand\niPhone 6 Plus\nare\nsmartphones") == \
            "The iPhone 6 and iPhone 6 Plus are smartphones"


class TestSearchQuality:
    @pytest.mark.parametrize("query,expect,topn", EXPECTED)
    def test_expected_hit_in_top_n(self, searcher, query, expect, topn):
        hits = searcher.search(query, limit=topn)
        assert hits, f"no results at all for {query!r}"
        titles = " | ".join(h["title"].lower() for h in hits)
        assert any(e in titles for e in expect), (
            f"{query!r}: none of {expect} in top {topn}: {titles[:300]}")

    def test_results_are_ordered_by_score(self, searcher):
        hits = searcher.search("battery replacement", limit=20)
        scores = [h["score"] for h in hits]
        assert scores == sorted(scores, reverse=True)

    def test_no_duplicate_documents(self, searcher):
        hits = searcher.search("screen replacement", limit=25)
        ids = [h["id"] for h in hits]
        assert len(ids) == len(set(ids))

    def test_nonsense_query_is_empty_not_error(self, searcher):
        assert searcher.search("zzzqqqxxwvv") == []


class TestRetrieval:
    def test_get_returns_sections(self, searcher):
        hits = searcher.search("battery replacement", limit=1)
        doc = searcher.get(hits[0]["id"])
        assert doc is not None
        assert doc["title"]
        assert doc["sections"] or doc["lead"], "document has no readable content"

    def test_body_roundtrips_through_zstd_dictionary(self, searcher):
        """Every body blob must decompress against the stored dictionary."""
        rows = searcher.con.execute(
            "SELECT id FROM doc WHERE body IS NOT NULL "
            "ORDER BY importance DESC LIMIT 300").fetchall()
        assert rows, "no compressed bodies in codex"
        for (doc_id,) in rows:
            doc = searcher.get(doc_id)
            assert doc is not None
            assert isinstance(doc["sections"], list)

    def test_related_resolve_to_real_docs(self, searcher):
        hits = searcher.search("iphone", limit=1)
        if not hits:
            pytest.skip("no iphone content")
        for rel in searcher.related(hits[0]["id"]):
            assert searcher.get(rel["id"]) is not None


class TestDisambiguation:
    """1,028 titles are shared by 2,343 documents; results must be tellable apart."""

    def test_ambiguous_titles_get_context(self, searcher):
        rows = searcher.con.execute(
            "SELECT title FROM doc GROUP BY title HAVING COUNT(*) > 5 "
            "ORDER BY COUNT(*) DESC LIMIT 1").fetchall()
        if not rows:
            pytest.skip("no ambiguous titles in this codex")
        title = rows[0][0]
        total, with_ctx = searcher.con.execute(
            "SELECT COUNT(*), COUNT(context_id) FROM doc WHERE title=?",
            (title,)).fetchone()
        assert with_ctx > 0, (
            f"none of the {total} documents titled {title!r} have a context "
            f"label; disambiguation is not working")

    def test_context_points_at_a_real_doc(self, searcher):
        n = searcher.con.execute(
            "SELECT COUNT(*) FROM doc d LEFT JOIN doc c ON c.id = d.context_id "
            "WHERE d.context_id IS NOT NULL AND c.id IS NULL").fetchone()[0]
        assert n == 0, f"{n} context labels point at missing documents"

    def test_context_is_never_self(self, searcher):
        n = searcher.con.execute(
            "SELECT COUNT(*) FROM doc WHERE context_id = id").fetchone()[0]
        assert n == 0

    def test_search_surfaces_context(self, searcher):
        hits = searcher.search("safety precautions", limit=10)
        if len(hits) < 2:
            pytest.skip("not enough hits")
        assert any(h.get("context") for h in hits), \
            "no result carries a context label"


class TestRelated:
    def test_every_doc_gets_related(self, searcher):
        """Link-derived covers ~28%; the similarity fallback must cover the rest."""
        rows = searcher.con.execute(
            "SELECT id FROM doc WHERE NOT EXISTS "
            "(SELECT 1 FROM related r WHERE r.src = doc.id) "
            "ORDER BY importance DESC LIMIT 20").fetchall()
        if not rows:
            pytest.skip("every document has link-derived related")
        covered = sum(1 for (i,) in rows if searcher.related(i))
        assert covered >= len(rows) * 0.8, (
            f"fallback only covered {covered}/{len(rows)} documents")

    def test_related_never_includes_self(self, searcher):
        for (i,) in searcher.con.execute(
                "SELECT id FROM doc ORDER BY importance DESC LIMIT 40"):
            assert all(r["id"] != i for r in searcher.related(i))

    def test_related_is_labelled_by_source(self, searcher):
        hits = searcher.search("battery", limit=1)
        rel = searcher.related(hits[0]["id"])
        if rel:
            assert all(r.get("source") in ("links", "similar") for r in rel)


class TestTextOnly:
    """A codex stores no images. Verify none of that machinery survived."""

    def test_no_media_schema_objects(self, searcher):
        names = [r[0] for r in searcher.con.execute(
            "SELECT name FROM sqlite_master")]
        for bad in ("image", "doc_image_raw", "media_meta"):
            assert bad not in names, f"{bad} still exists in the schema"

    def test_no_media_file_attached(self, searcher):
        dbs = [r[1] for r in searcher.con.execute("PRAGMA database_list")]
        assert "media" not in dbs

    def test_searcher_has_no_image_api(self, searcher):
        assert not hasattr(searcher, "image_blob")
        assert not hasattr(searcher, "images")


class TestHygiene:
    """Dangling image references must be gone; real text must survive."""

    def test_no_pure_pointer_sentences_remain(self, searcher):
        rows = searcher.con.execute(
            "SELECT id FROM doc ORDER BY importance DESC LIMIT 800").fetchall()
        offenders = []
        pointer = re.compile(
            r"\((?:see|as shown in|as seen in)[^)]{0,40}"
            r"(?:image|photo|picture|figure)[^)]{0,20}\)", re.I)
        for (doc_id,) in rows:
            doc = searcher.get(doc_id)
            for s in doc["sections"]:
                if s.get("k") == "table":
                    continue
                m = pointer.search(s.get("t") or "")
                if m:
                    offenders.append((doc["title"], m.group(0)))
        assert not offenders, f"{len(offenders)} left, e.g. {offenders[:3]}"

    def test_spec_fields_survive(self, searcher):
        """'Image Resolution: 1920x1080' is data, not a dangling reference."""
        from codex.hygiene import clean_text
        for spec in ("Image Resolution: 1920x1080 Full HD",
                     "Image Aspect Ratio: 3:2 Monitor Features: Anti-glare",
                     "Image Display: 21 in crt"):
            out, _ = clean_text(spec)
            assert out == spec, f"spec field was mangled: {spec!r} -> {out!r}"

    def test_non_pictorial_image_words_survive(self, searcher):
        from codex.hygiene import clean_text
        for phrase in ("Figure out how to solve the problem on the support page",
                       "creating bootable images on USB keys the easy way",
                       "If your first solder joint isn't picture-perfect, that's OK"):
            out, dep = clean_text(phrase)
            assert out == phrase, f"mangled: {phrase!r} -> {out!r}"
            assert not dep, f"wrongly flagged image-dependent: {phrase!r}"

    def test_clause_excision_keeps_the_instruction(self):
        from codex.hygiene import clean_text
        out, _ = clean_text("Remove the screws connecting the cover (see image)")
        assert "Remove the screws connecting the cover" in out
        assert "see image" not in out.lower()

        out, _ = clean_text(
            "Do not pull directly on the wires, as depicted in the photo.")
        assert out.startswith("Do not pull directly on the wires")
        assert "photo" not in out.lower()

    def test_comment_counts_are_gone(self, searcher):
        for (doc_id,) in searcher.con.execute(
                "SELECT id FROM doc ORDER BY importance DESC LIMIT 300"):
            doc = searcher.get(doc_id)
            for s in doc["sections"]:
                t = (s.get("t") or "").lower()
                assert "0 comments" not in t
                assert "one comment" not in t

    def test_flag_is_set_somewhere_and_is_a_minority(self, searcher):
        n, dep = searcher.con.execute(
            "SELECT COUNT(*), COUNT(*) FILTER (WHERE flags & 1) FROM doc"
        ).fetchone()
        assert dep > 0, "nothing flagged - the flag is probably not wired up"
        assert dep < n * 0.5, f"{dep}/{n} flagged; rules are too broad"


class TestTables:
    def test_tables_round_trip(self, searcher):
        rows = searcher.con.execute(
            "SELECT id FROM doc ORDER BY importance DESC LIMIT 1500").fetchall()
        found = 0
        for (doc_id,) in rows:
            for s in searcher.get(doc_id)["sections"]:
                if s.get("k") != "table":
                    continue
                found += 1
                assert isinstance(s.get("rows"), list)
                assert s["rows"], "table section with no rows"
                assert all(isinstance(r, list) for r in s["rows"])
        if found == 0:
            pytest.skip("no tables in this corpus sample")


class TestIntegrity:
    def test_sqlite_integrity(self, searcher):
        assert searcher.con.execute(
            "PRAGMA integrity_check").fetchone()[0] == "ok"

    def test_no_dead_end_redirects(self, searcher):
        """Every redirect must point at a document that exists."""
        n = searcher.con.execute(
            "SELECT COUNT(*) FROM redirect r "
            "LEFT JOIN doc d ON d.id = r.to_id WHERE d.id IS NULL").fetchone()[0]
        assert n == 0, f"{n} redirects point at missing documents"

    def test_no_dead_end_related(self, searcher):
        n = searcher.con.execute(
            "SELECT COUNT(*) FROM related r "
            "LEFT JOIN doc d ON d.id = r.dst WHERE d.id IS NULL").fetchone()[0]
        assert n == 0, f"{n} related rows point at missing documents"

    def test_every_doc_has_title(self, searcher):
        n = searcher.con.execute(
            "SELECT COUNT(*) FROM doc WHERE title IS NULL OR title=''").fetchone()[0]
        assert n == 0

    def test_importance_is_normalised(self, searcher):
        lo, hi = searcher.con.execute(
            "SELECT MIN(importance), MAX(importance) FROM doc").fetchone()
        assert 0.0 <= lo <= hi <= 1.0000001


class TestLatency:
    """The hotkey launcher is only worth having if it feels instant."""

    def _p95(self, fn, queries, rounds=3):
        times = []
        for _ in range(rounds):
            for q in queries:
                t0 = time.perf_counter()
                fn(q)
                times.append((time.perf_counter() - t0) * 1000)
        times.sort()
        return times[int(len(times) * 0.95) - 1]

    QUERIES = ["iphone", "battery", "macbook pro", "screen replacement",
               "thermal paste", "nintendo", "samsung galaxy", "spudger"]

    def test_quick_search_under_30ms(self, searcher):
        for q in self.QUERIES:      # warm the cache first
            searcher.search(q, limit=10)
        p95 = self._p95(lambda q: searcher.search(q, limit=10), self.QUERIES)
        assert p95 < 30.0, f"quick p95 = {p95:.1f}ms, target <30ms"

    def test_deep_search_under_300ms(self, searcher):
        if not searcher.has_deep:
            pytest.skip("no deep index")
        for q in self.QUERIES:
            searcher.search(q, limit=10, deep=True)
        p95 = self._p95(lambda q: searcher.search(q, limit=10, deep=True),
                        self.QUERIES)
        assert p95 < 300.0, f"deep p95 = {p95:.1f}ms, target <300ms"


LIBRETEXTS = str(data_dir() / "libretexts-med.codex.db")


@pytest.fixture(scope="module")
def lt():
    if not Path(LIBRETEXTS).exists():
        pytest.skip("libretexts-med not built")
    s = Searcher(LIBRETEXTS)
    yield s
    s.close()


class TestAdapterHooks:
    """The two hooks that let an adapter read a body from another entry.

    Both are no-ops on GenericAdapter by design: every existing adapter relies
    on the default, so a regression here silently changes Wikipedia and iFixit.
    """

    def test_prepare_is_a_noop_and_needs_no_archive(self):
        from codex.adapters import GenericAdapter
        GenericAdapter().prepare(None)

    def test_source_for_returns_the_entry_body_unchanged(self):
        from codex.adapters import GenericAdapter
        html = "<html><body><p>hello</p></body></html>"
        assert GenericAdapter().source_for(None, None, html) is html

    def test_every_adapter_accepts_both_hooks(self):
        from codex.adapters import ADAPTERS
        for cls in ADAPTERS:
            a = cls()
            assert callable(a.prepare) and callable(a.source_for)

    def test_libretexts_without_prepare_does_not_raise(self):
        # pick_adapter() is called in places that never build the index
        # (codexctl logging); the adapter must degrade, not explode.
        from codex.adapters import LibreTextsAdapter
        assert LibreTextsAdapter().skip_path("mathjax/es5/core.js") is True


class TestLibreTextsHierarchy:
    """LibreTexts has no internal links; its graph is rebuilt from the TOC.

    These pin the two things that were measurably wrong at first: pages must be
    reachable (the corpus was 100% orphans without synthesised edges) and the
    context label must name the *book*, not the immediate parent.
    """

    def test_almost_every_doc_has_a_context_label(self, lt):
        n, labelled = lt.con.execute(
            "SELECT COUNT(*), COUNT(context_id) FROM doc").fetchone()
        assert labelled / n > 0.95, f"only {labelled}/{n} labelled"

    def test_orphans_are_rare(self, lt):
        n, orphans = lt.con.execute(
            "SELECT COUNT(*), SUM(in_degree = 0) FROM doc").fetchone()
        assert orphans / n < 0.02, f"{orphans}/{n} orphans"

    def test_context_labels_are_not_ambiguous(self, lt):
        # "Front Matter" repeats once per book: a label that is itself
        # duplicated identifies nothing.
        dupes = dict(lt.con.execute(
            "SELECT title, COUNT(*) c FROM doc GROUP BY title HAVING c > 5"))
        bad = 0
        for (t,) in lt.con.execute(
                "SELECT p.title FROM doc d JOIN doc p ON p.id = d.context_id"):
            if t in dupes:
                bad += 1
        assert bad == 0, f"{bad} docs point at a duplicated context title"

    def test_repeated_titles_resolve_to_different_books(self, lt):
        rows = list(lt.con.execute(
            "SELECT p.title FROM doc d JOIN doc p ON p.id = d.context_id "
            "WHERE d.title = 'Front Matter'"))
        assert len(rows) > 20
        assert len({r[0] for r in rows}) > 20, "all share one context label"


MILMED = str(data_dir() / "military-medicine.codex.db")


class TestFigureDirectives:
    """`strip_figure_directives` -- opt-in, military-medicine only.

    Every case here is a bug that shipped into a build and had to be found by
    reading the corpus back out. They are cheap to keep and expensive to
    rediscover.
    """

    def _s(self, text):
        from codex.hygiene import strip_figure_directives
        return strip_figure_directives(text)[0]

    # -- tier 1: the sentence is only a pointer -----------------------------
    def test_bare_pointer_is_dropped(self):
        assert self._s("See figure 4-3.") == ""

    def test_caption_stub_is_dropped(self):
        assert self._s("Figure 21.") == ""

    def test_directive_with_trailing_clause_is_dropped(self):
        # "for detailed illustration" describes the picture, not the procedure.
        assert self._s("See figure 4-1 for detailed illustration.") == ""

    # -- tier 2: excise the clause, keep the instruction --------------------
    def test_trailing_clause_excised(self):
        assert self._s(
            "Apply a cravat to immobilize a fractured jaw as illustrated in "
            "Figure 4-25.") == "Apply a cravat to immobilize a fractured jaw."

    def test_parenthetical_excised(self):
        assert self._s(
            "You will need a disposable Unopette (see fig. 7-8) for RBC counts."
        ) == "You will need a disposable Unopette for RBC counts."

    def test_leading_clause_excised_and_recapitalised(self):
        assert self._s("As illustrated in figure 3, a turn is made.") \
            == "A turn is made."

    def test_pointer_inside_a_bracket_that_has_real_content(self):
        assert self._s(
            "Press above the antecubital fossa (the depression in the elbow, "
            "see figure 7-4) firmly."
        ) == "Press above the antecubital fossa (the depression in the elbow) firmly."

    # -- regressions --------------------------------------------------------
    def test_fig_does_not_match_inside_figure(self):
        # Alternation order: "fig" before "figure" left "The square knot ure 3".
        assert self._s(
            "The square knot illustrated in figure 3 is best.") \
            == "The square knot is best."

    def test_abbreviation_does_not_split_the_sentence(self):
        # "fig." ends in a period; splitting there tore "(fig. APP-I-3)" apart
        # and the reference survived.
        assert "fig" not in self._s(
            "A school was established for women (fig. APP-I-3) at Bethesda.").lower()

    def test_joiner_does_not_swallow_the_word_and(self):
        # [0-9A-Z] under re.I also matches lowercase, so "and" was consumed as
        # a figure number and the list was truncated half-matched.
        assert "fig" not in self._s(
            "Apply webril (figs. 2-3A, 2-3B, and 2-3C) evenly.").lower()

    def test_letter_suffixed_and_appendix_numbers(self):
        for ref in ("(Figure 215D)", "(Figure B22)", "(Figures 8-22 and 8-23)",
                    "(FIGURE 7-6 OR 7-7)"):
            assert "fig" not in self._s(f"Do the thing {ref}.").lower(), ref

    def test_bracketed_label_is_not_treated_as_a_spec_row(self):
        # "Taping a Sprained Ankle (fig:" parsed as "Label: value" and the whole
        # line was waved through.
        assert "fig" not in self._s(
            "Taping a Sprained Ankle (fig: 78) Cut 14 strips of tape.").lower()

    def test_whole_parenthetical_aside_is_dropped_not_hollowed(self):
        assert self._s("(Narrow sling is shown in illustration for clarity.)") == ""

    # -- must not fire ------------------------------------------------------
    def test_anatomy_and_clinical_vocabulary_survive(self):
        for s in ("The perpendicular plate of the ethmoid bone forms the septum.",
                  "Does the patient wear dentures, braces, or partial plates?",
                  "Use the Physiological Heat Exposure Limit (PHEL) chart first.",
                  "Give 300 mg once daily for 14 days (A-1 regimen).",
                  "Apply a pressure dressing (see paragraph 4-6) and evacuate.",
                  "Administer atropine (2 mg IM) and pralidoxime (600 mg IM)."):
            assert self._s(s) == s, s

    def test_spec_rows_are_untouched(self):
        assert self._s("Image Resolution: 1920x1080") == "Image Resolution: 1920x1080"

    def test_clean_text_is_not_affected(self):
        # The whole point of keeping this separate: 7.3M documents in other
        # codexes must not shift.
        from codex.hygiene import clean_text
        for s in ("The square knot illustrated in figure 3 is best.",
                  "Plate tectonics reshaped the continents.",
                  "Dried figs are a good source of fibre."):
            assert clean_text(s)[0] == s, s


class TestMilitaryMedicineCodex:
    """The 13th codex: built from PDFs, cited, and stripped of picture pointers."""

    @staticmethod
    def _open():
        if not Path(MILMED).exists():
            pytest.skip("military-medicine not built")
        return Searcher(MILMED)

    def test_every_section_cites_its_manual(self):
        s = self._open()
        try:
            rows = s.con.execute(
                "SELECT meta FROM doc WHERE kind = 0 LIMIT 200").fetchall()
            assert rows
            for (meta,) in rows:
                m = json.loads(meta)
                assert m["manual"] and m["source_url"].startswith("https://")
                assert len(m["pages"]) == 2 and m["pages"][0] <= m["pages"][1]
        finally:
            s.close()

    def test_context_labels_name_the_manual(self):
        s = self._open()
        try:
            n, labelled = s.con.execute(
                "SELECT COUNT(*), COUNT(context_id) FROM doc").fetchone()
            assert labelled / n > 0.95
        finally:
            s.close()

    def test_no_bare_see_figure_directives_survive(self):
        s = self._open()
        try:
            n = s.con.execute(
                "SELECT COUNT(*) FROM doc WHERE lead LIKE '%see figure%' "
                "OR lead LIKE '%see fig.%'").fetchone()[0]
            assert n == 0
        finally:
            s.close()
