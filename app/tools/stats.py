"""Quick corpus statistics for a built codex."""
import sqlite3
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from codex.paths import data_dir

db = sys.argv[1] if len(sys.argv) > 1 else str(data_dir() / "ifixit.codex.db")
c = sqlite3.connect(f"file:{db}?mode=ro", uri=True)

total = c.execute("SELECT SUM(word_count), COUNT(*) FROM doc").fetchone()
print(f"docs        {total[1]:,}")
print(f"total words {total[0]:,}")

row = c.execute("SELECT word_count, title FROM doc "
                "WHERE title LIKE 'iPhone 12 Battery%'").fetchone()
if row:
    print(f"sample      {row[1]}: {row[0]:,} words")

print("\nword count distribution")
for label, lo, hi in (("<50", 0, 50), ("50-200", 50, 200), ("200-1k", 200, 1000),
                      ("1k-5k", 1000, 5000), (">5k", 5000, 10**9)):
    n = c.execute("SELECT COUNT(*) FROM doc WHERE word_count>=? AND word_count<?",
                  (lo, hi)).fetchone()[0]
    print(f"  {label:<8} {n:>7,}")

print("\nkind distribution")
for k, n in c.execute("SELECT kind, COUNT(*) FROM doc GROUP BY kind ORDER BY 2 DESC"):
    print(f"  kind={k}  {n:,}")
