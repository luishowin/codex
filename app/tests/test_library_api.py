"""The shelf is real: /api/library describes the film the projector serves.

Two failure modes are cheap to introduce and hard to notice:

1. The endpoint and the offline fixture drift apart, so the canvas shows a
   shelf the daemon would never serve. Both now go through
   ``codex.cassette``, and the parity test below pins it.
2. A digest appears in a manifest that claims to describe film on disk. It
   must be null until a pack step computes it.

Plus the shelf policy itself (``data/shelf.json``): rolls can be hidden
without being deleted, an explicit ``--codex`` always wins, and a broken
policy file hides nothing rather than silently dropping a roll.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import codexd  # noqa: E402
from codex import cassette, paths  # noqa: E402

DATA_DIR = paths.data_dir()
APP_DIR = paths.APP_DIR
ART = paths.art_db_path()
LIBRARY_PORT = 8878


def cores() -> dict[str, Path]:
    if not DATA_DIR.is_dir():
        return {}
    return {p.name[:-len(".codex.db")]: p
            for p in sorted(DATA_DIR.glob("*.codex.db"))
            if not p.name.endswith("-deep.db")}


@pytest.fixture(scope="module")
def film() -> dict[str, Path]:
    got = cores()
    if not got:
        pytest.skip("no codexes on disk")
    return got


def seeded(film: dict[str, Path]) -> dict:
    """A pre-filled summary cache, so a policy test never scans a 7M-row roll."""
    return {name: ({"title": name}, 1, 1) for name in film}


class TestManifests:
    def test_shape_matches_spec(self, film):
        doc = cassette.build(DATA_DIR, ART, only={"ifixit"}, max_hash=None)
        assert doc["schema"] == 1
        assert doc["generated_by"] == "codexd"
        (cas,) = doc["cassettes"]
        for k in ("schema", "cassette_id", "name", "title", "issue",
                  "created_at", "created_by", "contents", "film", "cover",
                  "licence", "manifest_sha256"):
            assert k in cas, f"manifest missing {k}"
        c = cas["contents"]
        assert c["documents"] > 80_000    # 82,231 after the 2026-11-20 rebuild
        assert c["schema"] >= 1
        assert {f["role"] for f in cas["film"]} == {"core", "deep"}
        assert cas["sealed"] is False
        assert cas["cassette_id"].startswith("shelf-")

    def test_film_bytes_are_the_real_files(self, film):
        doc = cassette.build(DATA_DIR, ART, only={"ifixit"}, max_hash=None)
        for f in doc["cassettes"][0]["film"]:
            on_disk = DATA_DIR / f["file"]
            assert on_disk.stat().st_size == f["bytes"]
            assert on_disk.name == (f["file"])

    def test_no_digest_is_computed_for_the_shelf(self, film):
        """max_hash=None is the daemon's setting: never read 34 GB per request."""
        doc = cassette.build(DATA_DIR, ART, only={"ifixit"}, max_hash=None)
        assert all(f["sha256"] is None for f in doc["cassettes"][0]["film"])
        assert doc["cassettes"][0]["manifest_sha256"] is None

    def test_skip_hides_a_roll_without_reading_it(self, film):
        doc = cassette.build(DATA_DIR, ART, skip={"wikipedia-100"},
                             max_hash=None, summaries=seeded(film))
        names = {c["name"] for c in doc["cassettes"]}
        assert "wikipedia-100" not in names
        assert names == set(film) - {"wikipedia-100"}

    def test_explicit_only_is_never_shelf_filtered(self, film):
        doc = cassette.build(DATA_DIR, ART, only={"wikipedia-100"},
                             skip={"wikipedia-100"}, max_hash=None)
        assert [c["name"] for c in doc["cassettes"]] == ["wikipedia-100"]


class TestShelfPolicy:
    def test_reads_shelf_json(self, tmp_path, monkeypatch):
        monkeypatch.setenv("CODEX_DATA_DIR", str(tmp_path))
        monkeypatch.delenv("CODEX_HIDDEN", raising=False)
        (tmp_path / "shelf.json").write_text(
            json.dumps({"schema": 1, "hidden": ["a", "b"]}), encoding="utf-8")
        assert paths.hidden_rolls() == {"a", "b"}

    def test_env_override_wins(self, tmp_path, monkeypatch):
        monkeypatch.setenv("CODEX_DATA_DIR", str(tmp_path))
        (tmp_path / "shelf.json").write_text('{"hidden": ["a"]}', encoding="utf-8")
        monkeypatch.setenv("CODEX_HIDDEN", " x , y ")
        assert paths.hidden_rolls() == {"x", "y"}

    def test_empty_env_shows_everything(self, tmp_path, monkeypatch):
        monkeypatch.setenv("CODEX_DATA_DIR", str(tmp_path))
        (tmp_path / "shelf.json").write_text('{"hidden": ["a"]}', encoding="utf-8")
        monkeypatch.setenv("CODEX_HIDDEN", "")
        assert paths.hidden_rolls() == set()

    @pytest.mark.parametrize("payload", ["", "not json", "[]", '{"hidden": 3}'])
    def test_broken_policy_hides_nothing(self, tmp_path, monkeypatch, payload):
        monkeypatch.setenv("CODEX_DATA_DIR", str(tmp_path))
        monkeypatch.delenv("CODEX_HIDDEN", raising=False)
        (tmp_path / "shelf.json").write_text(payload, encoding="utf-8")
        assert paths.hidden_rolls() == set()

    def test_default_shelf_hides_only_known_rolls(self, film):
        """The shipped policy may hide rolls, but never ones that do not exist."""
        if not paths.shelf_path().is_file():
            pytest.skip("no shelf.json")
        assert paths.hidden_rolls() <= set(film)


