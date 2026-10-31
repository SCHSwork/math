#!/usr/bin/env python3
"""Build config/game-genres.json from config/game-info.json.

The site needs each game's genres ("g") and 2-player flag ("p") right away for
the filters and search, but the descriptions and keywords only when the game
finder is opened. So the page loads this small file at startup and the full
game-info.json only when the finder needs it.

Edit config/game-info.json as usual; this file is rebuilt by
.github/workflows/game-genres.yml whenever game-info.json changes, or by hand:
    python3 tools/build_game_genres.py
"""
import json, pathlib

root = pathlib.Path(__file__).resolve().parent.parent
info = json.loads((root / "config/game-info.json").read_text(encoding="utf-8"))
out = {}
for gid, v in info.items():
    if not isinstance(v, dict):
        continue
    e = {}
    if isinstance(v.get("g"), list) and v["g"]:
        e["g"] = v["g"]
    if v.get("p") == 2:
        e["p"] = 2
    if e:
        out[gid] = e
text = json.dumps(out, separators=(",", ":"), ensure_ascii=False) + "\n"
dest = root / "config/game-genres.json"
if not dest.exists() or dest.read_text(encoding="utf-8") != text:
    dest.write_text(text, encoding="utf-8")
    print(f"Wrote {dest.relative_to(root)}: {len(out)} games, {len(text):,} bytes")
else:
    print("config/game-genres.json is up to date")
