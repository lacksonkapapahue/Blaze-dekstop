// Package config keeps Blaze's settings in ~/.blaze/config.json.
//
// Models come from the user's Blaze plan (provider "blaze", served by blaze-auth's
// /v1/chat/completions with the account's session token) or from a model server on this
// computer (Ollama, or any OpenAI-compatible server on localhost). Blaze no longer
// takes the user's own cloud API keys.
//
// The file is shared with Blaze CLI. Every field added since v0.2 is optional
// (omitempty) so an older config.json loads unchanged and an older CLI simply
// ignores what it doesn't know. Save keeps fields it doesn't know (and legacy keys an
// older Blaze still reads) instead of dropping them.
package config

import (
	"encoding/json"
	"net"
	"net/url"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
)

type Provider struct {
	ID, Name, BaseURL, DefaultModel string
	Local                           bool   // runs on this computer, needs no account
	Page                            string // where to get it (Ollama's download page)
}

// Blaze is the managed provider: the models of the user's Blaze plan.
const Blaze = "blaze"

// Custom is a local OpenAI-compatible server (LM Studio, llama.cpp, vLLM…), base URL in
// Config.CustomBase. Only loopback addresses are accepted.
const Custom = "custom"

// DefaultBlazeBase is the deployed blaze-auth Worker (the app points it elsewhere with SetBlazeBase).
const DefaultBlazeBase = "https://blaze-auth.blaze-app.workers.dev"

// Providers Blaze can route to.
var Providers = []Provider{
	{ID: Blaze, Name: "Blaze", BaseURL: DefaultBlazeBase + "/v1/", DefaultModel: "blaze-fast"},
	{ID: "ollama", Name: "Ollama (local)", BaseURL: "http://127.0.0.1:11434/v1/", Local: true, Page: "https://ollama.com/download"},
	{ID: Custom, Name: "Local server (OpenAI-compatible)", Local: true},
}

var (
	cmu        sync.RWMutex
	customBase string
	blazeBase  string
)

// SetBlazeBase points the Blaze provider at a blaze-auth Worker (its base URL, without /v1).
func SetBlazeBase(base string) {
	cmu.Lock()
	blazeBase = strings.TrimRight(strings.TrimSpace(base), "/")
	cmu.Unlock()
}

// LocalURL is true for an http(s) URL on this computer (localhost, 127.0.0.0/8, ::1).
func LocalURL(u string) bool {
	p, err := url.Parse(strings.TrimSpace(u))
	if err != nil || (p.Scheme != "http" && p.Scheme != "https") || p.Host == "" {
		return false
	}
	h := p.Hostname()
	if strings.EqualFold(h, "localhost") {
		return true
	}
	ip := net.ParseIP(h)
	return ip != nil && ip.IsLoopback()
}

func ProviderByID(id string) (Provider, bool) {
	for _, p := range Providers {
		if p.ID == id {
			cmu.RLock()
			switch id {
			case Custom:
				p.BaseURL = ""
				if LocalURL(customBase) {
					p.BaseURL = customBase
				}
			case Blaze:
				if blazeBase != "" {
					p.BaseURL = blazeBase + "/v1/"
				}
			}
			cmu.RUnlock()
			return p, true
		}
	}
	return Provider{}, false
}

// Local is true for a provider that runs on this computer (no account needed).
func Local(id string) bool {
	p, ok := ProviderByID(id)
	return ok && p.Local
}

// Name is the provider's display name without the bracketed note ("Ollama (local)" -> "Ollama").
func Name(id string) string {
	if p, ok := ProviderByID(id); ok {
		if i := strings.Index(p.Name, " ("); i > 0 {
			return p.Name[:i]
		}
		return p.Name
	}
	return id
}

type Entry struct {
	Provider string `json:"provider"`
	Model    string `json:"model"`
}

type Config struct {
	Chain       []Entry `json:"chain"`        // tried in order; first healthy one answers
	AutoApprove bool    `json:"auto_approve"` // --yolo default
	SetupDone   bool    `json:"setup_done"`
	MaxSteps    int     `json:"max_steps"`
	Persona     string  `json:"persona,omitempty"`

	// v0.3 (desktop): model choice. Default nil, provider "auto" or a provider this Blaze
	// doesn't offer any more = Auto (the plan's model, then local models in Chain).
	Default    *Entry            `json:"default,omitempty"`
	ModelFor   map[string]string `json:"model_for,omitempty"`   // chosen model per provider
	NoFastest  bool              `json:"no_fastest,omitempty"`  // Auto keeps strict chain order
	CustomBase string            `json:"custom_base,omitempty"` // base URL of the local OpenAI-compatible server
	CustomName string            `json:"custom_name,omitempty"` // label for it

	// Private vision (desktop v0.8.3, shared with Blaze CLI): pictures never leave the
	// computer. The OS's own OCR and a local colour/size readout turn each image into
	// text, and only that text goes to cloud models.
	PrivateVision bool `json:"private_vision,omitempty"`
	path          string
}

