"""The audit's classifiers, and the counts they produce on the real shelf.

This tool will justify dropping documents on the next rebuild, so its edges
matter more than its features:

* A Wikipedia article path like ``1._Lig`` is not a host. If it were, every
  plain-text roll would report phantom "off-site" documents.
* A replay shell is also off-host, so the two must be counted as a union.
  MDN has 123 shells and 149 off-host documents; the answer is 149, not 272.
* A repeated title is structure, not junk: every book has a "Chapter 1".

The real-DB assertions are the same numbers measured by hand before the tool
existed (2026-11-20), which is what makes them meaningful.
"""
from __future__ import annotations

import sqlite3
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from tools import audit  # noqa: E402

DATA = Path(__file__).resolve().parent.parent.parent / "data"


class TestClassifiers:
    def test_host_of_accepts_a_captured_url(self):
        assert audit.host_of("developer.mozilla.org/en-US/docs/Web") == "mozilla.org"
        assert audit.host_of(
            "00305984a6e3926ac1ffec8352ef4548057dd998.mdnplay.dev/en-US/docs") == "mdnplay.dev"

    def test_host_of_rejects_article_paths(self):
        # Wikipedia and military-medicine have slashes in paths that are names.
        assert audit.host_of("1._Lig") == ""
        assert audit.host_of("Cancer/deaths") == ""
        assert audit.host_of("milmed/bandage/s0001") == ""
        assert audit.host_of("") == ""

    def test_title_kind(self):
        assert audit.title_kind("https://example.org/x") == "url"
        assert audit.title_kind("www.example.org/x") == "url"
        assert audit.title_kind("developer.mozilla.org/en-US/docs") == "host"
        assert audit.title_kind(
            "00305984a6e3926ac1ffec8352ef4548057dd998.mdnplay.dev/x") == "capture-id"
        assert audit.title_kind("Diabetes") is None
        assert audit.title_kind("") is None

    def test_language_switcher_needs_two_languages(self):
        lead = "English\n\nEspañol\n\n简体中文\n\nThe most important information"
        assert audit.language_hits(lead) == 1
        assert audit.language_hits("A Spanish omelette is made with eggs.") == 0
        assert audit.language_hits("") == 0

    def test_shell_needs_the_replay_path_and_no_prose(self):
        shell = "abc.mdnplay.dev/en-US/docs/x/runner.html?uuid=abc&state=zz"
        assert audit.is_shell(shell, 59)
        assert not audit.is_shell(shell, 900)     # a captured page, not a shell
        assert not audit.is_shell("developer.mozilla.org/en-US/docs/x", 59)


