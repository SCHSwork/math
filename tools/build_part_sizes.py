#!/usr/bin/env python3
"""Builds config/part-sizes.json: the exact size of every split game file, and the
list of game files over jsDelivr's 20 MB limit.

Big games are split into pieces (Build.data.part1, .part2, ...) that the game
downloads and joins. If a piece arrives cut off, the joined file is broken, and
games that save it in the browser then fail on every load. The site uses this
list to re-download short pieces and to never save or use a broken joined file
(see partGuardHook in js/app.js).

It reads every game page (the pinned game library, washed/ and UBZone), finds
the repos they load pieces from, and lists those repos' *.partN files with
their sizes. Only file listings are downloaded, not the files themselves.

It runs by itself every day and when games change (.github/workflows/part-sizes.yml),
since games that load from a branch (e.g. @main) can change. To run it by hand:
    GITHUB_TOKEN=... python3 tools/build_part_sizes.py   (the token makes it much faster)
"""
import json, os, pathlib, re, subprocess, tempfile, urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "config/part-sizes.json"
LIB_REF = re.search(r'const LIBRARY_REF = "([0-9a-f]{40})"', (ROOT / "js/app.js").read_text()).group(1)

# owner/repo@ref/path in any of the URL shapes the games use
URL_RES = [
    re.compile(r"https?://(?:cdn|fastly|gcore|testingcf)\.jsdelivr\.net/gh/([\w.-]+)/([\w.-]+)(?:@([\w./-]+?))?/([^\"'\s)<>`]*)"),
    re.compile(r"https?://(?:raw\.githubusercontent\.com|rawcdn\.githack\.com|raw\.githack\.com)/([\w.-]+)/([\w.-]+)/([\w.-]+)/([^\"'\s)<>`]*)"),
]
SPLIT_HINT = re.compile(r"\.part\d|getParts|mergeFiles|part\s*\+\s*\d|\"\.part\"|'\.part'", re.I)


def run(*a, **kw):
    return subprocess.run(a, capture_output=True, check=True, **kw).stdout.decode("utf8", "replace")


def pages_from_repo(tmp, repo, ref, paths=None):
    d = pathlib.Path(tmp) / ("p_" + repo.replace("/", "_"))
    if not d.exists():
        run("git", "init", "-q", str(d))
        run("git", "-C", str(d), "remote", "add", "origin", f"https://github.com/{repo}")
    run("git", "-C", str(d), "fetch", "-q", "--depth", "1", "--filter=blob:limit=2m", "origin", ref)
    names = paths or [l for l in run("git", "-C", str(d), "ls-tree", "-r", "--name-only", "FETCH_HEAD").splitlines() if re.search(r"\.html?(-a)?$", l)]
    out = {}
    for n in names:
        try:
            out[f"{repo}:{n}"] = run("git", "-C", str(d), "show", f"FETCH_HEAD:{n}")
        except subprocess.CalledProcessError:
            pass
    return out


def repo_refs(html):
    """(owner/repo, ref) pairs a page loads files from."""
    found = set()
    for rx in URL_RES:
        for m in rx.finditer(html):
            found.add((f"{m.group(1)}/{m.group(2)}", m.group(3) or "latest"))
    return found


_tree_cache = {}
def tree_sizes_api(repo, ref):
    """Every file's size from GitHub's API (fast; used in GitHub Actions, where a token is set)."""
    if (repo, ref) in _tree_cache:
        return _tree_cache[(repo, ref)]
    token = os.environ.get("GITHUB_TOKEN")
    if not token:
        return None
    req = urllib.request.Request(f"https://api.github.com/repos/{repo}/git/trees/{ref}?recursive=1",
                                 headers={"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json", "User-Agent": "gn-part-sizes"})
    try:
        tree = json.loads(urllib.request.urlopen(req, timeout=120).read())
    except Exception as e:
        print(f"    API failed for {repo}@{ref} ({e})")
        tree = None
    out = None if not tree or tree.get("truncated") else {t["path"]: t["size"] for t in tree.get("tree", []) if t.get("type") == "blob"}
    _tree_cache[(repo, ref)] = out
    return out


def part_sizes_api(repo, ref):
    """Sizes of *.partN files, from GitHub's API."""
    all_sizes = tree_sizes_api(repo, ref)
    if all_sizes is not None:
        return {p: n for p, n in all_sizes.items() if re.search(r"\.part\d+$", p)}
    return None


