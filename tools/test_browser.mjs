// The browser the site's own tests use (tools/check_games.mjs, tools/smoke_test.mjs).
//
// The bot check at the top of index.html shows automated browsers a math
// practice page instead of the site, so a test browser has to look like an
// ordinary one. This is done here, in the test, so the site's check stays as
// strict for everyone else. Tests also never talk to the database or the GN 2.0
// Server, so they don't show up as players or add to play counts.
import { chromium } from "playwright";

export const BLOCK = /(^|\.)(firestore\.googleapis\.com|firebase\w*\.googleapis\.com|identitytoolkit\.googleapis\.com|securetoken\.googleapis\.com|firebaseinstallations\.googleapis\.com|google-analytics\.com|googletagmanager\.com|learnresearch\.org)$/;

export const launchBrowser = () => chromium.launch({
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
    // Software WebGL, so 3D games can draw without a graphics card
    args: ["--autoplay-policy=no-user-gesture-required", "--mute-audio", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"]
});

export async function newContext(browser, options = {}) {
    const version = browser.version().split(".")[0];
    const ctx = await browser.newContext({
        viewport: { width: 1280, height: 720 },
        userAgent: `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${version}.0.0.0 Safari/537.36`,
        ...options
    });
    await ctx.addInitScript(() => { Object.defineProperty(Navigator.prototype, "webdriver", { get: () => false, configurable: true }); });
    await ctx.route(url => BLOCK.test(new URL(url).hostname), r => r.abort());
    return ctx;
}
