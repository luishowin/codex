"""The canvas must stay offline, self-contained and honest.

The reader is served by the daemon as static files, and later packaged
inside a Tauri window. Two failure modes are cheap to introduce and hard to
notice:

1. A CDN reference. The app is used with no network; a webfont or script
   pulled from `https://` silently degrades it to a system fallback.
2. A view that ships without its module, or a fixture that drifts from the
   cassette manifest in SPEC.md section 3.

These tests pin both, plus the one honesty rule the fixture must obey: a
digest is either a real hex SHA-256 or null, never invented.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from codex import paths  # noqa: E402

WEB = paths.APP_DIR / "web"
VIEWS = WEB / "views"
MOCK = WEB / "mock" / "library.json"

# The SVG namespace is the only http(s) string allowed in the canvas.
ALLOWED_URL = "http://www.w3.org/"


def canvas_files() -> list[Path]:
    return [p for p in WEB.rglob("*")
            if p.is_file() and p.suffix in {".html", ".css", ".js"}]


class TestOffline:
    def test_no_external_urls(self):
        offenders = []
        for path in canvas_files():
            text = path.read_text(encoding="utf-8")
            for m in re.finditer(r"https?://[^\s\"'<>)]+", text):
                if not m.group(0).startswith(ALLOWED_URL):
                    offenders.append(f"{path.relative_to(WEB)}: {m.group(0)}")
        assert not offenders, "external reference(s) in the canvas:\n" + "\n".join(offenders)

    def test_no_google_fonts(self):
        for path in canvas_files():
            assert "fonts.googleapis" not in path.read_text(encoding="utf-8"), path

    def test_fonts_are_served_locally(self):
        css = (WEB / "codex.css").read_text(encoding="utf-8")
        for m in re.finditer(r'url\("([^"]+)"\)', css):
            ref = m.group(1)
            if not ref.startswith("/static/"):
                continue
            target = WEB / ref[len("/static/"):]
            assert target.is_file(), f"{ref} referenced by codex.css does not exist"


class TestShell:
    def test_index_references_exist(self):
        html = (WEB / "index.html").read_text(encoding="utf-8")
        refs = re.findall(r'(?:href|src)="(/static/[^"]+)"', html)
        assert refs, "index.html references no static assets"
        for ref in refs:
            assert (WEB / ref[len("/static/"):]).is_file(), f"missing {ref}"

    def test_shell_is_marked_as_a_module(self):
        html = (WEB / "index.html").read_text(encoding="utf-8")
        assert '<script type="module" src="/static/app.js"></script>' in html

    def test_every_view_module_is_imported(self):
        app = (WEB / "app.js").read_text(encoding="utf-8")
        for view in VIEWS.glob("*.js"):
            assert f"./views/{view.name}" in app, f"{view.name} is not imported by app.js"

    def test_imports_resolve(self):
        for path in [*WEB.glob("*.js"), *VIEWS.glob("*.js")]:
            text = path.read_text(encoding="utf-8")
            for imp in re.findall(r"from\s+'([^']+)'", text):
                if not imp.startswith("."):
                    continue
                target = (path.parent / imp).resolve()
                assert target.is_file(), f"{path.name} imports missing {imp}"

    def test_each_view_exposes_an_entry_point(self):
        for view in VIEWS.glob("*.js"):
            text = view.read_text(encoding="utf-8")
            assert "export function render" in text or "export async function mount" in text, view.name


@pytest.fixture(scope="module")
def shelf() -> dict:
    assert MOCK.is_file(), "run: python app/tools/mock_library.py"
    return json.loads(MOCK.read_text(encoding="utf-8"))


class TestCassetteFixture:
    def test_shape(self, shelf):
        assert shelf["schema"] == 1
        assert shelf["cassettes"], "fixture lists no cassettes"
        for cas in shelf["cassettes"]:
            for k in ("schema", "cassette_id", "name", "title", "created_at",
                      "created_by", "contents", "film", "cover", "licence"):
                assert k in cas, f"{cas.get('name')} missing {k}"
            c = cas["contents"]
            assert c["documents"] >= 0 and c["words"] >= 0
            assert c["schema"] == 1
            roles = {f["role"] for f in cas["film"]}
            assert "core" in roles
            assert roles <= {"core", "deep"}
            for f in cas["film"]:
                assert isinstance(f["bytes"], int) and f["bytes"] > 0
                assert f["sha256"] is None or re.fullmatch(r"[0-9a-f]{64}", f["sha256"])

    def test_digests_are_never_invented(self, shelf):
        """A null digest means 'not computed yet'. It may not be a placeholder."""
        for cas in shelf["cassettes"]:
            for f in cas["film"]:
                sha = f["sha256"]
                assert sha is None or len(set(sha)) > 4, "a repeated-character digest is a fixture lie"

    def test_fixture_names_match_real_film(self, shelf):
        """Every fixture cassette must correspond to a codex in the data dir."""
        data = paths.data_dir()
        if not data.is_dir():
            pytest.skip("no data directory")
        on_disk = {p.name[:-len(".codex.db")] for p in data.glob("*.codex.db")
                   if not p.name.endswith("-deep.db")}
        if not on_disk:
            pytest.skip("no codexes on disk")
        named = {c["name"] for c in shelf["cassettes"]}
        assert named <= on_disk, f"fixture mentions codexes that do not exist: {named - on_disk}"

    def test_mock_is_flagged(self, shelf):
        assert shelf["cassettes"][0].get("_mock") is True
