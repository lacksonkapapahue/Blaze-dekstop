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

## Step 2 — Redesign part A (branch `redesign-a`, v0.11.0, PR #47) — MERGED (99f6ec6)
Done: shell.js/shell.css (Chat|Projects, Exit chip, Search Ctrl+K, avatar menu, rail modes), views.js (/views picker, view:open), view_app.go open_view tool + test + prompt line, ink user bubbles, live work card counter (liveMeta), + menu composer (Voice, @ File, Plan/Autopilot, Model, Views), mode chip, ? shortcuts tooltip, shots (shell-*), CHANGELOG, plan-redesign-a.md, VERSION/wails.json 0.11.0.

## Self-knowledge (PR #49, branch `self-knowledge`, v0.12.0) — MERGED (e586e3c), released v0.12.0 (6 assets)
internal/selfknow (ABOUT YOU block + about_blaze tool), identical in Blaze-cli (PR #15, v0.10.0). Blaze Link not in build yet (linkInBuild=false in selfknow_app.go) until Step 3b.

## Step 3 — Long-chat engine part B (PR #48, branch `long-chat`, v0.13.0) — MERGED (eabc153)
Done: internal/longchat (db, compact, artifacts) + tests; longchat_app.go wired into app.go; tools search_chat/read_turn/read_artifact/update_brief (core, next to about_blaze); token meter + fresh-chat offer; project Brief editor; shots longchat-*; CHANGELOG v0.13.0; plan-longchat.md; VERSION + wails.json 0.13.0.
Checks: gofmt, vet ./internal/..., go test ./internal/..., GOOS=windows build, node --check, ci/*.test.js.

## Step 3b — Blaze Link PC side (branch `blaze-link`, v0.14.0) — READY, merging on green CI
Done: pair.go (port of PR #3, protocol = Android DesktopLink.kt, documented in plan-blaze-link.md), phone_ask tool + Env.Phone, PAIRED PHONE prompt line, linkInBuild=true + live online phone in about_blaze, Phone view (link.js/css, /views, /phone, open_view phone), qrImage fix, pair_test.go, mock + shots link-*, CHANGELOG, VERSION/wails.json 0.14.0.

## Next, in order
- Step 4 — Student pack (part C, branch `student-pack`, v0.15.0): classroom_courses / classroom_coursework tools, skills study-planner, tutor, lecture-notes, essay-coach, group-project, classroom-sync; low-data mode; UPDATE_SKILL_INDEX=1 go test ./internal/skillpack/; README skill count.
- Step 5 — Marketer pack (part D), own PR.
