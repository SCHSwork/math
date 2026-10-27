#!/usr/bin/env python3
"""Builds config/library-pins.json: a fixed commit for every repo that game
pages load from a branch (…@main, …@master, @latest or no version at all).

Many library games load scripts, SDKs and game files from other people's repos
by branch name. Whatever is pushed there runs on GN 2.0 the next time someone
opens the game, so one change (or a hacked account) could break or take over
those games overnight. The site swaps those links for the commit listed here
(pinLibraryLinks in js/app.js), so games keep running exactly what was there
when they were pinned.

Existing pins never change by themselves. New branch links get pinned to the
commit that's there the first time this runs (it runs with the daily split-file
update). To move pins forward on purpose (after checking the games still work):
    python3 tools/build_library_pins.py --refresh            # every repo
    python3 tools/build_library_pins.py --refresh owner/repo # one repo
"""
import json, pathlib, re, subprocess, sys, tempfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "config/library-pins.json"
LIB_REF = re.search(r'const LIBRARY_REF = "([0-9a-f]{40})"', (ROOT / "js/app.js").read_text()).group(1)
URL_RES = [
    re.compile(r"https?://(?:cdn|fastly|gcore|testingcf|quantil)\.jsdelivr\.net/gh/([\w.-]+)/([\w.-]+?)(?:@([\w.-]+))?/"),
    re.compile(r"https?://(?:raw\.githubusercontent\.com|rawcdn\.githack\.com|raw\.githack\.com)/([\w.-]+)/([\w.-]+)/(?:refs/heads/)?([\w.-]+)/"),
]
SHA = re.compile(r"[0-9a-f]{40}")
VERSION = re.compile(r"v?\d+(\.\d+)*([-.][\w.]+)?")   # 1.2.3, v2, 0.2.0-nightly… (tags, left alone)


def run(*a, **kw):
    return subprocess.run(a, capture_output=True, text=True, timeout=60, **kw)


def pages():
    """Every game page: the pinned library, washed pages."""
    out = {}
    pinned = json.loads((ROOT / "config/library-pinned.json").read_text())["files"]
    with tempfile.TemporaryDirectory() as tmp:
        d = pathlib.Path(tmp) / "lib"
        run("git", "init", "-q", str(d))
        run("git", "-C", str(d), "remote", "add", "origin", "https://github.com/freebuisness/html")
        r = run("git", "-C", str(d), "fetch", "-q", "--depth", "1", "--filter=blob:limit=3m", "origin", LIB_REF)
        if r.returncode:
            sys.exit("Couldn't fetch the game library: " + r.stderr)
        for f in pinned:
            r = run("git", "-C", str(d), "show", f"FETCH_HEAD:{f}")
            if r.returncode == 0:
                out[f] = r.stdout
    for f in (ROOT / "washed").glob("*.html"):
        out["washed/" + f.name] = f.read_text(encoding="utf8", errors="replace")
    return out


def branch_refs(html):
    found = set()
    for rx in URL_RES:
        for m in rx.finditer(html):
            owner, repo, ref = m.group(1), m.group(2), m.group(3) or ""
            if SHA.fullmatch(ref):
                continue
            if ref and ref != "latest" and VERSION.fullmatch(ref):
                continue
            found.add((f"{owner}/{repo}", ref or "latest"))
    return found


def resolve(repo, ref):
    """The commit a branch points at now (None if the repo or branch is gone)."""
    url = f"https://github.com/{repo}"
    target = "HEAD" if ref == "latest" else f"refs/heads/{ref}"
    r = run("git", "ls-remote", url, target)
    if r.returncode or not r.stdout.strip():
        return None
    return r.stdout.split()[0]


def main():
    refresh = "--refresh" in sys.argv
    only = [a for a in sys.argv[1:] if "/" in a]
    data = json.loads(OUT.read_text()) if OUT.exists() else {"pins": {}}
    pins = data.setdefault("pins", {})
    wanted = set()
    for html in pages().values():
        wanted |= branch_refs(html)
    added = changed = missing = 0
    for repo, ref in sorted(wanted):
        key = f"{repo}@{ref}"
        if key in pins and not (refresh and (not only or repo in only)):
            continue
        sha = resolve(repo, ref)
        if not sha:
            missing += 1
            print(f"  gone or private: {key}")
            continue
        if pins.get(key) != sha:
            changed += key in pins
            added += key not in pins
            pins[key] = sha
    data["pins"] = dict(sorted(pins.items()))
    OUT.write_text(json.dumps(data, indent=1) + "\n")
    print(f"Wrote {OUT.relative_to(ROOT)}: {len(pins)} pins ({added} new, {changed} moved, {missing} couldn't be found)")


if __name__ == "__main__":
    main()
