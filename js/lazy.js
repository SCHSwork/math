// ════════════════════════════════════════════════════════════════════════════
// Parts of the site most visits never use are downloaded the first time they're
// needed. Each function below stands in for the real one: it loads the file,
// which replaces it, then calls the real one. The files' versions are the
// <meta name="gn-lazy-js"> tags in index.html (tools/stamp_versions.py).
// ════════════════════════════════════════════════════════════════════════════
const gnLoaded = {};
function gnLoad(name) {
    if (!gnLoaded[name]) {
        gnLoaded[name] = new Promise((resolve, reject) => {
            const meta = document.querySelector(`meta[name="gn-lazy-js"][data-src^="js/${name}.js"]`);
            const s = document.createElement("script");
            s.src = (meta && meta.dataset.src) || `js/${name}.js`;
            s.onload = resolve;
            s.onerror = () => { delete gnLoaded[name]; s.remove(); reject(new Error(`couldn't load ${name}.js`)); };
            document.body.appendChild(s);
        });
    }
    return gnLoaded[name];
}

// Runs the real function once its file is in. `what` names it in the message
// shown if the download fails (leave it out to fail quietly).
function gnLazy(file, fn, what) {
    const stub = function (...args) {
        return gnLoad(file)
            .then(() => { if (window[fn] !== stub) return window[fn](...args); })
            .catch(e => {
                if (what) notify(`Couldn't open ${what}. Check your connection and try again.`, { type: "error" });
                else console.warn(e);
            });
    };
    window[fn] = stub;
}

gnLazy("owner", "renderOwnerPanel", "the Owner Panel");
gnLazy("feedback", "openFeedback", "the report form");
gnLazy("feedback", "openIdeasBoard", "the ideas list");
gnLazy("submit", "openSubmitGame", "the submit form");
gnLazy("submit", "renderOwnerSubmissions");
// Find screen, jumpscares and pranks sent by an admin (js/realtime.js)
gnLazy("identify", "gnShowIdentify");
gnLazy("identify", "gnJumpscare");
gnLazy("identify", "gnTroll");
// Nothing to hide unless the file was already asked for
window.gnHideIdentify = function stub() {
    if (gnLoaded.identify) gnLoaded.identify.then(() => { if (window.gnHideIdentify !== stub) window.gnHideIdentify(); });
};
