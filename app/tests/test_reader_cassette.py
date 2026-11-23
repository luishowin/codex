"""A cassette can move, disappear and return without leaving stale article identities."""
import json
import shutil
import sqlite3
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from codex.reader import request
from codex.schema import CORE_INDEXES, CORE_SQL, FTS_QUICK_SQL


def test_two_book_cassette_moves_and_preserves_edition_identity(tmp_path):
    root = tmp_path / "cassettes"
    folder = root / "first"
    folder.mkdir(parents=True)
    books = []
    for name in ("one", "two"):
        filename = name + " #1.codex.db"
        books.append({"id": name, "file": filename})
        with sqlite3.connect(folder / filename) as db:
            db.executescript(CORE_SQL + CORE_INDEXES + FTS_QUICK_SQL)
            db.executemany("INSERT INTO codex_meta VALUES(?,?)", [("built_at", "first"), ("title", name)])
            db.execute("INSERT INTO doc(id,path,title,lead) VALUES(5,'Tea','Tea','Tea leaves')")
            db.execute("INSERT INTO fts_quick(fts_quick) VALUES('rebuild')")
    manifest = {"version": 1, "id": "sample", "title": "Sample", "books": books}
    (folder / "cassette.json").write_text(json.dumps(manifest))
    def get(**params):
        return request(params, root, {}, {}, {})
    cassette = get()[0]["cassettes"][0]
    for b in cassette["books"]:
        scope = dict(cassette="sample", book=b["id"], edition=b["edition"])
        assert get(**scope, q="tea")[0]["items"][0]["path"] == "Tea"
        assert get(**scope, path="Tea")[0]["title"] == "Tea"
    shutil.move(folder, tmp_path / "removed")
    assert get()[0]["cassettes"] == []
    assert get(**scope, path="Tea")[1] == 404
    folder = root / "renamed"
    shutil.copytree(tmp_path / "removed", folder)
    assert get(**scope, path="Tea")[1] == 200
    with sqlite3.connect(folder / books[-1]["file"]) as db:
        db.execute("UPDATE codex_meta SET value='replacement' WHERE key='built_at'")
    assert get(**scope, path="Tea")[1] == 409
    manifest["books"][0]["file"] = "../outside.codex.db"
    (folder / "cassette.json").write_text(json.dumps(manifest))
    assert get()[0]["cassettes"] == []


def test_specimen_rich_blocks_remain_searchable_without_a_duplicate_text_copy():
    import zlib
    from codex.paths import PROJECT_ROOT
    from codex.search import Searcher
    from contextlib import closing
    from codex.index import _body_text

    path = PROJECT_ROOT / "data/cassettes/reading-room/tea.codex.db"
    with closing(Searcher(str(path))) as searcher:
        data = searcher.con.execute("SELECT body FROM doc WHERE path='Tea'").fetchone()[0]
        section, = json.loads(zlib.decompress(data))
        assert section["k"] == "rich" and "t" not in section
        assert "70 to 80 °C" in _body_text(zlib.decompress, data)
        assert "Camellia sinensis" in searcher.get(1)["sections"][0]["t"]
        assert searcher.search("chamomile", deep=True)[0]["path"] == "Tea"
