"""The curated image layer.

A codex still stores no images. `art.db` is a separate, optional, hand-curated
file sourced from Wikimedia rather than from a ZIM, so the tests that pin the
text-only decision (`TestTextOnly` in test_search_quality.py) must keep passing
untouched -- there is one test below that asserts exactly that.

    pytest tests/test_art.py -v
"""
from __future__ import annotations

import os
import re
import sqlite3
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "tools"))

from codex.art import ArtStore
from codex.paths import art_db_path, data_dir

ART_DB = os.environ.get("CODEX_ART_DB", str(art_db_path()))

# The build-time invariants, restated here so a change to art_build.py that
# relaxes one of them fails a test rather than silently shipping.
MAX_HERO_BYTES = 500 * 1024
MIN_MP = 1.2
TOTAL_BUDGET_MB = 100

_TAG = re.compile(r"<[^>]+>")


@pytest.fixture(scope="module")
def art():
    if not Path(ART_DB).exists():
        pytest.skip(f"art.db not built: {ART_DB}")
    return ArtStore(ART_DB)


@pytest.fixture(scope="module")
def con():
    if not Path(ART_DB).exists():
        pytest.skip(f"art.db not built: {ART_DB}")
    c = sqlite3.connect(f"file:{ART_DB}?mode=ro", uri=True)
    c.row_factory = sqlite3.Row
    yield c
    c.close()


class TestSubjectList:
    """Runs without a built art.db: the list is source, not data."""

    def test_list_is_structurally_sound(self):
        import art_subjects
        assert art_subjects.check() == []

    def test_slugs_are_url_safe(self):
        import art_subjects
        for _, title, _ in art_subjects.SUBJECTS:
            s = art_subjects.slug_for(title)
            assert re.fullmatch(r"[a-z0-9-]+", s), f"{title} -> {s!r}"

    def test_disambiguators_are_stripped_from_display(self):
        import art_subjects
        assert art_subjects.display_name("Bearing (mechanical)") == "Bearing"
        assert art_subjects.slug_for("Splint (medicine)") == "splint"


class TestLicencePolicy:
    """No network. Pure policy, and the cases that actually bit."""

    def test_free_licences_accepted(self):
        import art_commons as ac
        for code in ("cc0", "cc-by-4.0", "cc-by-sa-3.0", "cc-by-sa-2.0-fr",
                     "pd", "pd-usgov"):
            ok, why = ac.licence_ok({"licence_code": code, "licence": code})
            assert ok, f"{code} rejected: {why}"

    def test_public_domain_by_short_name(self):
        import art_commons as ac
        ok, _ = ac.licence_ok({"licence_code": "", "licence": "Public domain"})
        assert ok

    def test_copyrighted_free_use_is_free(self):
        # "Copyrighted free use" is a free Commons template. A `copyright`
        # substring in the deny list matched it and dropped a usable image.
        import art_commons as ac
        ok, _ = ac.licence_ok({"licence_code": "",
                               "licence": "Copyrighted free use"})
        assert ok

    def test_non_free_rejected(self):
        import art_commons as ac
        for info in ({"non_free": "true", "licence": "CC BY-SA 4.0"},
                     {"licence": "Fair use", "licence_code": "fair-use"},
                     {"licence": "All rights reserved", "licence_code": ""},
                     {"licence": "CC BY-NC 4.0 noncommercial",
                      "licence_code": "cc-by-nc-4.0"},
                     {"licence": "", "licence_code": ""}):
            ok, why = ac.licence_ok(info)
            assert not ok, f"{info} accepted as {why}"

    def test_gfdl_is_not_silently_accepted(self):
        # GFDL 1.2-only is free but carries a full-licence-text obligation this
        # project does not satisfy. Excluded on purpose, not by oversight.
        import art_commons as ac
        ok, _ = ac.licence_ok({"licence": "GFDL 1.2", "licence_code": "gfdl-1.2"})
        assert not ok