def part_sizes(tmp, repo, ref):
    want = "HEAD" if ref in ("latest", "HEAD") else ref
    fast = part_sizes_api(repo, want)
    if fast is not None:
        return fast
    d = pathlib.Path(tmp) / ("t_" + repo.replace("/", "_") + "_" + re.sub(r"\W", "_", want))
    if not d.exists():
        run("git", "init", "-q", str(d))
        run("git", "-C", str(d), "remote", "add", "origin", f"https://github.com/{repo}")
    try:
        # Trees only: sizes without downloading any file
        run("git", "-C", str(d), "fetch", "-q", "--depth", "1", "--filter=blob:none", "origin", want)
    except subprocess.CalledProcessError:
        return None
    sizes = {}
    for line in run("git", "-C", str(d), "ls-tree", "-r", "-l", "FETCH_HEAD").splitlines():
        meta, path = line.split("\t", 1)
        parts = meta.split()
        if parts[1] == "blob" and re.search(r"\.part\d+$", path):
            sizes[path] = int(parts[3])
    return sizes


def main():
    with tempfile.TemporaryDirectory() as tmp:
        pages = {}
        pinned = json.loads((ROOT / "config/library-pinned.json").read_text())["files"]
        print(f"Reading {len(pinned)} library pages…")
        pages.update(pages_from_repo(tmp, "freebuisness/html", LIB_REF, pinned))
        for f in sorted((ROOT / "washed").glob("*.html")):
            pages[f"washed:{f.name}"] = f.read_text(encoding="utf8")
        for gid, w in json.loads((ROOT / "config/library-washed.json").read_text()).get("games", {}).items():
            m = re.match(r"gh:([\w.-]+/[\w.-]+)@([0-9a-f]{40})/(.+)$", w.get("url") or "")
            if m:  # page used straight from a repo: count the repo it's in
                pages[f"washed-gh:{gid}"] = f'<base href="https://cdn.jsdelivr.net/gh/{m.group(1)}@{m.group(2)}/{m.group(3).rsplit("/", 1)[0] + "/" if "/" in m.group(3) else ""}">'
        ub = json.loads((ROOT / "config/ubzone-games.json").read_text())
        ub_paths = sorted({g["path"] for g in ub["games"] if g.get("path")})
        print(f"Reading {len(ub_paths)} UBZone pages…")
        pages.update(pages_from_repo(tmp, ub["repo"], ub["ref"], ub_paths))

        targets = set()
        for html in pages.values():
            if SPLIT_HINT.search(html):
                targets |= repo_refs(html)
        print(f"{sum(1 for h in pages.values() if SPLIT_HINT.search(h))} pages load split files from {len(targets)} repo versions", flush=True)

        # Files over jsDelivr's 20 MB limit, in every repo a game page loads from:
        # the site gets these from GitHub or githack instead (bigFile in partGuardHook)
        big = {}
        if os.environ.get("GITHUB_TOKEN"):
            every = set()
            for html in pages.values():
                every |= repo_refs(html)
            print(f"Looking for files over 20 MB in {len(every)} repo versions…", flush=True)
            for repo, ref in sorted(every):
                sizes = tree_sizes_api(repo, "HEAD" if ref in ("latest", "HEAD") else ref) or {}
                over = sorted(p for p, n in sizes.items() if n > 20 * 1024 * 1024)
                if over:
                    big[f"{repo}@{ref}"] = over
        else:
            print("No GITHUB_TOKEN: skipping the over-20 MB list (it needs GitHub's API)")

        manifest = {}
        for repo, ref in sorted(targets):
            sizes = part_sizes(tmp, repo, ref)
            if sizes:
                manifest[f"{repo}@{ref}"] = sizes
            print(f"  {repo}@{ref}: {len(sizes or {})} pieces", flush=True)
    if not big and OUT.exists():  # keep the last list if this run couldn't make one
        try: big = json.loads(OUT.read_text()).get("big", {})
        except Exception: pass
    OUT.write_text(json.dumps({"libraryRef": LIB_REF, "repos": manifest, "big": big}, separators=(",", ":"), sort_keys=True) + "\n")
    print(f"Wrote {OUT.relative_to(ROOT)}: {sum(len(v) for v in manifest.values())} pieces, {sum(len(v) for v in big.values())} files over 20 MB, {OUT.stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()
