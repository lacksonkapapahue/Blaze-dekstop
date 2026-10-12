# Blaze 1.0 status

Plan: [plan-v1.0-redesign.md](plan-v1.0-redesign.md). Each step is its own PR and version bump.

## Step 1 — BlazeRouter (PR #44, branch `blazerouter`, v0.10.0) — MERGED (PR #46, 6a283a9)
Done:
- internal/router: OpenAI-compatible gateway on 127.0.0.1:20128 (OmniRoute port), every auto/* preset, combos, LKGP, chaos, dashboard, tests
- router_app.go + tray item + models.go wiring
- frontend/dist/router.js + router.css linked: #routerBtn (icon + status dot) before #themeBtn; show("router", page) = status bar, on/off, Open in browser, iframe of RouterDashboardURL(page); presets + combos at the top of the model popover ("All BlazeRouter presets" folds the rest); /model › BlazeRouter submenu; /router
- Settings: "BlazeRouter" card replaces Models; "Providers & keys" nav item gone; old editors behind "Classic editor"; show("settings","providers") and every old add-a-key link open show("router","providers")
- Test: internal/router/carryover_test.go (old custom provider + extra keys carry over and route)
- ci/mock.js router methods; ci/shots.py router shots (real dashboard page, /api stubbed from ci/router-state.json); picker shot clicks Google Gemini by name
- THIRD_PARTY_NOTICES.md, README credits, CHANGELOG v0.10.0, docs/plans/plan-blazerouter.md, VERSION + wails.json 0.10.0
- Checks: gofmt, go vet ./internal/..., go test ./internal/..., GOOS=windows go build ., node --check, ci/*.test.js (jsdom) all pass; curl :20128/v1/models lists auto/* presets, 401 without key

## Step 2 — Redesign part A (branch `redesign-a`, v0.11.0) — READY, merging on green CI
Done: shell.js/shell.css (Chat|Projects, Exit chip, Search Ctrl+K, avatar menu, rail modes), views.js (/views picker, view:open), view_app.go open_view tool + test + prompt line, ink user bubbles, live work card counter (liveMeta), + menu composer (Voice, @ File, Plan/Autopilot, Model, Views), mode chip, ? shortcuts tooltip, shots (shell-*), CHANGELOG, plan-redesign-a.md, VERSION/wails.json 0.11.0.

## Remaining steps after this PR
2. Redesign (part A)
3. Long-chat engine (part B)
4. Student pack (part C)
5. Marketer pack (part D)

## Next: Step 3 — Long-chat engine part B (branch long-chat off main after redesign-a merges, v0.12.0)
See plan-v1.0-redesign.md part B. Hook: app.go turn loop uses trim(s.hist) (~line 585, max 60 msgs); store schema in internal/store/store.go (FTS5 already used for memories).