class TestMarkupStripping:
    def test_artist_html_becomes_text(self):
        import art_commons as ac
        raw = ('<a href="//commons.wikimedia.org/wiki/User:RCraig09" '
               'title="User:RCraig09">RCraig09</a>')
        assert ac.strip_markup(raw) == "RCraig09"

    def test_whitespace_collapses(self):
        import art_commons as ac
        assert ac.strip_markup("  a\n\n  b  ") == "a b"

    def test_empty_is_empty(self):
        import art_commons as ac
        assert ac.strip_markup("") == ""


class TestRelevanceHeuristics:
    def test_human_is_not_a_stopword(self):
        # With `human` stopped out, `human skull` scored only on `skull` and the
        # best candidate became `African elephant skull`.
        import art_commons as ac
        assert (ac.name_overlap("File:Human skull side simplified.svg",
                                ["Human skull"])
                > ac.name_overlap("File:African elephant skull.jpg",
                                  ["Human skull"]))

    def test_aliases_rescue_a_good_name(self):
        import art_commons as ac
        assert ac.name_overlap("File:Common-foxglove-285364.jpg",
                               ["Digitalis", "Foxglove"]) >= 1

    def test_charts_are_detected(self):
        import art_commons as ac
        assert ac.looks_like_a_chart("File:1911- Wildfire disasters - worldwide.svg")
        assert not ac.looks_like_a_chart("File:Amanita phalloides 1.JPG")

    def test_video_mimes_are_not_images(self):
        import art_commons as ac
        assert "video/webm" not in ac.IMAGE_MIMES
        assert "image/jpeg" in ac.IMAGE_MIMES

    def test_ui_chrome_is_furniture(self):
        # `OOjs UI icon edit-ltr-progressive.svg` was selected as the hero image
        # for Vibrio cholerae; the regex matched underscores only.
        import art_commons as ac
        for name in ("File:OOjs UI icon edit-ltr-progressive.svg",
                     "File:Commons-logo.svg", "File:Ambox warning.png"):
            assert ac._FURNITURE.search(name.replace("_", " ")), name


class TestStoredImages:
    def test_every_hero_is_within_the_cap(self, con):
        over = con.execute(
            "SELECT slug, LENGTH(hero) n FROM art WHERE LENGTH(hero) > ?",
            (MAX_HERO_BYTES,)).fetchall()
        assert not over, [(r["slug"], r["n"]) for r in over]

    def test_every_raster_image_clears_the_resolution_floor(self, con):
        # SVG is exempt: it is vector, so the thumbnailer rasterises it crisply
        # at whatever width is asked for and the pixel count of a single render
        # carries none of the quality signal it does for a photograph.
        small = con.execute(
            "SELECT slug, width, height FROM art "
            "WHERE width*height < ? AND source_mime <> 'image/svg+xml'",
            (MIN_MP * 1e6,)).fetchall()
        assert not small, [(r["slug"], r["width"], r["height"]) for r in small]

    def test_svg_sourced_images_are_still_a_reasonable_size(self, con):
        # On the long edge, not the width: MediaWiki renders SVG to the
        # requested *width*, so a portrait diagram comes back 1600 wide and
        # taller still, and the encoder then fits the long edge to 1600 --
        # `circulatory-system` ends up 1060x1600, which is correct.
        thin = con.execute(
            "SELECT slug, width, height FROM art WHERE source_mime = "
            "'image/svg+xml' AND MAX(width, height) < 1200").fetchall()
        assert not thin, [(r["slug"], r["width"], r["height"]) for r in thin]

    def test_total_stays_within_budget(self, con):
        mb = con.execute("SELECT SUM(LENGTH(hero)+LENGTH(thumb))/1048576.0 "
                         "FROM art").fetchone()[0]
        assert mb < TOTAL_BUDGET_MB, f"{mb:.1f} MB"

    def test_thumbs_are_much_smaller_than_heroes(self, con):
        bad = con.execute("SELECT slug FROM art "
                          "WHERE LENGTH(thumb) >= LENGTH(hero)").fetchall()
        assert not bad, [r["slug"] for r in bad]

    def test_attribution_is_present_and_is_text(self, con):
        for r in con.execute("SELECT slug, artist, licence FROM art"):
            assert r["artist"], f"{r['slug']}: no artist"
            assert r["licence"], f"{r['slug']}: no licence"
            # The credit line is rendered into the reader. Markup here would be
            # both a rendering bug and an injection hole.
            assert not _TAG.search(r["artist"]), f"{r['slug']}: HTML in artist"

    def test_everything_decodes_as_webp(self, con):
        from PIL import Image
        import io
        for r in con.execute("SELECT slug, hero, thumb, width, height FROM art"):
            for kind in ("hero", "thumb"):
                im = Image.open(io.BytesIO(r[kind]))
                assert im.format == "WEBP", f"{r['slug']}/{kind}: {im.format}"
            im = Image.open(io.BytesIO(r["hero"]))
            assert (im.width, im.height) == (r["width"], r["height"])

    def test_slugs_are_unique_and_url_safe(self, con):
        slugs = [r[0] for r in con.execute("SELECT slug FROM art")]
        assert len(slugs) == len(set(slugs))
        for s in slugs:
            assert re.fullmatch(r"[a-z0-9-]+", s), s


