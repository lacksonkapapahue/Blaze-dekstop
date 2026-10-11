# v0.4.5: notifications and screen vision

## Notifications
- Probe once per machine (and desktop session on Linux): Wails native (Windows toast, macOS UNUserNotificationCenter, Linux D-Bus) first, then a command method (notify-send, dunstify, terminal-notifier, osascript, PowerShell toast). Cache in `~/.blaze/notify.json` with host, desktop and version; a different machine/session/version re-probes. A failed send re-probes once, then uses the command fallback.
- Scheduled jobs (`run-job`) run without the app and use the cached command method.
- `notify` tool: title + body only, at most 10 an hour.

## Proactive watcher (`watch.go`, `internal/notify/policy.go`)
- Off by default. Sleeps until the next due check (no ticker); Settings changes wake it.
- Policy: interval (default 10 min, floor 5) doubling per ignored suggestion up to x8; 3/hour, 8/day; quiet hours; nothing while idle > 5 min, in full screen, or while the user is talking to Blaze.
- One model call per check with a strict "NONE unless genuinely useful" gate; near-duplicates of the last day are dropped.

## Screen vision (`internal/screen`)
- Text first (UIA/AX/AT-SPI) in a short-lived helper process; screenshots as fallback (GDI/PrintWindow, screencapture, grim, xdg portal, X11).
- Cache: window key (id, pid, title) + perceptual picture hash where a thumbnail is cheap (Windows: 30 s while the picture is unchanged); elsewhere a 2 s TTL. Vision-model answers are cached by window + question + picture hash for 60 s.
- Privacy indicator (`screen` event) while any read runs; tray status too. Warm read only on the rising edge of the orb or a turn.

## Not done yet
- Cheap thumbnails on macOS and Linux (cache there is TTL-only).
- Wayland window identity outside Hyprland/sway relies on AT-SPI's active frame.
