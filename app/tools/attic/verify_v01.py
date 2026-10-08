"""Verify the V0.1 additions: disambiguation, related fallback, images."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from codex.search import Searcher

s = Searcher(sys.argv[1] if len(sys.argv) > 1 else "D:/codex/ifixit.codex.db")

print("--- ambiguous title, now disambiguated")
for h in s.search("safety precautions", limit=6):
    print(f"    {h['title']:<22} | {h.get('context') or '-'}")

print("\n--- 'Battery Disconnect' (41 identical titles)")
for h in s.search("battery disconnect", limit=6):
    print(f"    {h['title']:<22} | {h.get('context') or '-'}")

print("\n--- related fallback where no link neighbours exist")
row = s.con.execute(
    "SELECT id, title FROM doc WHERE NOT EXISTS "
    "(SELECT 1 FROM related r WHERE r.src = doc.id) "
    "ORDER BY importance DESC LIMIT 1").fetchone()
print(f"    {row['title']}")
for r in s.related(row["id"])[:5]:
    print(f"      [{r['source']}] {r['title']}")

print("\n--- link-derived related, for contrast")
hits = s.search("iphone 12 battery replacement", limit=1)
d = s.get(hits[0]["id"])
for r in s.related(hits[0]["id"])[:4]:
    print(f"      [{r['source']}] {r['title']}")

print(f"\n--- images on that guide: {len(d['images'])}")
print(f"    context: {d['context']}")
print(f"    sections: {len(d['sections'])}")
blob = s.image_blob(d["id"], 0)
print(f"    hero blob: {len(blob[0]):,} bytes {blob[1]}" if blob else "    no hero")

covered = s.con.execute(
    "SELECT COUNT(DISTINCT doc_id) FROM media.image").fetchone()[0]
total = s.con.execute("SELECT COUNT(*) FROM doc").fetchone()[0]
ctx = s.con.execute("SELECT COUNT(context_id) FROM doc").fetchone()[0]
print(f"\n--- coverage")
print(f"    docs with images:  {covered:,} / {total:,} ({covered/total:.0%})")
print(f"    docs with context: {ctx:,} / {total:,} ({ctx/total:.0%})")
