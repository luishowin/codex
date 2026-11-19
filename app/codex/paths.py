"""Project-root-relative path discovery.

Every path the application needs is derived from this file's location:

    app/codex/paths.py  ->  APP_DIR = <root>/app  ->  PROJECT_ROOT = <root>

so nothing depends on the shell's current working directory or on any
machine-specific absolute path (no C:\\..., no D:/..., no /home/...).

Two things may legitimately point elsewhere and have environment overrides;
everything else is derived.

    CODEX_DATA_DIR    codex database directory      (default <root>/data)
    CODEX_ART_DB      art.db location               (default <root>/data/art.db)
    CODEX_WORK_DIR    generated/cached artifacts    (default <root>/_work)
    CODEX_MILMED_DIR  military-medicine PDF sources (default <root>/milmed)
"""
from __future__ import annotations

import json
import os
from pathlib import Path

APP_DIR = Path(__file__).resolve().parent.parent
PROJECT_ROOT = APP_DIR.parent
DATA_DIR = PROJECT_ROOT / "data"
WORK_DIR = PROJECT_ROOT / "_work"
MILMED_DIR = Path(os.environ.get("CODEX_MILMED_DIR", PROJECT_ROOT / "milmed"))


def data_dir() -> Path:
    """Directory holding the *.codex.db files. Override: CODEX_DATA_DIR."""
    return Path(os.environ.get("CODEX_DATA_DIR", DATA_DIR))


def work_dir() -> Path:
    """Directory for disposable/generated artifacts. Override: CODEX_WORK_DIR."""
    return Path(os.environ.get("CODEX_WORK_DIR", WORK_DIR))


def art_db_path() -> Path:
    """Location of art.db. Override: CODEX_ART_DB."""
    return Path(os.environ.get("CODEX_ART_DB", data_dir() / "art.db"))


def codex_globs() -> list[str]:
    """Default codex patterns: every core codex in the data directory."""
    return [str(data_dir() / "*.codex.db")]


def shelf_path() -> Path:
    """The shelf policy file, beside the film it describes."""
    return data_dir() / "shelf.json"


def hidden_rolls() -> set[str]:
    """Rolls that stay on disk but off the shelf.

    Policy is data, not code: ``data/shelf.json`` lists names under ``hidden``.
    Moving a roll on or off the shelf is an edit to that file, never a ``mv``
    and never a rebuild. ``CODEX_HIDDEN`` overrides it (a comma list; empty
    string means "show everything") so tests and one-off runs stay hermetic.
    A missing or malformed file hides nothing, which is the safe direction:
    the projector would rather serve an extra roll than silently drop one.
    """
    raw = os.environ.get("CODEX_HIDDEN")
    if raw is not None:
        return {n.strip() for n in raw.split(",") if n.strip()}
    try:
        doc = json.loads(shelf_path().read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return set()
    names = doc.get("hidden") if isinstance(doc, dict) else None
    if not isinstance(names, list):
        return set()
    return {str(n) for n in names}


def source_weights() -> dict[str, float]:
    """Per-source multipliers for the cross-codex merge (``data/shelf.json``).

    Optional and empty by default: `codex/merge.py` already derives a weight
    from how specialised a codex is for the query. This is the human override
    for the cases where authority is a judgement, not a statistic -- and it can
    only multiply, with bad values ignored rather than applied.
    """
    try:
        doc = json.loads(shelf_path().read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    raw = doc.get("weights") if isinstance(doc, dict) else None
    if not isinstance(raw, dict):
        return {}
    out: dict[str, float] = {}
    for name, value in raw.items():
        try:
            weight = float(value)
        except (TypeError, ValueError):
            continue
        if not (weight > 0 and weight < float("inf")):
            continue
        out[str(name)] = weight
    return out
