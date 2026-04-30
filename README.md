# Gn-2.0

New and improved.

## Recommended improvements

Based on the current `index.html`, here are the highest-impact improvements to prioritize.

### 1) Split the single-page file into modules
`index.html` currently contains markup, styles, and a large amount of inline JavaScript in one file. Splitting into `styles.css` and feature-focused JS modules (search, zones, settings, popup, stats) would improve maintainability and reduce regression risk.

### 2) Add a stronger security baseline
The app performs many `innerHTML` assignments and loads external content/scripts. Add a Content Security Policy (CSP), prefer `textContent` where HTML is not required, and centralize sanitization for dynamic rendering paths.

### 3) Improve accessibility
Add semantic landmarks, ensure keyboard focus visibility across controls, and provide accessible labels/ARIA text for icon-only buttons and popup controls.

### 4) Reduce intrusive navigation prompts
The current `beforeunload` prompt is globally attached at load time. Only register this prompt when there are true unsaved changes to avoid unnecessary user friction.

### 5) Harden data export/import
The app supports saving and loading browser state. Add file schema versioning, explicit validation error messaging, and bounds checks for imported data before writing into storage.

### 6) Optimize performance and bundle weight
Inline CSS/JS blocks are large. Minify, split, and cache static assets; defer non-critical scripts; and avoid repeatedly rebuilding large DOM subtrees when filtering/sorting.

### 7) Improve observability and error handling
Several async flows show generic errors. Add structured logging hooks, user-friendly error states, and retry options for zone loading and stats requests.

### 8) Expand quality gates
Add linting and formatting (`eslint`, `prettier`), basic browser smoke tests, and a lightweight CI workflow to enforce checks on every change.
