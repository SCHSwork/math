#!/usr/bin/env python3
"""Keep the site's own copies of the common libraries games load from CDNs.

Some games load jQuery, JSZip, Phaser, p5 and so on from code.jquery.com,
cdnjs, ajax.googleapis.com, jsDelivr or unpkg. When a school filter blocks one
of those (or it's down), the game stops at a black screen or "$ is not
defined". The site serves these from vendor/libs/ instead (useLocalLibs in
js/app.js), which loads from wherever the site itself loads.

The copies are the exact published files: jQuery and jQuery UI from jQuery's
own CDN repo (jquery/codeorigin.jquery.com, pinned below), everything else
from npm (checked against npm's published hash). Nothing is rebuilt.

Writes vendor/libs/<name>@<version>/<file> and config/local-libs.json
(CDN address → copy). To add a library, add a line to LIBS and run:
    python3 tools/vendor_libs.py
"""
import base64, hashlib, io, json, os, pathlib, ssl, tarfile, urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "vendor" / "libs"
MAP = ROOT / "config" / "local-libs.json"
JQ = "https://raw.githubusercontent.com/jquery/codeorigin.jquery.com/9aa323d1dec3661e8b1ef10664fa4fcd6f9da925/cdn/"

# (copy name, source, [file, extra files…], [CDN addresses it replaces])
# source "jq:<path>" is jQuery's CDN repo; "npm:<pkg>@<ver>" is an npm package.
# npm packages are also matched on every jsDelivr npm address and unpkg.
def jquery(v, cdn_v=None):
    cdn_v = cdn_v or v
    return (f"jquery@{v}", f"jq:jquery-{cdn_v}.min.js", ["jquery.min.js"], [
        f"code.jquery.com/jquery-{cdn_v}.min.js", f"code.jquery.com/jquery-{v}.min.js",
        f"ajax.googleapis.com/ajax/libs/jquery/{v}/jquery.min.js",
        f"cdnjs.cloudflare.com/ajax/libs/jquery/{v}/jquery.min.js",
        f"npm/jquery@{v}/dist/jquery.min.js"])

LIBS = [
    jquery("1.4.4"), jquery("1.6.0", "1.6"), jquery("1.8.3"), jquery("1.10.1"), jquery("2.1.1"), jquery("2.2.0"),
    jquery("3.2.1"), jquery("3.3.1"), jquery("3.4.1"), jquery("3.6.0"),
    ("jquery-ui@1.10.3", "jq:ui/1.10.3/jquery-ui.min.js", ["jquery-ui.min.js"], [
        "ajax.googleapis.com/ajax/libs/jqueryui/1.10.3/jquery-ui.min.js", "code.jquery.com/ui/1.10.3/jquery-ui.min.js",
        "cdnjs.cloudflare.com/ajax/libs/jqueryui/1.10.3/jquery-ui.min.js"]),
    ("jszip@3.10.1", "npm:jszip@3.10.1", ["dist/jszip.min.js"], ["cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js"]),
    ("phaser@3.22.0", "npm:phaser@3.22.0", ["dist/phaser.min.js", "dist/phaser-arcade-physics.min.js"], []),
    ("phaser@3.90.0", "npm:phaser@3.90.0", ["dist/phaser.min.js"], []),
    ("p5@1.6.0", "npm:p5@1.6.0", ["lib/p5.js", "lib/p5.min.js", "lib/addons/p5.sound.min.js"], [
        "cdnjs.cloudflare.com/ajax/libs/p5.js/1.6.0/p5.js=lib/p5.js", "cdnjs.cloudflare.com/ajax/libs/p5.js/1.6.0/p5.min.js=lib/p5.min.js",
        "cdnjs.cloudflare.com/ajax/libs/p5.js/1.6.0/addons/p5.sound.min.js=lib/addons/p5.sound.min.js"]),
    ("nipplejs@0.9.0", "npm:nipplejs@0.9.0", ["dist/nipplejs.js"], ["cdnjs.cloudflare.com/ajax/libs/nipplejs/0.9.0/nipplejs.min.js"]),
    ("nipplejs@0.10.0", "npm:nipplejs@0.10.0", ["dist/nipplejs.js"], ["cdnjs.cloudflare.com/ajax/libs/nipplejs/0.10.0/nipplejs.min.js"]),
    ("jquery-ui-touch-punch@0.2.3", "npm:jquery-ui-touch-punch@0.2.3", ["jquery.ui.touch-punch.min.js"], [
        "cdnjs.cloudflare.com/ajax/libs/jqueryui-touch-punch/0.2.3/jquery.ui.touch-punch.min.js"]),
    ("kaboom@2001.0.0-alpha.21", "npm:kaboom@2001.0.0-alpha.21", ["dist/kaboom.js"], []),
    ("underscore@1.13.6", "npm:underscore@1.13.6", ["underscore-min.js"], ["cdnjs.cloudflare.com/ajax/libs/underscore.js/1.13.6/underscore-min.js"]),
    ("pxloader-browserify@1.0.2", "npm:pxloader-browserify@1.0.2", ["dist/pxloader-all.min.js"], []),
    ("three@0.134.0", "npm:three@0.134.0", ["build/three.min.js"], ["cdnjs.cloudflare.com/ajax/libs/three.js/r134/three.min.js"]),
    ("pixi.js@8.22.0", "npm:pixi.js@8.22.0", ["dist/pixi.min.js"], []),
    ("pako@2.1.0", "npm:pako@2.1.0", ["dist/pako.min.js"], ["cdnjs.cloudflare.com/ajax/libs/pako/2.1.0/pako.min.js"]),
    ("file-saver@2.0.2", "npm:file-saver@2.0.2", ["dist/FileSaver.min.js"], ["cdnjs.cloudflare.com/ajax/libs/FileSaver.js/2.0.2/FileSaver.min.js"]),
    ("popper.js@1.12.9", "npm:popper.js@1.12.9", ["dist/umd/popper.min.js"], ["cdnjs.cloudflare.com/ajax/libs/popper.js/1.12.9/umd/popper.min.js"]),
    ("rivets@0.9.6", "npm:rivets@0.9.6", ["dist/rivets.bundled.min.js"], ["cdnjs.cloudflare.com/ajax/libs/rivets/0.9.6/rivets.bundled.min.js"]),
    # The stylesheet loads its fonts from ../fonts/, so those come along
    ("font-awesome@4.7.0", "npm:font-awesome@4.7.0", ["css/font-awesome.min.css", "fonts/*"], [
        "cdnjs.cloudflare.com/ajax/libs/font-awesome/4.7.0/css/font-awesome.min.css",
        "maxcdn.bootstrapcdn.com/font-awesome/4.7.0/css/font-awesome.min.css",
        "stackpath.bootstrapcdn.com/font-awesome/4.7.0/css/font-awesome.min.css"]),
    ("bootstrap@5.1.3", "npm:bootstrap@5.1.3", ["dist/css/bootstrap.min.css"], []),
]

