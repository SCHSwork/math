#!/usr/bin/env python3
"""Washes game-library games that were added after the clean pinned version.

For each game id given (or every new one if none are given) it:
  1. downloads the game's page from the library's newest version,
  2. removes the malicious ad loader (obfuscated, loads cdn.r9x.in) and trackers,
  3. downloads the code of every outside repo the page loads its game from and
     checks it for that script, ad hosts and obfuscated code,
  4. locks those repos to the exact commit it checked (no @main / @latest),
  5. saves the page to washed/<id>.html and lists it in config/library-washed.json.

If anything looks wrong it stops without saving that game. Check the result,
then commit. Needs git and network access to GitHub.

    python3 tools/wash_library_games.py            # every unhandled new game
    python3 tools/wash_library_games.py 878 879    # just these
"""
import hashlib, json, os, pathlib, re, subprocess, sys, tempfile, urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
WASHED_JSON = ROOT / "config/library-washed.json"
BAD = re.compile(r"r9x\.in|data-r=.c7a94e|xa0f20fba9693cbb2c66516f1|__gnGameAd", re.I)
ADS = re.compile(r"r9x\.in|googlesyndication|doubleclick\.net|adsterra|propellerads|popads\.net|highperformanceformat|effectivegatecpm|profitableratecpm|ezblock", re.I)
TRACK = re.compile(r"googletagmanager\.com|google-analytics\.com|cloudflareinsights\.com|gtag\(", re.I)


def get(url):
    return urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "gn-wash"}), timeout=60).read()


def obfuscated(code):
    return "r9x" in code or (code.count("parseInt(0x") >= 25 and re.search(
        r'\(\(\(\.\+\)\+\)\+\)\+\$|randomUUID|new TextDecoder|\.constructor\("return this"\)', code))


def run(*args, **kw):
    return subprocess.run(args, capture_output=True, check=True, **kw)


def library_head():
    return run("git", "ls-remote", "https://github.com/freebuisness/html", "HEAD").stdout.decode().split()[0]


def new_games():
    pinned = json.loads((ROOT / "config/library-pinned.json").read_text())
    files = set(pinned["files"])
    washed = json.loads(WASHED_JSON.read_text()).get("games", {}) if WASHED_JSON.exists() else {}
    out = []
    for z in json.loads(get("https://raw.githubusercontent.com/freebuisness/assets/main/zones.json")):
        url, name = z.get("url") or "", str(z.get("name") or "").strip()
        if not url.startswith("{HTML_URL}") or not name or name.startswith("[!]"):
            continue
        f = re.sub(r"^\{HTML_URL\}/?", "", url)
        if f in files or any(re.match(rf"^{int(z['id'])}(?:[-.]|$)", x) for x in files):
            continue
        if washed.get(str(z["id"]), {}).get("file") == f:
            continue
        out.append({"id": int(z["id"]), "name": name, "file": f})
    return out


def scan_repo(repo, ref, sub, tmp):
    """Download the repo's code (not big data files) at ref and look for the bad script."""
    d = pathlib.Path(tmp) / repo.replace("/", "_")
    if not d.exists():
        run("git", "init", "-q", str(d))
        run("git", "-C", str(d), "remote", "add", "origin", f"https://github.com/{repo}")
    run("git", "-C", str(d), "fetch", "-q", "--depth", "1", "--filter=blob:limit=3m", "origin", ref)
    tree = run("git", "-C", str(d), "ls-tree", "-r", "-l", "FETCH_HEAD", "--", sub or ".").stdout.decode().splitlines()
    hits, scanned = [], 0
    for line in tree:
        meta, path = line.split("\t", 1)
        _, kind, sha, size = meta.split()
        if kind != "blob" or size == "-" or not re.search(r"\.(js|mjs|html?|json)$", path, re.I) or int(size) > 3 * 1024 * 1024:
            continue
        r = subprocess.run(["git", "-C", str(d), "cat-file", "-p", sha], capture_output=True, env={**os.environ, "GIT_NO_LAZY_FETCH": "1"})
        if r.returncode:
            continue
        code = r.stdout.decode("utf8", "replace")
        scanned += 1
        if ADS.search(code) or BAD.search(code):
            hits.append(f"{path} ({(ADS.search(code) or BAD.search(code)).group(0)})")
        elif obfuscated(code):
            hits.append(f"{path} (obfuscated)")
    return scanned, hits


