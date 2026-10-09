"""The projector is stdlib-only: nothing outside the standard library (plus
first-party `codex.*`) may enter the daemon's read path.

Build tools may use anything in requirements-build.txt (libzim, selectolax,
zstandard, numpy, ...), but app/codexd.py and every module it transitively
imports must not. This is what makes a fresh machine run the projector with
zero pip installs. Enforced as a transitive closure so an import smuggled in
through a helper module fails here, not on a bare box.
"""
from __future__ import annotations

import ast
import sys
from pathlib import Path

APP_DIR = Path(__file__).resolve().parent.parent
CODEX_DIR = APP_DIR / "codex"


def _resolve_file(top: str, dotted: str, importer: Path) -> Path | None:
    """Map an imported module to a first-party file, or None if third-party."""
    if top == "codex" and dotted == "codex":
        return CODEX_DIR / "__init__.py"
    if top == "codex" and dotted.startswith("codex."):
        return CODEX_DIR / (dotted.split(".")[1] + ".py")
    return None  # relative or unknown: resolved by the caller


def file_deps(path: Path) -> tuple[set[str], set[Path]]:
    """(third-party-or-stdlib top names, first-party files to follow)."""
    tree = ast.parse(path.read_text(encoding="utf-8"))
    tops: set[str] = set()
    follows: set[Path] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for a in node.names:
                top = a.name.split(".")[0]
                f = _resolve_file(top, a.name, path)
                (follows if f else tops).add(f if f else top)
        elif isinstance(node, ast.ImportFrom):
            if node.level:
                # from .x import ... / from . import ... : same package.
                pkg = path.parent
                if node.module:
                    follows.add(pkg / (node.module + ".py"))
                else:
                    for a in node.names:
                        follows.add(pkg / (a.name + ".py"))
            elif node.module:
                top = node.module.split(".")[0]
                f = _resolve_file(top, node.module, path)
                if f is not None:
                    follows.add(f)
                else:
                    tops.add(top)
    return tops, {f for f in follows if f.suffix == ".py" and f.exists()}


class TestStdlibRuntime:
    def test_daemon_read_path_has_no_third_party_imports(self):
        found: dict[str, set[str]] = {}
        done: set[Path] = set()
        stack = [APP_DIR / "codexd.py"]
        while stack:
            path = stack.pop()
            if path in done:
                continue
            done.add(path)
            tops, follows = file_deps(path)
            third = {t for t in tops if t not in sys.stdlib_module_names}
            if third:
                found[str(path)] = third
            stack.extend(follows - done)
        assert not found, (
            "third-party imports in the projector read path "
            f"(see requirements-build.txt policy): {found}")
