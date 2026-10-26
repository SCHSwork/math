#!/usr/bin/env python3
"""Builds config/added-dates.json: the day each game was added.

The site uses it for the NEW badges, the "New this week / month" filter, the
"Recently added" sort and searching for "new".

A game's date is the first day its id shows up in the history of the list it
comes from:
  - the game library's zones.json (freebuisness/assets),
  - GN Originals' games.json (SCHSwork/GN-originals),
  - this site's own lists: config/library-washed.json (washed games),
    config/ubzone-games.json.
For a library game that was washed, the later of the two dates counts (it
only became playable here when it was washed).

Only file histories are downloaded (no game files). It runs every day with the
split-file sizes (.github/workflows/part-sizes.yml), or by hand:
    python3 tools/build_added_dates.py
"""
import json, pathlib, subprocess, tempfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "config/added-dates.json"


def run(*a, cwd=None):
    return subprocess.run(a, capture_output=True, check=True, cwd=cwd).stdout.decode("utf8", "replace")


def history(tmp, repo, path):
    """[(date, file text)] for every version of `path` in `repo`, oldest first."""
    d = pathlib.Path(tmp) / repo.replace("/", "_")
    if not d.exists():
        run("git", "clone", "-q", "--filter=blob:none", "--no-checkout", f"https://github.com/{repo}", str(d))
    log = run("git", "log", "--reverse", "--format=%H %cs", "--", path, cwd=d).split("\n")
    out = []
    for line in filter(None, log):
        sha, day = line.split()
        try:
            out.append((day, run("git", "show", f"{sha}:{path}", cwd=d)))
        except subprocess.CalledProcessError:
            pass
    return out


def ids_in(text, kind):
    try:
        data = json.loads(text)
    except Exception:
        return []
    if kind == "zones":     # library and GN Originals: a list of games with "id"
        return [str(z["id"]) for z in data if isinstance(z, dict) and "id" in z and not str(z.get("name", "")).startswith("[!]")]
    if kind == "washed":    # {"games": {id: …}}
        return list((data.get("games") or {}).keys())
    if kind == "ubzone":    # {"games": [{"id": …}]}
        return [str(g["id"]) for g in data.get("games", []) if "id" in g]
    if kind == "list":      # partner lists: [{"id": …}]
        return [str(g["id"]) for g in data if isinstance(g, dict) and "id" in g]
    return []


def first_seen(versions, kind, into, prefer_later=False):
    seen = {}
    for day, text in versions:
        for i in ids_in(text, kind):
            seen.setdefault(i, day)
    for i, day in seen.items():
        if i not in into or (prefer_later and day > into[i]):
            into[i] = day
    return len(seen)


def main():
    dates = {}
    with tempfile.TemporaryDirectory() as tmp:
        print("Library:", first_seen(history(tmp, "freebuisness/assets", "zones.json"), "zones", dates), "games", flush=True)
        print("GN Originals:", first_seen(history(tmp, "SCHSwork/GN-originals", "games.json"), "zones", dates), "games", flush=True)
        # (Partner catalogs aren't listed: they're thousands of outside games, often blocked)
        for path, kind in [("config/ubzone-games.json", "ubzone")]:
            print(f"{path}:", first_seen(history(tmp, "SCHSwork/math", path), kind, dates), "games", flush=True)
        # Washed games became playable here when they were washed
        print("Washed:", first_seen(history(tmp, "SCHSwork/math", "config/library-washed.json"), "washed", dates, prefer_later=True), "games", flush=True)
    # Washed games not pushed yet (running by hand before a commit): today
    try:
        import datetime
        today = datetime.date.today().isoformat()
        for i in json.loads((ROOT / "config/library-washed.json").read_text()).get("games", {}):
            dates.setdefault(i, today)
    except Exception:
        pass
    OUT.write_text(json.dumps({"dates": dict(sorted(dates.items(), key=lambda kv: int(kv[0]) if kv[0].lstrip("-").isdigit() else 0))}, separators=(",", ":")) + "\n")
    print(f"Wrote {OUT.relative_to(ROOT)}: {len(dates)} games, {OUT.stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()
