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