ctx = ssl.create_default_context()
if os.path.exists("/root/.ccr/ca-bundle.crt"):
    ctx = ssl.create_default_context(cafile="/root/.ccr/ca-bundle.crt")


def get(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "gn2-vendor-libs"}), timeout=120, context=ctx) as r:
        return r.read()


def npm_files(spec):
    name, ver = spec.rsplit("@", 1)
    meta = json.loads(get(f"https://registry.npmjs.org/{name.replace('/', '%2f')}/{ver}"))
    tgz = get(meta["dist"]["tarball"])
    algo, want = meta["dist"]["integrity"].split("-", 1)
    if base64.b64encode(hashlib.new(algo, tgz).digest()).decode() != want:
        raise SystemExit(f"{spec}: download doesn't match npm's published hash")
    out = {}
    with tarfile.open(fileobj=io.BytesIO(tgz)) as t:
        for m in t.getmembers():
            if m.isfile():
                out[m.name.split("/", 1)[1]] = t.extractfile(m).read()
    return out


def main():
    mapping = {}
    for copy, src, files, cdns in LIBS:
        dest = OUT / copy
        if src.startswith("jq:"):
            data = {files[0]: get(JQ + src[3:])}
        else:
            pkg = npm_files(src[4:])
            data = {}
            for f in files:
                if f.endswith("/*"):
                    data.update({k: v for k, v in pkg.items() if k.startswith(f[:-1]) and "/" not in k[len(f) - 1:]})
                else:
                    data[f] = pkg[f]
        for f, b in data.items():
            p = dest / f
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_bytes(b)
        main_file = files[0]
        local = lambda f: f"{copy}/{f}"
        if src.startswith("npm:"):
            for f in files:
                if not f.endswith("/*"):
                    mapping[f"npm/{src[4:]}/{f}"] = local(f)
        for c in cdns:
            addr, _, f = c.partition("=")
            mapping[addr] = local(f or main_file)
        print(f"{copy}: {', '.join(sorted(data))}")
    MAP.write_text(json.dumps({"v": 1, "libs": dict(sorted(mapping.items()))}, indent=0) + "\n")
    print(f"{len(mapping)} CDN addresses → {len(LIBS)} local copies")


if __name__ == "__main__":
    main()
