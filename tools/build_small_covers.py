#!/usr/bin/env python3
"""Make small copies of the game covers (covers-small/ + config/small-covers.json).

Many covers are huge for the box they're shown in (the median library cover
is about 200 KB, almost 100 are over 1 MB and one is 12 MB, for a card about
250 px wide). This makes a copy of each one that is only made smaller:

  * scaled down with Lanczos resampling so the longest side is at most 640 px
    (never enlarged, never cropped, no filters, colors and transparency kept)
  * saved as WebP: lossy only when it can't be told apart from the scaled
    picture (PSNR of 40 dB or more), otherwise lossless
  * animated covers are left alone, and a copy is only used when it's at least
    15% smaller than the original

The site (coverSources in js/app.js) loads the copy first, from the site
itself, and falls back to the original. Covers are looked up by a short hash of
where they come from ("owner/repo@ref/path"); smallCoverHash in js/app.js
computes the same hash.

Covers on a branch (the library's covers are on main) can change, so each run
checks every cover's ETag and redoes the ones that changed. Runs daily from
.github/workflows/small-covers.yml, or by hand:  python3 tools/build_small_covers.py
"""
import concurrent.futures, hashlib, io, json, math, os, pathlib, re, ssl, sys, time, urllib.request

from PIL import Image, ImageChops, ImageOps, ImageStat

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "covers-small"
MANIFEST = ROOT / "config" / "small-covers.json"
STATE = ROOT / "tools" / "small-covers-state.json"
MAX_SIDE = 640
MIN_SAVING = 0.15          # use a copy only if it's at least this much smaller
ORIGINALS_MIN_BYTES = 60_000  # GN Originals covers are mostly tiny already
RAW = "https://raw.githubusercontent.com"

ctx = ssl.create_default_context()
if os.path.exists("/root/.ccr/ca-bundle.crt"):   # Claude's test machine; harmless elsewhere
    ctx = ssl.create_default_context(cafile="/root/.ccr/ca-bundle.crt")


def get(url, method="GET", tries=3):
    for i in range(tries):
        try:
            req = urllib.request.Request(url, method=method, headers={"User-Agent": "gn2-small-covers"})
            with urllib.request.urlopen(req, timeout=60, context=ctx) as r:
                return r.headers, (r.read() if method == "GET" else b"")
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None, None
            if i == tries - 1:
                raise
        except Exception:
            if i == tries - 1:
                raise
        time.sleep(2 * (i + 1))


def fnv(s, h=2166136261):
    """FNV-1a over UTF-16 code units, exactly like hashString() in js/library.js"""
    b = s.encode("utf-16-le")
    for i in range(0, len(b), 2):
        h ^= b[i] | (b[i + 1] << 8)
        h = (h * 16777619) & 0xFFFFFFFF
    return h


def key_hash(key):
    return f"{fnv(key):08x}{fnv('gn2-cover:' + key):08x}"


def raw_url(key):
    m = re.match(r"^([\w.-]+)/([\w.-]+)@([\w.-]+)/(.+)$", key)
    return f"{RAW}/{m[1]}/{m[2]}/{m[3]}/{m[4]}"


# ── Which covers there are ──────────────────────────────────────────────────
def cover_keys():
    keys = {}
    # The game library: "{COVER_URL}/12.png" is freebuisness/covers@main/12.png
    _, body = get(f"{RAW}/freebuisness/assets/main/zones.json")
    for z in json.loads(body):
        c = z.get("cover") or ""
        if c.startswith("{COVER_URL}/"):
            keys["freebuisness/covers@main/" + c[len("{COVER_URL}/"):]] = 0
    lib = len(keys)
    # UBZone (config/ubzone-games.json): a path in its repo, or owner/repo@sha/path
    ub = json.loads((ROOT / "config" / "ubzone-games.json").read_text(encoding="utf-8"))
    for g in ub.get("games", []):
        c = g.get("cover")
        if c:
            keys[c if re.search(r"@[0-9a-f]{40}/", c) else f"{ub['repo']}@{ub['ref']}/{c.lstrip('/')}"] = 0
    ubn = len(keys) - lib
    # GN Originals: only the big ones (most are a few KB)
    _, body = get(f"{RAW}/SCHSwork/GN-originals/main/games.json")
    j = json.loads(body)
    orig = 0
    for g in (j if isinstance(j, list) else j.get("games", [])):
        if g.get("cover"):
            keys["SCHSwork/GN-originals@main/" + g["cover"].lstrip("/")] = ORIGINALS_MIN_BYTES
            orig += 1
    print(f"{lib} library, {ubn} UBZone and {orig} GN Originals covers")
    return keys


