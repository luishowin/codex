"""Architecture tests for the portable layout.

The migration's core promise, pinned here so it cannot silently regress:

1. The app discovers its project root from __file__, never from the CWD.
2. The data directory is <root>/data, overridable via CODEX_DATA_DIR.
3. Databases open from the new location.
4. The daemon boots with the new defaults and serves working search.
5. No machine-specific absolute path survives in the source (attic excepted).

The subprocess tests deliberately run with cwd="/" (or /tmp) to prove the
application works when launched from anywhere but the project root.
"""
from __future__ import annotations

import glob
import json
import sqlite3
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from codex import paths

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
APP_DIR = REPO_ROOT / "app"
DATA_DIR = REPO_ROOT / "data"

DAEMON_PORT = 8877


class TestRootDiscovery:
    def test_project_root_is_the_repo_root(self):
        assert paths.PROJECT_ROOT == REPO_ROOT
        assert paths.APP_DIR == APP_DIR

    def test_root_does_not_depend_on_cwd(self, monkeypatch, tmp_path):
        monkeypatch.chdir(tmp_path)
        assert paths.PROJECT_ROOT == REPO_ROOT
        assert paths.APP_DIR == APP_DIR

    def test_data_dir_points_at_data(self):
        assert paths.data_dir() == DATA_DIR

    def test_data_dir_env_override(self, monkeypatch, tmp_path):
        monkeypatch.setenv("CODEX_DATA_DIR", str(tmp_path))
        assert paths.data_dir() == tmp_path

    def test_art_db_default(self, monkeypatch, tmp_path):
        monkeypatch.delenv("CODEX_ART_DB", raising=False)
        assert paths.art_db_path() == DATA_DIR / "art.db"
        monkeypatch.setenv("CODEX_ART_DB", str(tmp_path / "x.db"))
        assert paths.art_db_path() == tmp_path / "x.db"

    def test_default_globs_find_every_core_codex(self, monkeypatch):
        monkeypatch.delenv("CODEX_DATA_DIR", raising=False)
        cores = {Path(p).name for g in paths.codex_globs()
                 for p in glob.glob(g)}
        assert len(cores) == 13, cores
        assert "ifixit.codex.db" in cores
        assert "wikipedia.codex.db" in cores
        assert all(n.endswith(".codex.db") and ".codex-deep" not in n
                   for n in cores)


class TestDatabaseAccess:
    def test_db_opens_from_new_location(self):
        con = sqlite3.connect(
            f"file:{DATA_DIR / 'ifixit.codex.db'}?mode=ro", uri=True)
        try:
            n = con.execute("SELECT COUNT(*) FROM doc").fetchone()[0]
        finally:
            con.close()
        assert n == 82231  # ifixit, rebuilt 2026-11-20 (was 82,269)


class TestNoMachinePaths:
    """Legacy Windows paths must not survive outside tools/attic.

    attic/ is deliberately unmaintained evidence probes (see README) and keeps
    its original path strings; milmed_ocr.py keeps one documented, overridable
    Windows default (TESSERACT_CMD), and paths.py documents the banned forms.
    """
    BANNED = ("D:/codex", "D:\\codex", "codex from C drive")
    C_COLON_ALLOWED = {"codex/paths.py", "tools/milmed_ocr.py"}
    # The sweep definitions themselves live in this file, so it is exempt.
    SELF = "tests/test_paths.py"

    def test_no_legacy_paths_in_source(self):
        offenders = []
        for p in (APP_DIR).rglob("*.py"):
            rel = p.relative_to(APP_DIR)
            if str(rel).startswith("tools/attic") or str(rel) == self.SELF:
                continue
            text = p.read_text(encoding="utf-8", errors="ignore")
            for b in self.BANNED:
                if b in text:
                    offenders.append(f"{rel}: {b}")
        assert not offenders, offenders

    def test_windows_colon_paths_are_confined(self):
        for p in APP_DIR.rglob("*.py"):
            rel = str(p.relative_to(APP_DIR))
            if rel == self.SELF:
                continue
            text = p.read_text(encoding="utf-8", errors="ignore")
            if "C:\\" in text or "C:/" in text:
                assert rel in self.C_COLON_ALLOWED, rel


class TestForeignCwdOperation:
    def test_codexctl_info_runs_from_tmp(self):
        r = subprocess.run(
            [sys.executable, str(APP_DIR / "codexctl.py"),
             "info", str(DATA_DIR / "ifixit.codex.db")],
            capture_output=True, text=True, cwd="/tmp", timeout=120)
        assert r.returncode == 0, r.stderr
        assert "documents" in r.stdout

    def test_tools_resolve_paths_from_anywhere(self):
        r = subprocess.run(
            [sys.executable, str(APP_DIR / "tools" / "stats.py")],
            capture_output=True, text=True, cwd="/", timeout=120)
        assert r.returncode == 0, r.stderr
        assert "docs" in r.stdout


class TestDaemonBoot:
    """Boot the real daemon with the real defaults, from cwd='/'.

    Only the ifixit codex is passed so the boot stays fast; art.db is found
    via its default path (no --art flag), which is part of what is tested.
    """

    def test_daemon_starts_serves_and_stops(self):
        proc = subprocess.Popen(
            [sys.executable, "-u", str(APP_DIR / "codexd.py"),
             "--codex", str(DATA_DIR / "ifixit.codex.db"),
             "--port", str(DAEMON_PORT)],
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            text=True, cwd="/")
        health = None
        try:
            for _ in range(60):  # 30 s max; ifixit loads in ~2 s
                if proc.poll() is not None:
                    break
                try:
                    with urllib.request.urlopen(
                            f"http://127.0.0.1:{DAEMON_PORT}/api/health",
                            timeout=1) as r:
                        health = json.loads(r.read())
                    break
                except Exception:
                    time.sleep(0.5)
            assert health is not None, "daemon never answered /api/health"
            assert health["ok"] is True
            assert [c["name"] for c in health["codexes"]] == ["ifixit"]
            assert health["codexes"][0]["docs"] == 82231  # rebuilt 2026-11-20
            # art.db found via its project-relative default.
            assert health["art"] is not None
            assert health["art"]["images"] == 100

            # Search still works end to end.
            with urllib.request.urlopen(
                    f"http://127.0.0.1:{DAEMON_PORT}/api/search"
                    "?q=iphone+battery&codex=ifixit&n=5", timeout=10) as r:
                page = json.loads(r.read())
            assert page["hits"], "no hits for a pinned ifixit query"
        finally:
            proc.terminate()
            try:
                proc.wait(timeout=15)
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.wait()
        assert proc.returncode in (0, -15), proc.returncode
