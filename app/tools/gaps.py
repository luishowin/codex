"""What is actually missing or degraded in a built codex?"""
import sqlite3
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from codex.paths import data_dir

core = sys.argv[1] if len(sys.argv) > 1 else str(data_dir() / "ifixit.codex.db")
deep = core.replace(".codex.db", ".codex-deep.db")

c = sqlite3.connect(f"file:{core}?mode=ro", uri=True)
n = c.execute("SELECT COUNT(*) FROM doc").fetchone()[0]


def pct(x):
    return f"{x:,} ({x/max(n,1):.1%})"


print(f"documents: {n:,}\n")

print("--- unpopulated tables")
for t in ("image", "vec"):
    try:
        src = c if t != "vec" else sqlite3.connect(f"file:{deep}?mode=ro", uri=True)
        cnt = src.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
        print(f"  {t:<10} {cnt:,}")
    except sqlite3.DatabaseError as e:
        print(f"  {t:<10} <{e}>")

print("\n--- content completeness")
print(f"  empty lead        {pct(c.execute(chr(83)+'ELECT COUNT(*) FROM doc WHERE lead IS NULL OR lead=' + chr(39)*2).fetchone()[0])}")
print(f"  no sections       {pct(c.execute('SELECT COUNT(*) FROM doc WHERE body IS NULL OR length(body)<12').fetchone()[0])}")
print(f"  no related        {pct(c.execute('SELECT COUNT(*) FROM doc d WHERE NOT EXISTS(SELECT 1 FROM related r WHERE r.src=d.id)').fetchone()[0])}")
print(f"  zero importance   {pct(c.execute('SELECT COUNT(*) FROM doc WHERE importance=0').fetchone()[0])}")
print(f"  orphan (in_deg=0) {pct(c.execute('SELECT COUNT(*) FROM doc WHERE in_degree=0').fetchone()[0])}")

print("\n--- duplicate titles")
dupes = c.execute(
    "SELECT COUNT(*) FROM (SELECT title FROM doc GROUP BY title HAVING COUNT(*)>1)"
).fetchone()[0]
dupe_docs = c.execute(
    "SELECT COALESCE(SUM(k),0) FROM (SELECT COUNT(*) k FROM doc GROUP BY title HAVING COUNT(*)>1)"
).fetchone()[0]
print(f"  titles with >1 doc  {dupes:,}  covering {pct(dupe_docs)}")
for t, k in c.execute("SELECT title, COUNT(*) k FROM doc GROUP BY title "
                      "HAVING k>1 ORDER BY k DESC LIMIT 5"):
    print(f"     x{k}  {t[:60]}")

print("\n--- lead quality (byline/boilerplate leakage)")
for pat, label in (("%Written By%", "'Written By'"),
                   ("%Comments:%", "'Comments:'"),
                   ("%Difficulty%", "'Difficulty'")):
    k = c.execute("SELECT COUNT(*) FROM doc WHERE lead LIKE ?", (pat,)).fetchone()[0]
    print(f"  {label:<14} {pct(k)}")

print("\n--- kinds")
names = {0: "article", 1: "guide", 2: "device", 3: "category"}
for k, cnt in c.execute("SELECT kind, COUNT(*) FROM doc GROUP BY kind ORDER BY 2 DESC"):
    print(f"  {names.get(k,k):<10} {cnt:,}")
