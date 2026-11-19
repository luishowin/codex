"""Source-capture artefacts, and the ingest rules that remove them.

These are the rules that turn the audit's promise into a smaller build. Each one
is narrow on purpose, because they delete documents:

* a replay shell is a JS stub with no prose, never a page;
* a foreign host is a link the crawler followed, not the site that was captured;
* a language picker is furniture, and only when two or more language names
  stand alone at the very start of the text;
* an excluded title belongs to one source's navigation, and the list is empty
  for every source that has not earned one.

The last point is the line the project draws: repeated titles are structure
unless a specific source's repeats are provably furniture.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from codex.adapters import GenericAdapter, LibreTextsAdapter  # noqa: E402
from codex.artifacts import (looks_like_nav_block,  # noqa: E402
                             origin_host, strip_lead_furniture,
                             strip_language_switcher, title_key)
from codex.hygiene import clean_text  # noqa: E402
from codex.model import Doc  # noqa: E402


class TestLanguageSwitcher:
    READY = ("English\n\nEspañol\n\n简体中文\n\nThe most important information "
             "about disasters comes from your local officials.")

    def test_strips_a_picker_at_the_start(self):
        assert strip_language_switcher(self.READY).startswith("The most important")

    def test_strips_when_separated_by_single_spaces(self):
        assert strip_language_switcher("English · Español · The real sentence.") \
            == "The real sentence."

    def test_one_language_is_not_a_picker(self):
        text = "English is the language of the manual. Read it."
        assert strip_language_switcher(text) == text

    def test_prose_naming_languages_is_untouched(self):
        text = ("English, French and German are spoken in this region, and the "
                "manual is printed in all three.")
        assert strip_language_switcher(text) == text

    def test_clean_text_applies_it(self):
        lead, _ = clean_text(self.READY)
        assert lead.startswith("The most important")

    def test_an_empty_page_is_not_emptied(self):
        assert strip_language_switcher("English\nEspañol\n") == "English\nEspañol\n"


class TestLeadFurniture:
    def test_chrome_lines_are_not_a_lead(self):
        assert strip_lead_furniture("On this page") == ""
        assert strip_lead_furniture("Also called: RA\n\nOn this page") == ""
        assert strip_lead_furniture("In this article\n\nReal text.") == "Real text."

    def test_a_repeated_title_is_not_a_lead(self):
        assert strip_lead_furniture("Abscess", "Abscess") == ""

    def test_prose_survives(self):
        text = "An abscess is a collection of pus in any part of the body."
        assert strip_lead_furniture(text, "Abscess") == text

    def test_a_sentence_that_mentions_a_label_survives(self):
        text = "On this page you will learn how abscesses form."
        assert strip_lead_furniture(text) == text

    def test_a_nav_block_is_recognised(self):
        assert looks_like_nav_block(
            "Introduction\n\nBreak It Up\n\nWord Roots\n\nAbbreviations")
        # A real paragraph list is not a nav block: it ends in sentences.
        assert not looks_like_nav_block("First, wash.\n\nThen dry.\n\nFinally, store.")
        # Two lines is not enough evidence.
        assert not looks_like_nav_block("Introduction\n\nBreak It Up")


class TestOriginHost:
    def test_zimit_names_carry_the_captured_site(self):
        assert origin_host("developer.mozilla.org_bc74bccb") == "developer.mozilla.org"

    def test_mwoffliner_names_do_not(self):
        assert origin_host("wikipedia_en_all_nopic_2026-06") == ""
        # Underscored library names are not domains either.
        assert origin_host("libretexts.org_en_med_2025-01") == ""


class TestAdapterRules:
    def test_off_host_paths_are_skipped(self):
        a = GenericAdapter()
        a.keep_host = "developer.mozilla.org"
        shell = "00305984a6e3926ac1ffec8352ef4548057dd998.mdnplay.dev/en-US/docs/x/runner.html?uuid=1"
        assert a.skip_path(shell)
        assert not a.skip_path("developer.mozilla.org/en-US/docs/Web/CSS")
        # Paths without a host are not URL captures at all.
        assert not a.skip_path("index/page_12345")
        assert not a.skip_path("milmed/bandage/s0001")

    def test_no_capture_means_no_host_filtering(self):
        a = GenericAdapter()
        assert a.keep_host == ""
        assert not a.skip_path("en.wikipedia.org/wiki/HTML")

    def test_replay_shell_is_dropped(self):
        a = GenericAdapter()
        shell = Doc(path="x.site/runner.html?uuid=1", title="01ab.mdnplay.dev/x",
                    lead="short", sections=[])
        assert not a.should_keep(shell)

    def test_a_captured_page_on_a_runner_path_is_kept(self):
        a = GenericAdapter()
        page = Doc(path="x.site/runner.html?uuid=1", title="Using the Fetch API",
                   lead="x " * 200, sections=[])
        assert a.should_keep(page)

    def test_libretexts_navigation_titles_are_dropped(self):
        a = LibreTextsAdapter()
        for title in ("Table of Contents", "Front Matter", "Detailed Licensing"):
            doc = Doc(path="index/page_1", title=title, lead="x " * 100,
                      sections=[])
            assert not a.should_keep(doc), title
        # Real book matter stays.
        for title in ("Glossary", "Preface", "5: Lipids"):
            doc = Doc(path="index/page_1", title=title, lead="x " * 100,
                      sections=[])
            assert a.should_keep(doc), title

    def test_other_sources_have_no_excluded_titles(self):
        assert GenericAdapter().exclude_titles == frozenset()
        # And the shared key is what the list is built from.
        assert title_key("FRONT  MATTER") in LibreTextsAdapter.exclude_titles
