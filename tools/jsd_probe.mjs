// Which GitHub repos jsDelivr won't serve at all (a whole repo over its size
// limit gets an error for every file, even tiny ones). For each repo it asks
// jsDelivr for one small file; a refusal there means the whole repo is refused
// and belongs in JSD_REFUSED_REPOS in js/app.js. A big file alone being
// refused (over 20 MB) isn't counted: the site already splits those.
//   REPOS="owner/repo owner2/repo2" node tools/jsd_probe.mjs
const repos = String(process.env.REPOS || "").split(/[\s,]+/).filter(r => /^[\w.-]+\/[\w.-]+$/.test(r));
const H = { "User-Agent": "gn-jsd-probe", Accept: "application/vnd.github+json" };
if (process.env.GITHUB_TOKEN) H.Authorization = "Bearer " + process.env.GITHUB_TOKEN;
const refused = [], ok = [], unknown = [];
for (const repo of repos) {
    try {
        const info = await (await fetch(`https://api.github.com/repos/${repo}`, { headers: H })).json();
        if (!info.default_branch) { unknown.push(`${repo} (GitHub: ${info.message || "?"})`); continue; }
        const head = await (await fetch(`https://api.github.com/repos/${repo}/commits/${info.default_branch}`, { headers: H })).json();
        const tree = await (await fetch(`https://api.github.com/repos/${repo}/git/trees/${head.sha}?recursive=1`, { headers: H })).json();
        const small = (tree.tree || []).filter(t => t.type === "blob" && t.size > 0 && t.size < 200000).sort((a, b) => a.size - b.size)[0];
        const total = (tree.tree || []).reduce((n, t) => n + (t.size || 0), 0);
        if (!small) { unknown.push(`${repo} (no small file)`); continue; }
        const url = `https://cdn.jsdelivr.net/gh/${repo}@${head.sha}/${small.path.split("/").map(encodeURIComponent).join("/")}`;
        const res = await fetch(url);
        const body = res.ok ? "" : (await res.text()).slice(0, 120).replace(/\s+/g, " ");
        console.log(`${repo}: HTTP ${res.status} for ${small.path} (${small.size} B), repo ${(total / 1e6).toFixed(0)} MB ${body}`);
        (res.ok ? ok : refused).push(repo);
    } catch (e) { unknown.push(`${repo} (${e.message})`); }
}
console.log(`\nRefused by jsDelivr (${refused.length}): ${refused.join(" ") || "none"}`);
console.log(`Served (${ok.length}): ${ok.join(" ")}`);
if (unknown.length) console.log(`Couldn't check: ${unknown.join("; ")}`);