class TestBindings:
    def test_no_orphan_bindings(self, con):
        n = con.execute("SELECT COUNT(*) FROM binding b "
                        "LEFT JOIN art a ON a.id = b.art_id "
                        "WHERE a.id IS NULL").fetchone()[0]
        assert n == 0

    def test_every_binding_points_at_a_real_document(self, con):
        """The join art.db cannot enforce: doc ids live in other files."""
        rows = con.execute("SELECT codex, doc_id FROM binding").fetchall()
        by_codex: dict[str, list[int]] = {}
        for r in rows:
            by_codex.setdefault(r["codex"], []).append(r["doc_id"])
        checked = 0
        for codex, ids in by_codex.items():
            core = data_dir() / f"{codex}.codex.db"
            if not Path(core).exists():
                continue
            c = sqlite3.connect(f"file:{core}?mode=ro", uri=True)
            marks = ",".join("?" * len(ids))
            found = {r[0] for r in c.execute(
                f"SELECT id FROM doc WHERE id IN ({marks})", ids)}
            c.close()
            missing = set(ids) - found
            assert not missing, f"{codex}: {sorted(missing)[:8]}"
            checked += len(ids)
        assert checked > 0, "no codexes present to verify bindings against"

    def test_a_subject_can_bind_to_several_codexes(self, con):
        """The reason art.db is shared rather than per-codex."""
        best = con.execute(
            "SELECT a.slug, COUNT(*) k FROM art a JOIN binding b ON b.art_id=a.id "
            "GROUP BY a.id ORDER BY k DESC LIMIT 1").fetchone()
        assert best and best["k"] > 1, "no image binds to more than one codex"