# ── Making one copy ─────────────────────────────────────────────────────────
def psnr(a, b):
    st = ImageStat.Stat(ImageChops.difference(a, b))
    mse = sum(v * v for v in st.rms) / len(st.rms)
    return 99.0 if mse == 0 else 10 * math.log10(255 * 255 / mse)


def shrink(data):
    """The smaller copy as WebP bytes, or None if there's no point."""
    im = Image.open(io.BytesIO(data))
    if getattr(im, "n_frames", 1) > 1:
        return None                     # animated: leave it as it is
    icc = im.info.get("icc_profile")
    im = ImageOps.exif_transpose(im)    # browsers turn photos the way EXIF says too
    mode = "RGBA" if ("A" in im.getbands() or "transparency" in im.info) else "RGB"
    im = im.convert(mode)
    im.thumbnail((MAX_SIDE, MAX_SIDE), Image.LANCZOS)   # keeps the shape; never enlarges
    extra = {"icc_profile": icc} if icc else {}
    best = None
    for q in (90, 95):
        out = io.BytesIO()
        im.save(out, "WEBP", quality=q, method=6, **extra)
        back = Image.open(io.BytesIO(out.getvalue())).convert(mode)
        if psnr(im.convert("RGB"), back.convert("RGB")) >= 40:
            best = out.getvalue()
            break
    if best is None:
        out = io.BytesIO()
        im.save(out, "WEBP", lossless=True, quality=100, method=6, **extra)
        best = out.getvalue()
    return best if len(best) <= len(data) * (1 - MIN_SAVING) else None


def main():
    OUT_DIR.mkdir(exist_ok=True)
    state = json.loads(STATE.read_text()) if STATE.exists() else {}
    keys = cover_keys()

    def check(key):
        try:
            h, _ = get(raw_url(key), method="HEAD")
            if h is None:
                return key, None, "missing"
            etag = (h.get("ETag") or "").strip('"') or h.get("Content-Length")
            size = int(h.get("Content-Length") or 0)
            old = state.get(key)
            out_ok = old and (old.get("out") is None or (OUT_DIR / f"{old['out']}.webp").exists())
            if old and old.get("etag") == etag and out_ok:
                return key, old, "same"
            if size and size < keys[key]:
                return key, {"etag": etag, "in": size, "out": None}, "small"
            _, data = get(raw_url(key))
            small = shrink(data)
            entry = {"etag": etag, "in": len(data), "out": None}
            if small:
                name = key_hash(key)
                (OUT_DIR / f"{name}.webp").write_bytes(small)
                entry.update(out=name, size=len(small), v=hashlib.sha1(small).hexdigest()[:8])
            return key, entry, "made"
        except Exception as e:
            return key, state.get(key), f"error: {e}"

    counts = {}
    new_state = {}
    with concurrent.futures.ThreadPoolExecutor(12) as ex:
        for key, entry, what in ex.map(check, sorted(keys)):
            counts[what.split(":")[0]] = counts.get(what.split(":")[0], 0) + 1
            if what.startswith("error"):
                print(f"  {key}: {what}", file=sys.stderr)
            if entry:
                new_state[key] = entry
    # Copies whose cover is gone or no longer worth it
    keep = {e["out"] for e in new_state.values() if e.get("out")}
    for f in OUT_DIR.glob("*.webp"):
        if f.stem not in keep:
            f.unlink()
    STATE.write_text(json.dumps(new_state, indent=0, sort_keys=True) + "\n")
    covers = {e["out"]: e["v"] for e in new_state.values() if e.get("out")}
    MANIFEST.write_text(json.dumps({"v": 1, "max": MAX_SIDE, "covers": dict(sorted(covers.items()))}, separators=(",", ":")) + "\n")
    before = sum(e["in"] for e in new_state.values() if e.get("out"))
    after = sum(e["size"] for e in new_state.values() if e.get("out"))
    print(f"Done: {counts}. {len(covers)} small copies: {before / 1e6:.1f} MB of covers -> {after / 1e6:.1f} MB")


if __name__ == "__main__":
    main()