// Auto is the provider id that means "the plan's model, then local fallbacks".
const Auto = "auto"

func Dir() string {
	if d := os.Getenv("BLAZE_HOME"); d != "" {
		return d
	}
	h, _ := os.UserHomeDir()
	return filepath.Join(h, ".blaze")
}

func Load() *Config {
	c := &Config{MaxSteps: 30, path: filepath.Join(Dir(), "config.json")}
	if b, err := os.ReadFile(c.path); err == nil {
		_ = json.Unmarshal(b, c)
	}
	if c.MaxSteps <= 0 {
		c.MaxSteps = 30
	}
	c.applyCustom()
	return c
}

func (c *Config) applyCustom() {
	cmu.Lock()
	customBase = strings.TrimSpace(c.CustomBase)
	cmu.Unlock()
}

func (c *Config) Save() error {
	if err := os.MkdirAll(Dir(), 0o700); err != nil {
		return err
	}
	c.applyCustom()
	raw := map[string]json.RawMessage{}
	if b, err := os.ReadFile(c.path); err == nil {
		_ = json.Unmarshal(b, &raw)
	}
	for _, n := range jsonNames(reflect.TypeOf(*c)) {
		delete(raw, n) // cleared omitempty fields must go, not linger
	}
	mine := map[string]json.RawMessage{}
	b, _ := json.Marshal(c)
	_ = json.Unmarshal(b, &mine)
	for k, v := range mine {
		raw[k] = v
	}
	out, _ := json.MarshalIndent(raw, "", "  ")
	tmp, err := os.CreateTemp(filepath.Dir(c.path), ".config.json.*")
	if err != nil {
		return err
	}
	_ = tmp.Chmod(0o600)
	_, werr := tmp.Write(out)
	if cerr := tmp.Close(); werr == nil {
		werr = cerr
	}
	if werr != nil {
		os.Remove(tmp.Name())
		return werr
	}
	if err := os.Rename(tmp.Name(), c.path); err != nil {
		os.Remove(tmp.Name())
		return err
	}
	return nil
}

// jsonNames are the config.json field names a struct owns.
func jsonNames(t reflect.Type) []string {
	var out []string
	for i := 0; i < t.NumField(); i++ {
		f := t.Field(i)
		if !f.IsExported() {
			continue
		}
		n, _, _ := strings.Cut(f.Tag.Get("json"), ",")
		if n == "-" {
			continue
		}
		if n == "" {
			n = f.Name
		}
		out = append(out, n)
	}
	return out
}

// IsAuto is true when no fixed default model is chosen. A default on a provider Blaze
// no longer offers (a cloud key from before managed plans) counts as Auto.
func (c *Config) IsAuto() bool {
	if c.Default == nil || c.Default.Provider == "" || c.Default.Provider == Auto {
		return true
	}
	_, ok := ProviderByID(c.Default.Provider)
	return !ok
}

// Model is the model Blaze uses for a provider: the user's pick, then its chain entry, then the built-in default.
func (c *Config) Model(provider string) string {
	if m := c.ModelFor[provider]; m != "" {
		return m
	}
	for _, e := range c.Chain {
		if e.Provider == provider && e.Model != "" {
			return e.Model
		}
	}
	if p, ok := ProviderByID(provider); ok {
		return p.DefaultModel
	}
	return ""
}

func (c *Config) SetModelFor(provider, model string) {
	if c.ModelFor == nil {
		c.ModelFor = map[string]string{}
	}
	c.ModelFor[provider] = model
}

// ---------------- routing helpers ----------------

// RouteChain is the Auto chain's local entries (Ollama, a local server), in order. The
// plan's Blaze model always goes first and isn't a chain entry; entries for providers
// Blaze no longer offers (cloud keys from before managed plans, still read by an older
// Blaze CLI) are kept in the file but skipped here.
func (c *Config) RouteChain() []Entry {
	var ch []Entry
	for _, e := range c.Chain {
		if e.Provider != "" && Local(e.Provider) {
			ch = append(ch, e)
		}
	}
	return ch
}
