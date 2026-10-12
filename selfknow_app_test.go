package main

import (
	"os"
	"strings"
	"testing"

	"github.com/lacksonkapapahue/blaze-desktop/internal/config"
	"github.com/lacksonkapapahue/blaze-desktop/internal/selfknow"
	"github.com/lacksonkapapahue/blaze-desktop/internal/sysinfo"
	"github.com/lacksonkapapahue/blaze-desktop/internal/tools"
)

func selfTestApp(t *testing.T) *App {
	// Not t.TempDir: store.Default keeps blaze.db open, and Windows can't delete an open file.
	home, err := os.MkdirTemp("", "blaze-selfknow-")
	if err != nil {
		t.Fatal(err)
	}
	t.Setenv("BLAZE_HOME", home)
	dir := t.TempDir()
	return &App{cfg: &config.Config{}, pv: &preview{}, info: sysinfo.Info{OS: "linux", OSName: "Arch Linux", Arch: "amd64", Cores: 8, RAMGB: 16},
		env: &tools.Env{Root: dir, Shell: tools.NewShell("sh", "/bin/sh", dir)}}
}

// Luke asked "how do I connect my phone?" and Blaze asked which apps he was building.
// The system prompt must say who Blaze is and carry the rule against that.
func TestSystemPromptHasAboutYou(t *testing.T) {
	a := selfTestApp(t)
	sys := a.system("how do I connect my phone to the desktop app?")
	for _, want := range []string{"ABOUT YOU", "You are Blaze, running here as Blaze Desktop", "Blaze Android", "Blaze CLI", "Phone ↔ PC (Blaze Link)",
		"BlazeRouter:", "Arch Linux", selfknow.ToolName, "Never ask the user which apps they are building"} {
		if !strings.Contains(sys, want) {
			t.Errorf("system prompt misses %q", want)
		}
	}
	if !tools.IsCore(selfknow.ToolName) {
		t.Error("about_blaze should be a core tool")
	}
}

func TestAboutBlazeTool(t *testing.T) {
	a := selfTestApp(t)
	old := theApp
	theApp = a
	defer func() { theApp = old }()
	full := tools.Run(a.env, selfknow.ToolName, `{}`)
	for _, want := range []string{"BLAZE SELF-REPORT", "IDENTITY", "BLAZE LINK", "Settings › Blaze Desktop", "BLAZEROUTER", "auto/best-free", "SLASH COMMANDS", "/views", "VIEWS", "BlazeRouter", "DATA FOLDERS", "Arch Linux"} {
		if !strings.Contains(full, want) {
			t.Errorf("about_blaze misses %q:\n%s", want, full)
		}
	}
	link := tools.Run(a.env, selfknow.ToolName, `{"section":"link"}`)
	if !strings.HasPrefix(link, "BLAZE LINK") || strings.Contains(link, "SLASH COMMANDS") {
		t.Errorf("section link: %s", link)
	}
}
