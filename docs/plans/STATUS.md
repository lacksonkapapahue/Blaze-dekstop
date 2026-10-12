# Blaze 1.0 status

Plan: [plan-v1.0-redesign.md](plan-v1.0-redesign.md). Each step is its own PR and version bump.

## Step 1 — BlazeRouter (PR #44, branch `blazerouter`) — IN PROGRESS
Done:
- internal/router: local OpenAI-compatible gateway on 127.0.0.1:20128 (OmniRoute port), dashboard assets, tests
- Rebased on main (v0.9.5)
- Every OmniRoute auto/* preset (auto/best-free, auto/best-coding, auto/chaos, auto/lkgp, … 37 + any auto/<category>:<tier>) with OmniRoute's weight packs, filters, LKGP stickiness and chaos fan-out
- Dashboard CSP: frame-ancestors limited to Blaze's webview

Left (in order):
- App integration (startup, Wails methods)
- Top-bar button, tray item, in-app dashboard view
- Model picker / `/model` from BlazeRouter
- Remove Settings › Models / Providers & keys (one "Manage models in BlazeRouter" button); keys migrate
- ci/mock.js + shots, JS tests, screenshots
- THIRD_PARTY_NOTICES, VERSION, README, CHANGELOG, plan-blazerouter.md

Next step: app integration in package main.

## Remaining steps after this PR
2. Redesign (part A)
3. Long-chat engine (part B)
4. Student pack (part C)
5. Marketer pack (part D)

## Resume notes (2026-10-12 12:50 CAT, head a9a68a5)
Pushed in a9a68a5: router_app.go (RouterInfo, RouterDashboardURL(page), OpenRouterDashboard, SetRouterOn, RouterPicker, a "router" event every 15s), the app.go/models.go/tray.go wiring, and frontend/dist/router.css (not yet linked). GOOS=windows build passes; vet and tests not re-run.

Where to hook in:
- Views: show(v,arg) is at app.js ~316. Register VIEWS.router (arg = dashboard page) and a SETTINGS_FNS section (SECTIONS ~1645).
- Model popover: modelPopover() at app.js ~203. Put BlazeRouter presets at the top.
- Repoint to show("router","providers"): app.js ~209, 231, 411, 797, 980 and composer.js ~141. Keep the old editors behind a "Classic editor" link.
- Dashboard deep link: DashboardURL appends &p=<page>, which internal/router/web/dash.js reads.
- Keys: the router reads the shared config. Settings.migrate already makes the old Auto chain into a "My chain" combo. Add a test that old custom keys carry over.
- CI: add the router methods to the A object in ci/mock.js (~140-200). shots.py clicks `.pop .opt` index 1, so adjust it once presets lead the popover.

Left, in order:
1. router.js plus index.html links, #routerBtn before #themeBtn, the router view (iframe and "open in browser"), the Settings card, the link repoints, mock.js and shots.py.
2. THIRD_PARTY_NOTICES (OmniRoute MIT), README credit, CHANGELOG, plan-blazerouter.md, VERSION and wails.json productVersion both 0.10.0.
3. All checks plus a curl test of :20128/v1/models. Screenshots.
4. Tick the PR checklist, mark ready, merge on green, confirm the v0.10.0 release.
5. Then redesign A (redesign-a, 0.11.0), long-chat B, student pack C, marketer pack D.
