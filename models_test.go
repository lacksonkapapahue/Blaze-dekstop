package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/lacksonkapapahue/blaze-desktop/internal/config"
	"github.com/lacksonkapapahue/blaze-desktop/internal/llm"
)

func testApp(t *testing.T) *App {
	t.Helper()
	t.Setenv("BLAZE_HOME", t.TempDir())
	a := NewApp()
	a.cfg = config.Load()
	close(a.ready)
	return a
}

// A config.json from before managed plans (cloud keys in the chain, a cloud default)
// loads, routes through Blaze, and keeps Blaze CLI's entries on save.
func TestOldConfigStillLoads(t *testing.T) {
	home := t.TempDir()
	t.Setenv("BLAZE_HOME", home)
	old := `{"chain":[{"provider":"gemini","model":"gemini-3.8-flash"},{"provider":"pollinations","model":"openai-fast"},{"provider":"ollama","model":"qwen3"}],"default":{"provider":"groq","model":"llama"},"auto_approve":true,"setup_done":true,"max_steps":30,"persona":"short","no_keyless":true,"daily_cap":2}`
	if err := os.WriteFile(filepath.Join(home, "config.json"), []byte(old), 0o600); err != nil {
		t.Fatal(err)
	}
	c := config.Load()
	if !c.IsAuto() || !c.AutoApprove || c.Persona != "short" || len(c.Chain) != 3 {
		t.Fatalf("old config not read: %+v", c)
	}
	if rc := c.RouteChain(); len(rc) != 1 || rc[0].Provider != "ollama" {
		t.Fatalf("only local models may follow Blaze in Auto: %+v", rc)
	}
	ts := llm.Targets(c, true)
	if len(ts) != 2 || ts[0].Provider != config.Blaze || ts[1].Provider != "ollama" {
		t.Fatalf("Auto should be Blaze, then Ollama: %+v", ts)
	}
	if err := c.Save(); err != nil {
		t.Fatal(err)
	}
	b, _ := os.ReadFile(filepath.Join(home, "config.json"))
	var m map[string]any
	_ = json.Unmarshal(b, &m)
	for _, k := range []string{"chain", "auto_approve", "setup_done", "max_steps", "persona", "no_keyless", "daily_cap"} {
		if _, ok := m[k]; !ok {
			t.Fatalf("field %s lost on save: %s", k, b)
		}
	}
}

func TestSelectModelRules(t *testing.T) {
	a := testApp(t)
	llm.SetBlazePlan("blaze-fast", []llm.ModelInfo{
		{ID: "blaze-fast", Name: "Blaze Fast", Tools: llm.Yes, Tier: "basic", Alias: true},
		{ID: "blaze-max", Name: "Blaze Max", Tools: llm.Yes, Tier: "max", Alias: true, Locked: true},
	})
	defer llm.SetBlazePlan("", nil)
	a.SelectModel(config.Blaze, "blaze-max")
	if !a.cfg.IsAuto() {
		t.Fatal("a model above the plan must never become the default")
	}
	if msg := lockedMessage(config.Blaze, "blaze-max"); msg != "Blaze Max needs the Max plan." {
		t.Fatalf("locked message %q", msg)
	}
	a.SelectModel("ollama", "gemma-3-27b-it")
	if !a.cfg.IsAuto() {
		t.Fatal("a model that can't call tools must never become the default")
	}
	a.SelectModel(config.Blaze, "blaze-fast")
	if a.cfg.IsAuto() || a.cfg.Default.Provider != config.Blaze || a.cfg.Default.Model != "blaze-fast" {
		t.Fatalf("default not set: %+v", a.cfg.Default)
	}
	if len(a.cfg.Chain) != 0 {
		t.Fatalf("Blaze is never a chain entry: %+v", a.cfg.Chain)
	}
	if got := a.modelName(); got != "Blaze · blaze-fast" {
		t.Fatalf("chip label %q", got)
	}
	ts := llm.Targets(a.cfg, true)
	if len(ts) != 1 || ts[0].Provider != config.Blaze || !ts[0].Fixed {
		t.Fatalf("a chosen model is the only target: %+v", ts)
	}
	a.SelectModel("auto", "")
	if !a.cfg.IsAuto() {
		t.Fatal("auto not restored")
	}
	if got := a.modelName(); got != "Auto · Blaze · blaze-fast" {
		t.Fatalf("chip label %q", got)
	}
}

