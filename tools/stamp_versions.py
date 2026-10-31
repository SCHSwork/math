#!/usr/bin/env python3
"""Add/refresh ?v=<hash> on the CSS and JS links in index.html.

Also fills in the version map for the site style files in css/skins/.

Run this after editing any file in css/ or js/ so browsers load the new
version right away instead of a cached copy:  python3 tools/stamp_versions.py
"""
import hashlib, json, pathlib, re

root = pathlib.Path(__file__).resolve().parent.parent
index = root / "index.html"
html = index.read_text(encoding="utf-8")

def stamp(match):
    attr, path = match.group(1), match.group(2)
    file = root / path
    if not file.exists():
        return match.group(0)
    digest = hashlib.sha1(file.read_bytes()).hexdigest()[:10]
    return f'{attr}="{path}?v={digest}"'

# data-src: files the page loads later itself (e.g. the Admin Panel)
html = re.sub(r'(src|href|data-src)="((?:css|js)/[^"?]+)(?:\?v=[0-9a-f]+)?"', stamp, html)
# Site style files are loaded by a script in index.html, which reads this map
skins = {f.stem: hashlib.sha1(f.read_bytes()).hexdigest()[:10] for f in sorted((root / "css/skins").glob("*.css"))}
html = re.sub(r"/\*SKIN_CSS_VERSIONS\*/.*?/\*END\*/", lambda m: "/*SKIN_CSS_VERSIONS*/" + json.dumps(skins, separators=(",", ":")) + "/*END*/", html, flags=re.S)
index.write_text(html, encoding="utf-8")
print("Stamped asset versions in index.html")
