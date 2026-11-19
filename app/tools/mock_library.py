#!/usr/bin/env python3
"""Write the canvas's offline library fixture from the real databases.

``/api/library`` is the real endpoint now; this file is the fallback the canvas
reads when it is opened without a daemon (or served by an older one). Both go
through ``codex.cassette`` so the fixture cannot describe a shelf the daemon
would not serve -- the only difference is the ``_mock`` flag and the digests.

    python3 app/tools/mock_library.py            # write the fixture
    python3 app/tools/mock_library.py --check    # exit 1 if it is stale

A ``sha256`` is computed only for film files up to ``--max-hash`` bytes;
larger ones are left null, because the real digest belongs to the pack step,
not to a UI fixture. The field is never fabricated.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from codex import cassette, paths  # noqa: E402

OUT = paths.APP_DIR / "web" / "mock" / "library.json"
DEFAULT_HASH_CAP = 2 * 1000 * 1000 * 1000  # 2 GB


def build(data_dir: Path, art_db: Path, creator: str, max_hash: int | None,
          skip: set[str]) -> dict:
    doc = cassette.build(
        data_dir, art_db, creator=creator, skip=skip, max_hash=max_hash,
        generated_by="app/tools/mock_library.py")
    for cas in doc["cassettes"]:
        cas["_mock"] = True
    doc["note"] = ("Fixture for the UI. Not a cassette. No manifest digest is "
                   "claimed.")
    return doc


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--data", type=Path, default=paths.data_dir())
    ap.add_argument("--art", type=Path, default=paths.art_db_path())
    ap.add_argument("--out", type=Path, default=OUT)
    ap.add_argument("--creator", default=cassette.DEFAULT_CREATOR)
    ap.add_argument("--max-hash", type=int, default=DEFAULT_HASH_CAP,
                    help="skip sha256 above this many bytes (0 = hash everything)")
    ap.add_argument("--check", action="store_true",
                    help="exit 1 when the existing fixture differs")
    a = ap.parse_args()

    doc = build(a.data, a.art, a.creator, a.max_hash, paths.hidden_rolls())
    text = json.dumps(doc, indent=1, ensure_ascii=False) + "\n"

    if a.check:
        old = a.out.read_text() if a.out.is_file() else ""
        if old != text:
            print(f"{a.out} is stale; rerun without --check", file=sys.stderr)
            return 1
        print(f"{a.out} is current ({len(doc['cassettes'])} cassettes)")
        return 0

    a.out.parent.mkdir(parents=True, exist_ok=True)
    a.out.write_text(text)
    hashed = sum(1 for c in doc["cassettes"]
                 for f in c["film"] if f["sha256"])
    total = sum(1 for c in doc["cassettes"] for f in c["film"])
    print(f"wrote {a.out}: {len(doc['cassettes'])} cassettes, "
          f"{hashed}/{total} film files hashed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
