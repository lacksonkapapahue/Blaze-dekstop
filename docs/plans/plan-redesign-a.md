# Redesign part A (v0.11.0)

Step 2 of [plan-v1.0-redesign.md](plan-v1.0-redesign.md). Branch `redesign-a`.

## What changed
- `frontend/dist/shell.js` + `shell.css`: top bar (`#pill` Chat | Projects, `#exitChip`, `#searchBtn`, `#avatar`), rail modes (`body.mode-chat` / `body.mode-projects`, saved in localStorage), Ctrl+K search, Esc leaves a view, avatar menu.
- `frontend/dist/views.js`: `BlazeViews` registry and the `/views` picker (reuses the composer menu: filter, arrows, Enter, badges); listens for the `view:open` event.
- `view_app.go`: `open_view` tool (core tool). Design opens without asking for visual work; other views ask via the approval dialog unless the user asked; `chat` goes back. System prompt line `openViewLine`.
- `app.js`: `show()` calls `Shell.sync()`; live work card counter (`liveMeta`, "Working · N steps · time"), clickable while live.
- `composer.js`: + menu holds Voice, @ File, Plan/Build, Auto/Autopilot, Model, Views; `#modeChip` shows non-default modes; `#keysHelp` `?` tooltip holds the shortcuts; the hint line only shows to flash a message.

## Nothing removed
The sidebar nav buttons, Work/Design tabs, `#themeBtn` and `#route` stay in the DOM with their handlers (hidden by `body.shell` CSS). Every page is in `/views`, Ctrl+K and its own slash command.
