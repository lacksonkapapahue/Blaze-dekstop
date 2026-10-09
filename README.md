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

## What's in v0.2.0
01 · Command menu above the chat box

Typing / opens a floating list above the box. Each command has a one-line description. The list filters as you type. Arrow keys, Enter/Tab or a click picks one.
A + button on the box opens the same menu, so nobody has to know about /.
Commands: /new, /model (see or switch the model), /project, /folder, /retry, /stop, /clear, /jobs, /schedule, /doctor, /settings, /theme, /auto-approve, /memory, /skills.
@ opens a file picker from the project, which attaches that file to your message.
02 · Projects

New PROJECTS section in the sidebar. A project is a name, a folder, its own chats and its own instructions that Blaze always follows there.
+ New project: pick a folder and the name fills in from it.
Project page: its chats, an instructions box, git branch and status, recently changed files, and a New chat button.
Switching project switches the folder and filters the chat list. Chats with no project go under General.
The /project command and the folder chip at the top both switch projects.
03 · Fixes

Commands run in the app and never go to the model as text. Chat titles skip them.
Blaze names the real provider and model it's on, and never claims to be GPT-4 or anything else.
The model chip at the top shows which model answered.

Batch 2 addition: Work and Design tabs
04 · Two tabs at the top: WORK and DESIGN

Work is today's chat: code, commands, files.
Design opens when a task turns visual. Blaze spots it from the request ("make a landing page", "redesign the settings screen") or from the files it writes (.html, .css, .svg, components).
Switching follows a setting: Ask first (default, a card saying "Open in Design?"), Always, or Never.
05 · Live preview

Big preview pane with Desktop, Tablet and Phone widths, plus light and dark.
It previews HTML files, SVG and images, and a running dev server (Vite, Next, etc.), which Blaze starts for you.
Open pops the preview out to full window or your browser.
06 · Step-by-step versions

Every change the model makes is saved as a numbered version (01, 02, 03…) in a filmstrip, each with a thumbnail and one line on what changed.
Click any version to view it. Compare two side by side, or Restore one.
For new designs, Blaze can suggest 2–3 directions first. You pick one, then it builds it out step by step.
07 · Edit with AI by pointing

Select mode: hover to outline elements, click to pick one, Shift-click to pick several.
A small bar pops up on the selection with Change, Remove, Restyle, Replace text and Ask… (free text, e.g. "make this a 3-column grid").
Blaze gets the exact element and its code, edits only that part, and saves a new version.
Quick tweaks: drag a colour or spacing value on the selected element to preview it, then Apply writes it into the code.
Design chat sits beside the preview, so you can still just type.

