# BlazeRouter (v0.10.0)

Step 1 of [plan-v1.0-redesign.md](plan-v1.0-redesign.md). PR #44, branch `blazerouter`.

## What
A local OpenAI-compatible gateway that ships inside Blaze: a native Go port of the routing core of
[OmniRoute](https://github.com/diegosouzapw/OmniRoute) (MIT, credited in `THIRD_PARTY_NOTICES.md`).
It replaces Settings › Models and Providers & keys as the place you manage models.

- Server: `127.0.0.1:20128` (next free port if taken), `/v1/chat/completions`, `/v1/models`,
  `/v1/messages` (Anthropic), Gemini `generateContent`, `/v1/embeddings`; `/dashboard` for the UI.
  Loopback only; a local API key for clients; the in-app dashboard uses a per-run session token
  and its CSP allows framing only by Blaze's webview.
- Routing: every OmniRoute `auto/*` preset (category:tier weight packs, filters, LKGP stickiness,
  chaos fan-out to 5 providers), user combos (priority, round-robin, quota-aware, cheapest),
  key rings that rest a rate-limited key, retries with backoff, optional prompt compression.
- Keys: read from Blaze's shared config and keychain, so Blaze CLI keeps working. The old Auto
  chain migrates once to a "My chain" combo, without rewriting `config.json`.

## Code
- `internal/router/`: server, plans (`combos.go`, `auto.go`, `chaos.go`), forwarding and format
  translation, request log (metadata only), dashboard assets in `web/` (embedded).
- `router_app.go`: start/stop with the app, `RouterInfo`, `RouterDashboardURL(page)`,
  `OpenRouterDashboard`, `SetRouterOn`, `RouterPicker`, a `router` event every 15 s; tray item in
  `tray.go`; `SelectModel("blazerouter", preset)` in `models.go`.
- `frontend/dist/router.js` + `router.css`: the top-bar button (`#routerBtn`, before the theme
  button), `show("router", page)` (status bar, on/off, Open in browser, iframe of the dashboard),
  `SETTINGS_FNS.models` (the BlazeRouter card, Classic editor toggle), presets at the top of the
  model popover and the `/model` › BlazeRouter submenu, `/router`.

## Nothing removed
Settings › Models and Providers & keys are still reachable under **Classic editor**.
`show("settings","providers")` and every old "add a key" link open BlazeRouter › Providers.

## Tests
- Go: `internal/router/*_test.go` (fallback, retries, SSE, key rings, strategies, quota-aware,
  auth/host checks, Anthropic/Gemini translation, compression, migration, old custom keys carry
  over, port fallback, every auto preset, LKGP, chaos).
- UI: `ci/shots.py` shoots the picker, the dashboard view (the real dashboard page with its `/api`
  stubbed from `ci/router-state.json`), the Settings card, the classic editor and the off state,
  and fails if the presets, the button or the old link are missing.
