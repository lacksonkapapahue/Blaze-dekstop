package config

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestSaveKeepsDesktopFields(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("BLAZE_HOME", dir)
	path := filepath.Join(dir, "config.json")
	in := `{"chain":[{"provider":"groq","model":"m"}],"persona":"old","model_for":{"groq":"x"},"default":{"provider":"auto","model":""},"keys":{"groq":"legacy"}}`
	if err := os.WriteFile(path, []byte(in), 0o600); err != nil {
		t.Fatal(err)
	}
	c := Load()
	c.Persona = "" // cleared omitempty field must disappear
	c.MaxSteps = 12
	if err := c.Save(); err != nil {
		t.Fatal(err)
	}
	var out map[string]any
	b, _ := os.ReadFile(path)
	if err := json.Unmarshal(b, &out); err != nil {
		t.Fatal(err)
	}
	if out["model_for"] == nil || out["default"] == nil || out["keys"] == nil {
		t.Fatalf("desktop/legacy fields dropped: %s", b)
	}
	if _, ok := out["persona"]; ok || out["max_steps"].(float64) != 12 {
		t.Fatalf("own fields wrong: %s", b)
	}
}

// Blaze takes no cloud API keys any more: a local server must be on this computer, and a
// default or chain entry left over from a cloud key is skipped (but kept in the file for Blaze CLI).
func TestOnlyBlazeAndLocalProviders(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("BLAZE_HOME", dir)
	in := `{"chain":[{"provider":"groq","model":"m"},{"provider":"ollama","model":"qwen3"}],"default":{"provider":"groq","model":"m"},"custom_base":"https://api.example.com/v1"}`
	if err := os.WriteFile(filepath.Join(dir, "config.json"), []byte(in), 0o600); err != nil {
		t.Fatal(err)
	}
	c := Load()
	if !c.IsAuto() {
		t.Fatal("a default on a provider Blaze no longer offers must count as Auto")
	}
	if ch := c.RouteChain(); len(ch) != 1 || ch[0].Provider != "ollama" {
		t.Fatalf("route chain should keep only local entries: %+v", ch)
	}
	if p, _ := ProviderByID(Custom); p.BaseURL != "" {
		t.Fatalf("a non-local custom server must not be used: %q", p.BaseURL)
	}
	c.CustomBase = "http://127.0.0.1:1234/v1"
	_ = c.Save()
	if p, _ := ProviderByID(Custom); p.BaseURL != "http://127.0.0.1:1234/v1" {
		t.Fatalf("local server not used: %q", p.BaseURL)
	}
	b, _ := os.ReadFile(filepath.Join(dir, "config.json"))
	if !strings.Contains(string(b), `"groq"`) {
		t.Fatalf("Blaze CLI's entries must survive a save: %s", b)
	}
	for _, id := range []string{"groq", "gemini", "openrouter", "pollinations"} {
		if _, ok := ProviderByID(id); ok {
			t.Fatalf("%s must not be a provider any more", id)
		}
	}
	for u, want := range map[string]bool{"http://localhost:8080/v1": true, "http://127.0.0.2:1/v1": true, "http://[::1]:11434/v1": true,
		"https://api.groq.com/openai/v1": false, "http://192.168.1.4:1234/v1": false, "ftp://127.0.0.1/": false, "": false} {
		if LocalURL(u) != want {
			t.Errorf("LocalURL(%q) = %v", u, !want)
		}
	}
}

func TestBlazeBase(t *testing.T) {
	defer SetBlazeBase("")
	if p, _ := ProviderByID(Blaze); p.BaseURL != DefaultBlazeBase+"/v1/" {
		t.Fatalf("default base %q", p.BaseURL)
	}
	SetBlazeBase("http://127.0.0.1:8787/")
	if p, _ := ProviderByID(Blaze); p.BaseURL != "http://127.0.0.1:8787/v1/" || p.Local {
		t.Fatalf("base %q local=%v", p.BaseURL, p.Local)
	}
}
