# Desktop v0.4.2 plan: Polish (AI chat titles, mini orb marks, Hyprland orb, personality)

01 · Chat titles from the dominant theme (titles.go, internal/llm/quick.go)

- After the first full exchange (user → assistant text), and again every 4 user turns, or after 2 turns when a long (600+ chars) new message lands, Blaze makes one tiny background call to name the chat (2–6 words, Title Case, no quotes/emoji). The model sees the current title and the last 12 user/assistant messages (each cut to 400 chars, ~3.2k chars total, no tool output) and keeps the title if it still fits.
- `llm.Quick` picks free-tier models first, then the router's health/speed order, skips cooling or resting models, tries at most 2, 20 s timeout, no streaming, no tools. It records usage and quota limits but not speed stats, so tiny calls don't make a model look fast for real turns. Keyless only when nothing else is set up.
- Never blocks the turn (runs after saveConv in a goroutine, one per chat at a time) and fails silently (keeps the old title).
- Conv JSON: `title_source` (auto | manual | "" = first prompt) and `title_turns`. Title patches rewrite only the title fields (the chat keeps its date). Chats list returns `source`.
- Rename: double-click a chat in the sidebar (Enter saves, Esc cancels, empty = back to automatic). Manual titles are never retitled. `RenameConversation(id, title)`.
- The sidebar animates a new title: the old one blurs out, the new one types in with a square accent caret (instant under prefers-reduced-motion). Event `title` {id, title, source}.
- Setting: Settings › Behaviour › "Name chats by their topic" (desktop.json `auto_titles`, default on, explicit in State()).

02 · Mini particle-orb marks (frontend/dist/polish.js + polish.css)

- The small square marks (BLAZE label mark, the "Worked" line, tool step marks such as remember, the thinking line, card title marks) become a 10px (cards 8px) turning sphere of square dots, the same orb as the quick-ask bar.
- One sprite sheet per (size, devicePixelRatio, theme), 48 frames, drawn once; every mark blits its frame with drawImage at device pixels (crisp at any DPR). A MutationObserver attaches marks as the chat renders.
- Only marks on screen (IntersectionObserver) that belong to live work animate, at ~15 fps: the streaming turn's BLAZE mark, the live status line, running steps, a streaming card. Everything else keeps a frozen frame; the loop stops entirely when nothing is live, when the window is hidden, and under prefers-reduced-motion. Theme changes rebuild the sheets.

03 · Orb on tiling Wayland compositors (tiling_linux.go)

- Hyprland ignores WindowSetSize, so the orb filled the tile. With HYPRLAND_INSTANCE_SIGNATURE set, ShowOrb finds Blaze's window in `hyprctl clients -j` (by pid, then class `blaze`) and runs one `hyprctl --batch`: setfloating, resizewindowpixel exact 400 560, movewindowpixel exact to the bottom-right of the focused monitor (scale, rotation and reserved bar space respected, 24px margin). Retries for ~1.6 s while the window maps. Expand runs `settiled` only if Blaze floated it.
- sway (SWAYSOCK): `swaymsg [pid=N] floating enable, resize set 400 560, move absolute position …`; Expand: `floating disable`.
- Doctor: a "Window manager" line on Hyprland/sway (or a warning on other tiling WMs like river/niri/i3 with the window-rule to add: float app id/class `blaze`, which floats the main window too).

04 · Personality (app.go `personality()`, next to answerShape)

- Chat turns (system()) get a PERSONALITY block before ANSWER SHAPE: Blaze's default voice (warm, sharp, one step ahead; answer first, take a side, be specific, read the room, bad news first, do the work, honest about being an assistant). Scheduled jobs keep their plain prompt.
- Settings › Behaviour › Personality: Default / Plain (no block) / Custom (textarea; starts from the default text). desktop.json `personality` (default | plain | custom; State() always explicit) and `personality_custom`. The older Style note still adds a STYLE block on top.

05 · CI

ci/mock.js returns auto/manual titles and RenameConversation; ci/shots.py shoots titles-typing, titles, rename, personality and personality-custom, and 3x zoomed marks / marks-live in light and dark, and fails if the title event, double-click rename or the orb marks don't work. Go unit tests: titles_test.go, tiling_linux_test.go.

Test on a real PC: chat 1 exchange → title appears with the typewriter; change topic for 4 turns → title updates; double-click rename sticks; marks animate only while Blaze works; on Omarchy press the shortcut → a 400x560 floating orb bottom-right, Expand → tiled again.