class TestRealShelf:
    """The shelf after the 2026-11-20 rebuilds (ready.gov, MDN, libretexts)."""

    def test_mdn_has_no_capture_artefacts_left(self):
        a = audit.analyse(DATA / "mdn.codex.db")
        c = a["counts"]
        assert c["shell"] == 0
        assert c["off-host"] == 0
        assert c["capture-id-title"] == 0
        assert a["would_drop"] == 0
        # 1,231 before the rebuild: 141 shells, 8 off-site pages, nothing else.
        assert a["docs"] == 1_082

    def test_ready_gov_furniture_leads_are_gone(self):
        """Pre-rebuild (2026-11-20) this roll had 1,688 furniture leads; the
        language-picker strip is what removed them, and this pins it removed."""
        a = audit.analyse(DATA / "ready-gov.codex.db")
        assert a["counts"]["furniture-lead"] == 0
        assert a["would_drop"] == 0
        assert a["docs"] == 2_002

    def test_libretexts_navigation_pages_are_gone(self):
        a = audit.analyse(DATA / "libretexts-med.codex.db")
        assert a["would_drop"] == 0
        # 20,926 before: 757 navigation pages (Table of Contents, Front Matter,
        # Detailed Licensing, InfoPage, Back Matter, TitlePage) were dropped.
        assert a["docs"] == 20_169
        assert a["structure"] == {"anchors": 869, "sections": 20_105}
        # …and none of the excluded titles survived.
        import sqlite3
        con = sqlite3.connect(f"file:{DATA / 'libretexts-med.codex.db'}?mode=ro",
                              uri=True)
        try:
            n = con.execute(
                "SELECT COUNT(*) FROM doc WHERE lower(title) IN "
                "('detailed licensing','infopage','table of contents',"
                "'front matter','back matter','titlepage')").fetchone()[0]
        finally:
            con.close()
        assert n == 0

    def test_military_medicine_has_nothing_to_drop(self):
        a = audit.analyse(DATA / "military-medicine.codex.db")
        assert a["structure"] == {"anchors": 22, "sections": 1_125}
        assert a["would_drop"] == 0
        # "Chapter 1" repeats 23 times and is real content in 23 books.
        assert a["repeated_total"] > 0
        assert a["counts"]["thin-doc"] <= 1

    def test_plain_rolls_have_no_phantom_off_host(self):
        """Article paths with dots are not hosts."""
        for name in ("wikipedia", "wikiversity"):
            db = DATA / f"{name}.codex.db"
            if not db.is_file():
                pytest.skip(f"no {name}")
            a = audit.analyse(db, limit=50_000)
            assert a["modal_host"] == ""
            assert a["counts"]["off-host"] == 0, f"{name} invented off-site pages"

    def test_a_host_shaped_roll_reports_only_real_offsite(self):
        """MedlinePlus paths are URLs; its 2 off-site pages are real links out."""
        a = audit.analyse(DATA / "medlineplus.codex.db", limit=50_000)
        assert a["modal_host"] == "medlineplus.gov"
        assert a["counts"]["off-host"] == 2
        assert a["samples"]["off-host"], "off-host is reported without evidence"

    def test_sampling_is_declared(self):
        db = DATA / "libretexts-med.codex.db"
        a = audit.analyse(db, limit=100)
        assert a["read"] == 100 and a["sampled"] is True

    def test_guide_stats_are_not_leads(self):
        """iFixit: 5,053 guides used to preview as "No estimate"."""
        con = sqlite3.connect(f"file:{DATA / 'ifixit.codex.db'}?mode=ro", uri=True)
        try:
            n = con.execute(
                "SELECT COUNT(*) FROM doc WHERE trim(lead) = 'No estimate'").fetchone()[0]
        finally:
            con.close()
        assert n == 0

    def test_medlineplus_chrome_is_not_a_lead(self):
        con = sqlite3.connect(f"file:{DATA / 'medlineplus.codex.db'}?mode=ro", uri=True)
        try:
            chrome = con.execute(
                "SELECT COUNT(*) FROM doc WHERE lead = 'On this page' "
                "OR lead LIKE 'Also called:%'").fetchone()[0]
        finally:
            con.close()
        assert chrome == 0


BACKUP = Path(__file__).resolve().parent.parent.parent / "_work" / "pre-rebuild-2026-11-20"


class TestBeforeAndAfter:
    """The rebuild is only a fix if the disease was there before it.

    The pre-rebuild rolls are kept in `_work/pre-rebuild-2026-11-20/` so these
    can prove the diff. They are disposable; the tests skip without them.
    """

    def pre(self, name: str) -> Path:
        db = BACKUP / f"{name}.codex.db"
        if not db.is_file():
            pytest.skip("pre-rebuild backup not present")
        return db

    def test_mdn_lost_exactly_its_capture_artefacts(self):
        before = audit.analyse(self.pre("mdn"))
        after = audit.analyse(DATA / "mdn.codex.db")
        assert before["counts"]["shell"] == 123
        assert before["counts"]["off-host"] == 149
        assert before["would_drop"] == 149
        assert after["would_drop"] == 0
        assert before["docs"] - after["docs"] == 149

    def test_ready_gov_leads_were_repaired_not_deleted(self):
        before = audit.analyse(self.pre("ready-gov"))
        after = audit.analyse(DATA / "ready-gov.codex.db")
        assert before["counts"]["furniture-lead"] > 1_400   # 1,463 by this rule
        assert after["counts"]["furniture-lead"] == 0
        assert before["docs"] - after["docs"] == 4     # only the FEMA links went

    def test_libretexts_lost_only_navigation(self):
        before = audit.analyse(self.pre("libretexts-med"))
        after = audit.analyse(DATA / "libretexts-med.codex.db")
        assert before["docs"] - after["docs"] == 757
        assert before["would_drop"] == after["would_drop"] == 0
        assert after["structure"]["sections"] > 19_000   # the books are intact
        assert after["structure"]["anchors"] == before["structure"]["anchors"]
