# Desktop Batch 4 plan (v0.4.0): Foundation + hidden tool steps
Phase 0 of the 1.0 roadmap: Blaze lives in the background and is one shortcut away. Plus a calmer chat: no raw commands unless you ask for them.

01 · Tray / menu-bar icon

fyne.io/systray v1.12.2. Windows and Linux run systray.Run on its own locked OS thread; clicking the icon toggles the orb. macOS uses RunWithExternalLoop (Wails owns NSApp and its run loop) and starts it on the main thread through a small dispatch helper (tray_darwin.m); it never calls systray.Quit, which would stop NSApp. Menu: Quick ask, Open Blaze, a disabled status line (Idle / Working · Reading index.html), Quit Blaze.
Icon: the pixel "B" from logo.svg (5x7 cells + blue dot), drawn at integer cell sizes (16/24/32/48/64) on the dark square: .ico for Windows, PNG for Linux, a monochrome template PNG for the macOS menu bar (build/tray, embedded).
Linux checks for a StatusNotifierItem host on D-Bus (KDE, Cinnamon, XFCE, waybar, GNOME with AppIndicator). Without one the tray counts as off, so closing the window still quits.

02 · Background mode

OnBeforeClose hides the window instead of quitting while the pref "background" is on (default) and the tray is up. a.quitting + a.quit() make tray Quit and the updater really quit.

03 · Single instance and flags

SingleInstanceLock com.blaze.desktop. Launching Blaze again shows the window, or the orb with --orb. --background starts hidden (login items use it). Updater relaunches pass --relaunch; main() then waits 2.5s so the old copy frees the lock.

04 · Global shortcut

golang.design/x/hotkey v0.6.4. Presets: Ctrl+Shift+Space (default on Windows/Linux), Alt+Space (default on macOS, i.e. Option+Space), Ctrl+Alt+Space, Ctrl+Shift+B, Off. Alt is ModAlt on Windows, Mod1 on X11, ModOption on macOS. 300 ms debounce. macOS needs Accessibility permission: Settings shows Grant access (opens the Privacy › Accessibility pane and macOS's own prompt) and Try again. Wayland can't grab global keys: Settings says to bind a system shortcut to `blaze-desktop --orb`.

05 · Orb (quick ask)

Wails v2 has one window, so the orb is a compact mode of it: geometry saved, min 340x420, 400x560 at the bottom-right of the current screen, always on top, shown and focused, "orb" event. Expand restores the geometry, unpins, min 760x520. The shortcut toggles it. The UI hides the sidebar and top bar and shows an orb bar (particle-dot orb, BLAZE, New / Expand / Hide); an empty chat shows a big particle orb and "Ask anything". Esc hides.

06 · Window frame

Windows is frameless with Blaze's own minimise / maximise / close in the top bar (close goes through background mode); double-click the bar to maximise. macOS keeps the inset title bar (orb bar padded for the traffic lights). Linux keeps its native frame.

07 · Start with your computer

Windows: HKCU\…\Run "Blaze" = "<exe>" --background. Linux: ~/.config/autostart/blaze-desktop.desktop. macOS: ~/Library/LaunchAgents/com.blaze.desktop.plist (RunAtLoad).

08 · Settings and Doctor

Prefs (desktop.json): background, autostart, hotkey, show_steps. Settings › Behaviour › Background & shortcut: background and start-at-login toggles, the shortcut picker and its status. Doctor adds Tray, Shortcut and Start at login. The hero says "Press <shortcut> anywhere for quick ask".

09 · Hidden tool steps

By default each answer shows one status line in plain English with a shimmer ("Reading index.html", "Searching the web for …", "Installing packages"), fed by tool calls and the router's status events. When the answer ends it becomes a quiet "Worked for 12s"; click it for the full step list. No line when no tools ran. Errors and confirm cards still show; repair notes stay inside the steps. Saved chats collapse steps behind "Worked · N steps". Settings › Behaviour › "Show every step (power users)" brings back the old list.

Test on a real PC (CI only builds): tray icon and menu, close → hides, Quit from the tray, second launch shows the window, shortcut toggles the orb, Expand / Hide / Esc, start at login after a reboot, an update relaunch.
