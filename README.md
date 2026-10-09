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
