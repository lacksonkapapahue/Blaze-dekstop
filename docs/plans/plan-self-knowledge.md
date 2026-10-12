# Blaze self-knowledge (v0.12.0)

## Why
Luke asked Blaze Desktop "how can I connect my phone and desktop apps?" and it asked him which apps he was building. Blaze had no idea it *is* the app. Goal: Blaze knows every nook and cranny of itself, read live, never invented.

## What
- `internal/selfknow` (shared shape with Blaze CLI, names match Android `agent/SelfKnowledge.kt`):
  - `Facts`: filled by the host from live state.
  - `Brief(f)`: the ABOUT YOU block (identity, version, apps and how they connect, Blaze Link, BlazeRouter, account, OS) plus `Rule`. Test keeps it under ~330 words.
  - `Report(f, section)`: the `about_blaze` answer. Sections: identity, apps, version, account, link, router, views, commands, data, connectors, mcp, skills, memory, system (aliases: phone/pairing, os/pc, folders, presets…).
  - `Devices(dir)` reads `~/.blaze/pair/devices.json` (Blaze Link's file); `Layout(dir)` lists the real data folder; `DesktopEnv` reads XDG/Wayland/Hyprland env; `Views`/`Commands` parse the embedded `frontend/dist` registries (`BlazeViews` LIST, `COMMANDS` + every `COMMANDS.splice/push`).
- `selfknow_app.go`: `selfFacts(full)` reads the Blaze account (cloudState), key-sync time, BlazeRouter (`routerView`, `router.AutoPresets`), sysinfo, connectors + MCP (`conn.Views()`), skills (`tools.SkillStatus()`), memory (`store.Default()`); `aboutYou()`; registers `about_blaze` (core tool).
- `app.go system()`: ABOUT YOU goes right after RULES.

## Blaze Link honesty
The PC side of Blaze Link (pairing server on 7377 + Phone view) was built in PR #3 (`feature/phone-pairing`) but never merged. `linkInBuild = false` in `selfknow_app.go` makes ABOUT YOU and `about_blaze` say so, give the phone-side location (Blaze Android › Settings › Blaze Desktop), and list what works now (Blaze account key sync, Design › Phone preview). When the PC side lands, flip the constant and the pairing steps become the answer.

## Next
- Port PR #3 (Blaze Link PC side) onto current main; flip `linkInBuild`.
- Desktop skill sync with the account (`/v1/skills` exists on the Worker; only Android uses it).
