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

## What's in v0.1.0
1. First run: detects your PC, offers to install git/python/node, adds free model keys (OS keychain).
2. Chat with streaming Markdown, code blocks with Copy, tool steps you can expand, Stop.
3. Tools: shell, background jobs, files, Python/Node code, git, web search, page reading, HTTP, downloads, installs.
4. Confirm cards for risky commands, installs, deletes and writes outside the project; Auto-approve switch.
5. Sidebar: saved chats, project folder, jobs, scheduled jobs (Task Scheduler / cron), Doctor, Settings.

## Build
Go 1.23 + `go install github.com/wailsapp/wails/v2/cmd/wails@v2.16.0`, then `wails build`
(Linux: `-tags webkit2_41`). CI builds every platform on push and publishes a release;
UI screenshots go to the `shots` branch.
