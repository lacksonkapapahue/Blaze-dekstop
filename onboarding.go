package main

import (
	"context"
	"errors"
	"os/exec"
	"runtime"
	"strings"
	"time"

	"github.com/godbus/dbus/v5"
)

// First-run onboarding: a full-screen step flow (Welcome, model, apps, permissions,
// tour, done). The step is saved so a restart picks up where the user left off.

// OnboardState is what the onboarding screen needs beyond State().
type OnboardState struct {
	Step    int  `json:"step"`    // last step the user reached
	Skipped bool `json:"skipped"` // the user chose Skip (don't open it by itself again)
	Done    bool `json:"done"`
}

func (a *App) Onboarding() OnboardState {
	a.waitReady()
	return OnboardState{Step: a.prefs.OnboardStep, Skipped: a.prefs.OnboardSkipped, Done: a.cfg.SetupDone}
}

// SetOnboardStep remembers the step so onboarding resumes there.
func (a *App) SetOnboardStep(n int) {
	if n < 0 {
		n = 0
	}
	a.prefs.OnboardStep = n
	a.savePrefs()
}

// SkipOnboarding closes the flow; it can be reopened from Settings › Behaviour.
func (a *App) SkipOnboarding() {
	a.prefs.OnboardSkipped = true
	a.FinishSetup()
}

// FinishOnboarding is the last step's button.
func (a *App) FinishOnboarding() {
	a.prefs.OnboardStep = 0
	a.prefs.OnboardSkipped = true // they've seen it all; don't open it again by itself
	a.FinishSetup()
}

// OnboardNotifyTest sends one native notification so the OS asks for (or shows)
// its permission. "" means it was handed to the OS.
func (a *App) OnboardNotifyTest() string {
	err := sendNotification("Blaze", "Notifications are on. Blaze only uses them for things that matter.")
	if err != nil {
		return err.Error()
	}
	return ""
}

func sendNotification(title, body string) error {
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	switch runtime.GOOS {
	case "linux":
		return notifyDBus(title, body)
	case "darwin":
		// Shown by the system; the first one makes macOS ask for permission.
		script := `display notification "` + appleQuote(body) + `" with title "` + appleQuote(title) + `"`
		out, err := exec.CommandContext(ctx, "osascript", "-e", script).CombinedOutput()
		if err != nil {
			return errors.New("macOS didn't show it: " + strings.TrimSpace(string(out)))
		}
		return nil
	case "windows":
		// Shown through PowerShell's registered app id: an unregistered one is dropped silently.
		ps := `[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null;` +
			`$x = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02);` +
			`$t = $x.GetElementsByTagName('text'); $t.Item(0).AppendChild($x.CreateTextNode('` + psQuote(title) + `')) > $null;` +
			`$t.Item(1).AppendChild($x.CreateTextNode('` + psQuote(body) + `')) > $null;` +
			`[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\WindowsPowerShell\v1.0\powershell.exe').Show([Windows.UI.Notifications.ToastNotification]::new($x))`
		c := detached("powershell", "-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", ps)
		out, err := c.CombinedOutput()
		if err != nil {
			return errors.New("Windows didn't show it: " + strings.TrimSpace(string(out)))
		}
		return nil
	}
	return errors.New("notifications aren't supported on " + runtime.GOOS)
}

// notifyDBus uses the freedesktop notification service (GNOME, KDE, mako, dunst, swaync…).
func notifyDBus(title, body string) error {
	conn, err := dbus.ConnectSessionBus()
	if err != nil {
		return errors.New("no desktop session bus: " + err.Error())
	}
	defer conn.Close()
	obj := conn.Object("org.freedesktop.Notifications", "/org/freedesktop/Notifications")
	call := obj.Call("org.freedesktop.Notifications.Notify", 0, "Blaze", uint32(0), "blaze", title, body,
		[]string{}, map[string]dbus.Variant{}, int32(6000))
	if call.Err != nil {
		return errors.New("no notification service is running (install mako, dunst or swaync on a tiling desktop): " + call.Err.Error())
	}
	return nil
}

func appleQuote(s string) string { return strings.NewReplacer(`\`, `\\`, `"`, `\"`).Replace(s) }
func psQuote(s string) string    { return strings.ReplaceAll(s, "'", "''") }