def wash(game, lib_ref, tmp):
    raw = get(f"https://raw.githubusercontent.com/freebuisness/html/{lib_ref}/{game['file']}").decode("utf8")
    removed = []

    def strip(m):
        attrs, code = m.group(1), m.group(2)
        src = (re.search(r'src=["\']([^"\']+)', attrs) or [None, None])[1]
        if src and (TRACK.search(src) or ADS.search(src)):
            removed.append("tracker/ad " + re.sub(r"\?.*", "", src)[:60]); return ""
        if not src and obfuscated(code):
            removed.append(f"obfuscated ad loader ({len(code) // 1024} KB)"); return ""
        if not src and TRACK.search(code) and len(code) < 1500:
            removed.append("tracker setup"); return ""
        return m.group(0)

    page = re.sub(r"<script\b([^>]*)>([\s\S]*?)</script\s*>", strip, raw, flags=re.I)

    locked, problems = {}, []

    def lock(m):
        repo, ref, rest = m.group(1), m.group(2), m.group(3)
        sha = ref[1:] if ref and re.fullmatch(r"[0-9a-f]{40}", ref[1:]) else None
        if not sha:
            out = run("git", "ls-remote", f"https://github.com/{repo}", f"refs/heads/{ref[1:]}" if ref and ref[1:] not in ("latest",) else "HEAD").stdout.decode().split()
            if not out:
                problems.append(f"can't find {repo}{ref or ''}"); return m.group(0)
            sha = out[0]
        locked[repo] = sha
        return f"https://cdn.jsdelivr.net/gh/{repo}@{sha}{rest}"

    page = re.sub(r"https://cdn\.jsdelivr\.net/gh/([A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+)(@[A-Za-z0-9_.-]+)?(/)", lock, page)

    # Scan the folder the page uses from each repo (the deepest folder all its
    # links share), so a huge repo of many games isn't downloaded whole
    for repo, sha in locked.items():
        paths = re.findall(rf"cdn\.jsdelivr\.net/gh/{re.escape(repo)}@{sha}/([^\"'\s)]*)", page)
        dirs = [p.rsplit("/", 1)[0] if "/" in p else "" for p in paths]
        sub = os.path.commonpath(dirs) if dirs and all(dirs) else ""
        scanned, hits = scan_repo(repo, sha, sub, tmp)
        if hits:
            problems.append(f"{repo}@{sha[:7]}: " + "; ".join(hits[:5]))
        print(f"    checked {scanned} code files in {repo}@{sha[:7]}" + (f"/{sub}" if sub else ""))

    if BAD.search(page) or "r9x" in page:
        problems.append("the bad script is still in the page")
    if any(obfuscated(c) for c in re.findall(r"<script\b[^>]*>([\s\S]*?)</script", page, re.I)):
        problems.append("obfuscated code left in the page")
    if re.search(r"cdn\.jsdelivr\.net/gh/[^\"'\s]+?@(?:main|master|latest)/", page):
        problems.append("a game source isn't locked to a commit")
    for host in sorted(set(re.findall(r"<script[^>]+src=[\"']https?://([^/\"']+)", page))):
        if host not in ("cdn.jsdelivr.net",):
            problems.append(f"loads a script from {host}; check it by hand")
    if problems:
        return None, problems

    header = (f"<!-- Washed for GN 2.0 from the game library's {game['file']} (freebuisness/html {lib_ref[:7]}). "
              f"Removed: {', '.join(removed) or 'nothing'}. Game files locked to the commits checked. -->\n")
    page = header + page
    path = f"washed/{game['id']}.html"
    (ROOT / path).parent.mkdir(exist_ok=True)
    (ROOT / path).write_text(page, encoding="utf8")
    return {"name": game["name"], "file": game["file"], "path": path, "removed": removed, "lockedTo": locked,
            "sha256": hashlib.sha256(page.encode()).hexdigest()}, []


def main():
    lib_ref = library_head()
    todo = new_games()
    if len(sys.argv) > 1:
        want = {int(a) for a in sys.argv[1:]}
        todo = [g for g in todo if g["id"] in want]
    if not todo:
        print("Nothing to wash: every new library game is already handled.")
        return
    data = json.loads(WASHED_JSON.read_text()) if WASHED_JSON.exists() else {"games": {}}
    ok = 0
    with tempfile.TemporaryDirectory() as tmp:
        for g in todo:
            print(f"{g['id']} {g['name']} ({g['file']})")
            entry, problems = wash(g, lib_ref, tmp)
            if problems:
                print("  NOT WASHED: " + " | ".join(problems))
                continue
            data["games"][str(g["id"])] = entry
            ok += 1
            print(f"  washed → {entry['path']}; removed: {', '.join(entry['removed']) or 'nothing'}")
    data["washedFrom"] = lib_ref[:7]
    WASHED_JSON.write_text(json.dumps(data, indent=1) + "\n")
    print(f"\n{ok} of {len(todo)} washed. Check them, then commit washed/ and config/library-washed.json.")


if __name__ == "__main__":
    main()
