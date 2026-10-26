#!/usr/bin/env python3
"""Lists games the library added after its pinned clean version.

The game library is pinned to config/library-pinned.json (its last clean
version), so newer games are hidden on the site. This prints the new ones as
Markdown for the "New library games" GitHub issue, and writes their ids to
new-games-ids.txt. Used by .github/workflows/new-games.yml.
"""
import json, pathlib, re, urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
pinned = json.loads((ROOT / "config/library-pinned.json").read_text())
files = set(pinned["files"])
washed = json.loads((ROOT / "config/library-washed.json").read_text()).get("games", {}) if (ROOT / "config/library-washed.json").exists() else {}
req = urllib.request.Request("https://raw.githubusercontent.com/freebuisness/assets/main/zones.json", headers={"User-Agent": "gn-check"})
zones = json.loads(urllib.request.urlopen(req, timeout=60).read())

new = []
for z in zones:
    name, url = str(z.get("name") or "").strip(), z.get("url") or ""
    if not name or name.startswith("[!]") or re.search(r"comment|discord", name, re.I) or not url.startswith("{HTML_URL}"):
        continue
    f = re.sub(r"^\{HTML_URL\}/?", "", url)
    if f in files or any(re.match(rf"^{int(z['id'])}(?:[-.]|$)", x) for x in files):
        continue
    if washed.get(str(z["id"]), {}).get("file") == f:  # already cleaned (washed/)
        continue
    new.append((int(z["id"]), name, f, z.get("author") or ""))

(ROOT / "new-games-ids.txt").write_text("\n".join(str(i) for i, *_ in new))
if new:
    print(f"The game library has **{len(new)} game{'s' if len(new) != 1 else ''}** that aren't in its last clean version (`{pinned['ref'][:7]}`, October 10). "
          "They're hidden on GN 2.0 and GN Light until someone checks them, because every newer library version contains the malicious ad script.\n")
    print("| Library id | Game | File | By |\n|---|---|---|---|")
    for i, n, f, a in new:
        print(f"| {i} | {n} | `{f}` | {a} |")
    print("\nTo add one safely, see if it can be loaded from its original source and add it to GN Originals. Close this issue once they're all handled; a new one opens if more games show up.")