class TestArtStore:
    def test_absent_file_degrades_to_none(self, tmp_path):
        assert ArtStore.open_if_present(tmp_path / "nope.db") is None

    def test_lookup_by_doc_matches_lookup_by_slug(self, art, con):
        row = con.execute("SELECT codex, doc_id, a.slug FROM binding b "
                          "JOIN art a ON a.id=b.art_id LIMIT 1").fetchone()
        rec = art.for_doc(row["codex"], row["doc_id"])
        assert rec is not None and rec["slug"] == row["slug"]
        assert art.by_slug(row["slug"])["slug"] == row["slug"]
        assert art.slug_for(row["codex"], row["doc_id"]) == row["slug"]

    def test_unknown_lookups_return_none(self, art):
        assert art.for_doc("no-such-codex", 1) is None
        assert art.by_slug("no-such-slug") is None
        assert art.slug_for("no-such-codex", 1) is None
        assert art.blob("no-such-slug") is None

    def test_blob_kinds(self, art, con):
        slug = con.execute("SELECT slug FROM art LIMIT 1").fetchone()["slug"]
        hero, thumb = art.blob(slug, "hero"), art.blob(slug, "thumb")
        assert hero and thumb and len(thumb) < len(hero)
        assert hero[:4] == b"RIFF"          # WebP container
        assert art.blob(slug, "original") is None

    def test_metadata_carries_urls_but_not_blobs(self, art, con):
        slug = con.execute("SELECT slug FROM art LIMIT 1").fetchone()["slug"]
        rec = art.by_slug(slug)
        assert rec["hero_url"] == f"/art/{slug}.webp"
        assert rec["thumb_url"] == f"/art/{slug}.thumb.webp"
        assert "hero" not in rec and "thumb" not in rec

    def test_returned_records_are_copies(self, art, con):
        slug = con.execute("SELECT slug FROM art LIMIT 1").fetchone()["slug"]
        art.by_slug(slug)["subject"] = "clobbered"
        assert art.by_slug(slug)["subject"] != "clobbered"

    def test_annotate_tags_only_bound_hits(self, art, con):
        row = con.execute("SELECT codex, doc_id FROM binding LIMIT 1").fetchone()
        hits = [{"codex": row["codex"], "id": row["doc_id"]},
                {"codex": "no-such-codex", "id": 999999999},
                {"codex": row["codex"]}]          # malformed: no id
        art.annotate(hits)
        assert "art" in hits[0]
        assert "art" not in hits[1] and "art" not in hits[2]

    def test_stats_are_consistent(self, art, con):
        st = art.stats()
        assert st["images"] == con.execute("SELECT COUNT(*) FROM art").fetchone()[0]
        assert st["bindings"] == con.execute(
            "SELECT COUNT(*) FROM binding").fetchone()[0]
        assert st["bytes"] > 0 and st["file_bytes"] > 0
        assert sum(st["by_codex"].values()) == st["bindings"]


class TestTextOnlyStillHolds:
    """The V0.2 decision is unchanged; art.db must not have reintroduced it."""

    def test_art_db_uses_none_of_the_forbidden_names(self, con):
        names = {r[0] for r in con.execute("SELECT name FROM sqlite_master")}
        # Pinned by test_search_quality.py::TestTextOnly::test_no_media_schema_objects
        for bad in ("image", "doc_image_raw", "media_meta"):
            assert bad not in names

    def test_no_codex_gained_an_image_table(self):
        import glob
        for core in glob.glob(str(data_dir() / "*.codex.db")):
            c = sqlite3.connect(f"file:{core}?mode=ro", uri=True)
            names = {r[0] for r in c.execute("SELECT name FROM sqlite_master")}
            c.close()
            assert "image" not in names, core
            assert "art" not in names, f"{core}: art belongs in its own file"

    def test_searcher_is_untouched(self):
        """art.db is never ATTACHed and Searcher grows no image API."""
        from codex.search import Searcher
        core = data_dir() / "ifixit.codex.db"
        if not Path(core).exists():
            pytest.skip("no codex built")
        s = Searcher(core)
        try:
            dbs = {r[1] for r in s.con.execute("PRAGMA database_list")}
            assert "media" not in dbs and "art" not in dbs
            assert dbs <= {"main", "deep"}
            for attr in ("image_blob", "images", "art"):
                assert not hasattr(s, attr)
        finally:
            s.close()

    def test_no_network_module_reachable_from_the_read_side(self):
        """`no network at query time` as an import-graph property.

        Parsed, not grepped: the module docstring names `art_commons` in order
        to explain that it is *not* imported, and a substring scan fails on it.
        """
        import ast
        import codex.art
        tree = ast.parse(Path(codex.art.__file__).read_text(encoding="utf-8"))
        imported = set()
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                imported |= {a.name.split(".")[0] for a in node.names}
            elif isinstance(node, ast.ImportFrom) and node.module:
                imported.add(node.module.split(".")[0])
        for bad in ("urllib", "requests", "httpx", "socket", "http",
                    "art_commons", "PIL"):
            assert bad not in imported, f"codex/art.py imports {bad}"
