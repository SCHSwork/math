// Quick test of the site, run on every push (.github/workflows/smoke-test.yml):
// it loads, search works, a game opens, and the parts that load on demand
// (js/lazy.js, the Admin Panel) load and run without errors.
//   node tools/smoke_test.mjs      # with the site served at SITE_URL
import { launchBrowser, newContext } from "./test_browser.mjs";

const SITE = process.env.SITE_URL || "http://127.0.0.1:8080/";
const browser = await launchBrowser();
const ctx = await newContext(browser);
const page = await ctx.newPage();

// Errors from the site's own files (a game's own errors don't count)
const errors = [];
page.on("pageerror", e => { const where = String(e.stack || e.message); if (!/jsdelivr|githack|githubusercontent|blob:|about:/.test(where)) errors.push(where.slice(0, 300)); });
page.on("response", r => { if (r.status() >= 400 && r.url().startsWith(SITE)) errors.push(`HTTP ${r.status()} ${r.url()}`); });

let failed = 0;
async function step(name, fn) {
    errors.length = 0;
    try {
        await fn();
        await page.waitForTimeout(500);
        if (errors.length) throw new Error(errors.join("\n    "));
        console.log(`ok    ${name}`);
    } catch (e) {
        failed++;
        console.log(`FAIL  ${name}\n    ${String(e.message).split("\nCall log")[0]}`);
    }
}
const wait = (fn, arg) => page.waitForFunction(fn, arg, { timeout: 60000 });
const cards = () => page.evaluate(() => document.querySelectorAll(".zone-item").length);

await step("the site loads with its game list", async () => {
    await page.goto(SITE, { timeout: 90000, waitUntil: "domcontentloaded" });
    await wait(() => typeof zones !== "undefined" && zones.length > 500);
    await wait(() => document.querySelectorAll(".zone-item").length > 20);
    if (await page.evaluate(() => !!window.GN_BOT)) throw new Error("got the bot page");
});

await step("search finds a game", async () => {
    const before = await cards();
    await page.click("#searchBar");
    await page.keyboard.type("slope", { delay: 30 });
    await wait(n => { const c = document.querySelectorAll(".zone-item").length; return c > 0 && c !== n; }, before);
    await page.fill("#searchBar", "");
    await page.evaluate(() => filterZones());
});

await step("a game opens and closes", async () => {
    await page.evaluate(() => openZone(zones.find(z => /^2048$/i.test(z.name)) || zones.find(z => Number(z.id) > 0 && z.url && !z.newTab)));
    await wait(() => document.getElementById("zoneViewer").style.display === "flex");
    await wait(() => { const d = document.getElementById("zoneFrame")?.contentDocument; return d && d.body && d.body.children.length > 0; });
    errors.length = 0;   // anything so far may be the game's own
    await page.evaluate(() => closeZone());
});

// Each file loaded on demand, used the way the site does it: by calling its
// stand-in (js/lazy.js), which loads the file and then runs the real function
for (const [file, fn, args] of [["feedback", "openFeedback", []], ["submit", "openSubmitGame", []],
    ["identify", "gnShowIdentify", [{ c: "red", n: 7, until: Date.now() + 3000 }]]]) {
    await step(`js/${file}.js loads when ${fn} is used`, async () => {
        const problem = await page.evaluate(async ([fn, args]) => {
            const stub = window[fn];
            if (typeof stub !== "function") return `${fn} has no stand-in in js/lazy.js`;
            await stub(...args);
            return window[fn] === stub ? `${fn} wasn't replaced by the real one` : "";
        }, [fn, args]);
        if (problem) throw new Error(problem);
    });
}

await step("the Owner Panel draws", async () => {
    const before = await page.evaluate(() => document.body.innerHTML.length);
    if (!await page.evaluate(() => typeof renderOwnerPanel === "function")) throw new Error("renderOwnerPanel has no stand-in in js/lazy.js");
    await page.evaluate(() => renderOwnerPanel());
    await wait(n => document.body.innerHTML.length > n + 3000, before);
});

await step("the Admin Panel loads", async () => {
    await page.evaluate(() => loadAdminPanel());
});

await browser.close();
console.log(failed ? `${failed} step(s) failed` : "All good");
process.exit(failed ? 1 : 0);
