# v0.8.0: the Design studio

Code: `internal/studio` (pure Go, tested), `studio_app.go` (bound methods), `picker.js`
(in-page edits, audit, states, hot reload, phone comments), `frontend/dist/studio.js|css`.

1. **Write-back** — the picker sends a `Target` (tag, id, classes, text, index among
   look-alikes). `studio.Apply` finds the element in the previewed file (then the
   project's other template files; a unique match wins) and edits `style="…"`,
   `style={{…}}`, attributes or text. `ErrTooComplex` / no match → the edit goes to the
   model as a `[Design edit]`. Each edit is a version (`Kind: edit`) with a diff and Undo.
2. **Directions** — `StartDirections` dispatches specialists `direction-a|b|c` (isolated
   worktrees; `Isolation.CarryDirty` commits the user's uncommitted work as the base so
   the branch starts from what they see and still applies cleanly). The preview serves a
   branch at `/__dir/<handle>/<page>`. The lead is told not to review them;
   `PickDirection` applies one and discards the rest, `MixDirections` sends a
   `[Directions mix]` with the branch folders.
3. **Taste + brand** — `~/.blaze/desktop/taste.json`. A value a version introduced and its
   child kept: +1; dropped: −1; restored away from: −1; hand edit: +2 (Undo: −3).
   Brand kit lives in the project's design state; both go into the system prompt.
4. **Copy window** — `screen.Look` (window behind Blaze) or a dropped/pasted image →
   `[Copy window]` message with the image and the detected stack.
5. **Critic** — hidden iframes at 390/820/1280 run the audit in `picker.js`;
   `studio.Score` weights accessibility 50%, layout 30%, speed 20%. Auto-fix below the
   threshold (85), once per version; the fix version carries `FixOf`.
6. **Voice** — hold-to-talk in the selection bar (WebView mic, or the native recorder),
   local Whisper, then a `[Design edit] Change` for the selected element.
7. **States board** — `?__state=hover|focus|active|empty|loading|error|dark`: the picker
   copies `:hover/:focus/:active` rules to attribute selectors, unwraps
   `prefers-color-scheme: dark`, and stands in for undesigned states.
8. **History** — `Version.Parent` + `DesignState.Head`: restoring branches the timeline.
   Compare shows a before/after slider. `RestoreElement` swaps one element back.
9. **Phone** — a second listener on the LAN behind a random token (cookie after the QR
   link). `/__blaze/live` (SSE) reloads on every version and on outside file changes;
   `/__blaze/comment` stores pins.
10. **Ship** — `studio.Stage` (static copy, or `npm run build` output), then
    `wrangler pages deploy` or a force-pushed `gh-pages` branch. Shared pages load
    `/v1/comments.js` from the Worker (KV `comments:<site>`, open CORS, 200 pins).
