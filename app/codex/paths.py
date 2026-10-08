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