class TestDiscovery:
    def test_hidden_rolls_are_not_discovered(self, tmp_path):
        for name in ("a.codex.db", "b.codex.db"):
            (tmp_path / name).write_bytes(b"")  # discovery never opens files
        found = codexd.discover([str(tmp_path / "*.codex.db")], {"a"})
        assert [Path(p).name for p in found] == ["b.codex.db"]

    def test_explicit_pattern_ignores_policy(self, tmp_path):
        (tmp_path / "a.codex.db").write_bytes(b"")
        found = codexd.discover([str(tmp_path / "*.codex.db")], set())
        assert [Path(p).name for p in found] == ["a.codex.db"]


class TestDaemonLibrary:
    """One boot, then the contract: health and library must agree.

    The data directory is a temporary one holding a symlink to the real ifixit
    roll, so ``?all=1`` is cheap and the test cannot depend on what else is on
    this machine's shelf.
    """

    def test_library_matches_health(self, tmp_path):
        real = DATA_DIR / "ifixit.codex.db"
        if not real.is_file():
            pytest.skip("no ifixit codex")
        link = tmp_path / "ifixit.codex.db"
        link.symlink_to(real)
        env = {"CODEX_DATA_DIR": str(tmp_path), "CODEX_HIDDEN": ""}
        proc = subprocess.Popen(
            [sys.executable, "-u", str(APP_DIR / "codexd.py"),
             "--codex", str(link),
             "--art", str(ART),
             "--port", str(LIBRARY_PORT)],
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, cwd="/",
            env={**os.environ, **env})
        try:
            base = f"http://127.0.0.1:{LIBRARY_PORT}"
            health = None
            for _ in range(60):
                if proc.poll() is not None:
                    break
                try:
                    with urllib.request.urlopen(f"{base}/api/health", timeout=1) as r:
                        health = json.loads(r.read())
                    break
                except Exception:
                    time.sleep(0.5)
            assert health is not None, "daemon never answered /api/health"
            assert health["hidden"] == [], "an explicit --codex must not be filtered"
            assert health["shelf"].endswith("shelf.json")

            with urllib.request.urlopen(f"{base}/api/library", timeout=10) as r:
                lib = json.loads(r.read())
            assert len(lib["cassettes"]) == len(health["codexes"]) == 1
            cas, meta = lib["cassettes"][0], health["codexes"][0]
            assert cas["name"] == meta["name"] == "ifixit"
            assert cas["contents"]["documents"] == meta["docs"]
            assert cas["contents"]["words"] == meta["words"]
            assert cas["contents"]["source"] == meta["source"]
            core = next(f for f in cas["film"] if f["role"] == "core")
            assert core["bytes"] == meta["core_bytes"]
            assert core["sha256"] is None
            # One codex means no fusion: it ranks itself, exactly as before.
            with urllib.request.urlopen(
                    f"{base}/api/search?q=battery&n=4", timeout=10) as r:
                search = json.loads(r.read())
            assert search["hits"]
            assert search["weights"] == {"ifixit": 1.0}
            # The contents view: iFixit has 1,582 top-level device containers.
            with urllib.request.urlopen(
                    f"{base}/api/index?codex=ifixit&prefix=A", timeout=20) as r:
                idx = json.loads(r.read())
            assert idx["mode"] == "contents"
            assert idx["unit"] == "device"
            assert idx["total"] > 1_500
            assert idx["letters"]["A"] == len(idx["items"])
            root = idx["items"][0]["id"]
            with urllib.request.urlopen(
                    f"{base}/api/index?codex=ifixit&root={root}", timeout=20) as r:
                kids = json.loads(r.read())
            assert kids["root"]["id"] == root
            assert kids["ordered"] == "id"
            assert [i["id"] for i in kids["items"]] == sorted(i["id"] for i in kids["items"])
            # The flat browse is untouched by any of this.
            with urllib.request.urlopen(
                    f"{base}/api/browse?codex=ifixit&prefix=A&n=5", timeout=20) as r:
                assert json.loads(r.read())["hits"]
            # ?all=1 is the same shelf plus anything policy keeps off it.
            with urllib.request.urlopen(
                    f"{base}/api/library?all=1", timeout=10) as r:
                assert len(json.loads(r.read())["cassettes"]) == 1
        finally:
            proc.terminate()
            try:
                proc.wait(timeout=15)
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.wait()
        assert proc.returncode in (0, -15), proc.returncode