func TestModelsMenu(t *testing.T) {
	a := testApp(t)
	a.cfg.Chain = []config.Entry{{Provider: "ollama", Model: "qwen3:8b"}}
	items := a.Models()
	if len(items) != 2 || items[0].Provider != config.Auto || items[1].Provider != "ollama" {
		t.Fatalf("signed out: Auto and the local model only: %+v", items)
	}
	for _, p := range a.providerViews() {
		if p.ID == config.Blaze && p.Ready {
			t.Fatal("Blaze isn't ready while signed out")
		}
	}
}

func TestOnlyLocalModelsCanBeAdded(t *testing.T) {
	a := testApp(t)
	if r := a.AddLocal(config.Blaze); r.OK || !strings.Contains(r.Error, "plan") {
		t.Fatalf("Blaze must not be added like a local model: %+v", r)
	}
	if r := a.AddLocal("groq"); r.OK {
		t.Fatal("cloud providers are gone")
	}
	if msg := a.SetCustomProvider("https://api.openai.com/v1", "x"); msg == "" || a.cfg.CustomBase != "" {
		t.Fatalf("a remote server must be refused: %q %q", msg, a.cfg.CustomBase)
	}
	if msg := a.SetCustomProvider("127.0.0.1:1234/v1", "LM Studio"); msg != "" || a.cfg.CustomBase != "http://127.0.0.1:1234/v1" {
		t.Fatalf("a local server must be kept: %q %q", msg, a.cfg.CustomBase)
	}
	a.SetChain([]config.Entry{{Provider: config.Blaze, Model: "blaze-max"}, {Provider: "ollama", Model: "qwen3"}})
	if len(a.cfg.Chain) != 1 || a.cfg.Chain[0].Provider != "ollama" {
		t.Fatalf("the chain holds local models only: %+v", a.cfg.Chain)
	}
}

func TestTurnErrorIsPlain(t *testing.T) {
	e := turnError(&llm.RouteError{Failures: []llm.Failure{{Name: "Ollama", Code: 400, Message: llm.PlainText("Ollama", 400, "Request contains an invalid argument."), Raw: "HTTP 400: Request contains an invalid argument."}}})
	if msg := e["message"].(string); strings.Contains(msg, "HTTP 400") || !strings.Contains(msg, "Ollama") {
		t.Fatalf("message not plain: %q", msg)
	}
	if !strings.Contains(e["detail"].(string), "HTTP 400") {
		t.Fatal("raw detail should be kept for the Details toggle")
	}
	if e := turnError(&llm.RouteError{NoModels: true}); e["kind"] != "setup" {
		t.Fatal("no-model errors should offer setup")
	}
	e = turnError(&llm.PlanError{Status: 402, Code: "plan_limit", Message: "You've used today's tokens on Basic.", Upgrade: "pro"})
	if e["kind"] != "plan" || e["upgrade"] != true || e["tier"] != "pro" || e["message"] != "You've used today's tokens on Basic." {
		t.Fatalf("plan limit card: %+v", e)
	}
	e = turnError(&llm.PlanError{Status: 403, Code: "model_not_in_plan", Message: "Blaze Max needs the Max plan.", Required: "max"})
	if e["kind"] != "plan" || e["upgrade"] != true || e["tier"] != "max" {
		t.Fatalf("locked model card: %+v", e)
	}
	if e := turnError(&llm.PlanError{Status: 429, Code: "rate_limited", Message: "Too many"}); e["upgrade"] != false {
		t.Fatalf("a per-minute limit has no upgrade: %+v", e)
	}
	if e := turnError(llm.ErrSignedOut); e["kind"] != "signin" {
		t.Fatalf("signed out should send to sign-in: %+v", e)
	}
}
