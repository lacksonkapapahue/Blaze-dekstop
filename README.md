# Blaze Desktop

Blaze, the Android assistant, as a desktop app for **Windows, macOS and Linux**, in the same look:
paper and ink, one blue accent, square hairline cards, spaced mono labels, 01/02 lists.

Built with [Wails](https://wails.io) on the same Go core as Blaze CLI (PC detection, free model router,
tools, scheduler). Settings, keys, memory and skills live in `~/.blaze` and are shared with the CLI.

## Install (latest release)
- **Windows**: `Blaze-…-windows-amd64-setup.exe` (or the portable exe). SmartScreen: More info › Run anyway.
- **macOS**: `Blaze-…-macos-universal.dmg`, drag to Applications, then right-click › Open the first time.
- **Arch**: `sudo pacman -U blaze-desktop-*.pkg.tar.zst` (needs `webkit2gtk-4.1`).
- **Debian/Ubuntu**: `sudo apt install ./blaze-desktop_*_amd64.deb`.
- **Other Linux**: unpack the tar.gz and run `blaze-desktop` (needs GTK 3 + WebKitGTK 4.1).

## What's in v0.4.1
**Answer cards.** Blaze answers in a sentence or four, and long detail (tables, step lists, reports, long code) folds into a card above it: clipped with a fade, one click (or the chevron) to read it all, a copy button for its Markdown. Short cards just show in full. Works while streaming, in saved chats and in the orb. Turn it off in Settings › Behaviour › *Fold long answers into cards*.

## What's in v0.4.0
1. **Lives in the background.** A tray icon (menu-bar icon on macOS) with Quick ask, Open Blaze, what Blaze is doing, and Quit. Closing the window hides Blaze instead of quitting (Settings › Behaviour), and it can start hidden when you sign in.
2. **Quick ask from anywhere.** Press **Ctrl+Shift+Space** (Option+Space on a Mac) for the orb: a small always-on-top Blaze in the corner. Expand opens the full window, Esc hides it. macOS asks for Accessibility permission once; on Wayland, bind a system shortcut to `blaze-desktop --orb`. On Hyprland (e.g. Omarchy) and sway Blaze floats the orb itself via `hyprctl` / `swaymsg`; on other tiling window managers add a rule that floats the app id `blaze`.
3. **One Blaze at a time.** Opening it again brings the running one forward; `--orb` opens quick ask, `--background` starts hidden.
4. **Calmer answers.** Instead of raw commands, each answer shows one plain-English status line ("Reading index.html", "Searching the web for …") that becomes "Worked for 12s"; click it to see every step. Power users can turn the full list back on.
5. Windows gets Blaze's own title bar. Doctor checks the tray, shortcut and start-at-login.

## What's in v0.3.0
1. **Fixed: Design turns breaking on Gemini.** Tool calls streamed by Gemini (whole calls per chunk, repeated index 0, arguments as an object) were glued together or lost their name, then saved into the chat, so every later request got `HTTP 400: Request contains an invalid argument`. The stream reader now splits calls correctly, keeps Gemini's thought signatures, a gatekeeper repairs or drops malformed calls before they are run or saved, and the history is cleaned before every request (with one flattened retry if a provider still refuses it).
2. **Pick any provider and model.** The model chip and `/model` switch provider *and* model, or Auto. Settings › Models has a clear default (Auto or one model), the Auto chain with live health (speed, resting, failing) that you can reorder, a "use my free stack" preset, fallback, fastest-first and a daily spend cap.
3. **Models from the mobile app**: a built-in catalog per provider (tools, vision, context size, free tier), the provider's live model list, a "check my plan" probe, OpenRouter's best free tool models picked daily, several keys per provider (when one runs out the next carries on), a token meter that skips a model before it hits its rate limit, plan & quota per provider, usage and cost per model, and plain-English errors. New providers: Cerebras and any OpenAI-compatible service. One-click OpenRouter sign-in.
4. **Keyless is never used for actions.** Pollinations can't call tools, so it is never the default, never in the chain, and never used for Work actions or Design; at most it answers plain chat when nothing else is set up, and only if you allow it.
5. **Redesigned app**: calmer sidebar with icons, segmented Work/Design tabs, a model switcher popover, compact one-line tool steps (repeated errors fold into ×N, older steps fold away), an error card with Retry / Switch model / Details, a proper Design toolbar (labelled preview picker, icon toggles for device and theme, versions as a slim collapsible strip, resizable preview/chat split), and Settings with a left sub-nav. Light and dark both tuned.

## What's in v0.2.1
1. **In-app updates**: Blaze checks GitHub for a newer release when it opens (Settings › Updates, or `/update`) and installs it in place: the setup.exe or portable exe on Windows, Blaze.app from the .dmg on macOS, and the .deb, Arch package or tar.gz on Linux, then reopens. While the repo is private, set `BLAZE_UPDATE_TOKEN` to a GitHub token that can read it.
2. **Fix**: no more blank window on launch. The UI waits for the app to finish starting instead of failing on its first call.

## What's in v0.2.0
1. **Command menu**: type `/` (or press `+`) for a floating list above the chat box: new, model, project, folder, design, retry, stop, skills, theme and more. `@` attaches project files.
2. **Projects**: a folder with its own chats and standing instructions; project page with git status and recent files.
3. **Work / Design tabs**: visual work (HTML/CSS/SVG or a running dev server) opens in Design, by asking first, always or never.
4. **Live preview** at desktop, tablet and phone widths; every change is a numbered version you can view, compare and restore; "Directions" asks for 3 options.
5. **Point to edit**: Select mode, click (Shift-click for more) and Change, Remove, Restyle, Replace text or Ask; live colour/size/spacing tweaks, then Apply writes them into the code.
6. Blaze names the real model it runs on.

Earlier (v0.1.0): first-run PC detection and setup, streaming chat with tool steps, confirm cards, jobs, schedule, doctor, settings.

## Build
Go 1.23 + `go install github.com/wailsapp/wails/v2/cmd/wails@v2.16.0`, then `wails build`
(Linux: `-tags webkit2_41`). CI builds every platform on push and publishes a release;
UI screenshots go to the `shots` branch.
