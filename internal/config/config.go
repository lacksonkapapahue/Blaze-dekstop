// Package config keeps Blaze's settings in ~/.blaze/config.json and API keys in
// the OS keychain (Windows Credential Manager, macOS Keychain, Linux Secret
// Service), falling back to the config file (mode 0600) when no keychain exists.
//
// The file is shared with Blaze CLI. Every field added since v0.2 is optional
// (omitempty) so an older config.json loads unchanged and an older CLI simply
// ignores what it doesn't know.
package config

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"github.com/zalando/go-keyring"
)

const service = "blaze-cli"

type Provider struct {
	ID, Name, BaseURL, DefaultModel, KeyHint, KeyPage, Env string
	Free                                                   bool
	QuotaPage                                              string
}

// Custom is the id of the user's own OpenAI-compatible service (base URL in Config.CustomBase).
const Custom = "custom"

// Keyless is the keyless public endpoint: plain chat only, it can't call tools.
const KeylessID = "pollinations"

// Providers mirrors the Android app's list (all OpenAI-compatible).
var Providers = []Provider{
	{"gemini", "Google Gemini", "https://generativelanguage.googleapis.com/v1beta/openai/", "gemini-3.8-flash", "AIza…", "https://aistudio.google.com/apikey", "GEMINI_API_KEY", true, "https://aistudio.google.com/rate-limit?timeRange=last-28-days"},
	{"groq", "Groq", "https://api.groq.com/openai/v1/", "llama-3.3-70b-versatile", "gsk_…", "https://console.groq.com/keys", "GROQ_API_KEY", true, "https://console.groq.com/settings/limits"},
	{"cerebras", "Cerebras", "https://api.cerebras.ai/v1/", "gpt-oss-120b", "csk-…", "https://cloud.cerebras.ai/platform", "CEREBRAS_API_KEY", true, "https://cloud.cerebras.ai/platform"},
	{"openrouter", "OpenRouter", "https://openrouter.ai/api/v1/", "", "sk-or-…", "https://openrouter.ai/settings/keys", "OPENROUTER_API_KEY", true, "https://openrouter.ai/settings/credits"},
	{"mistral", "Mistral", "https://api.mistral.ai/v1/", "mistral-small-latest", "…", "https://console.mistral.ai/api-keys", "MISTRAL_API_KEY", true, "https://admin.mistral.ai/plateforme/limits"},
	{"nvidia", "NVIDIA NIM", "https://integrate.api.nvidia.com/v1/", "meta/llama-3.3-70b-instruct", "nvapi-…", "https://build.nvidia.com/settings/api-keys", "NVIDIA_API_KEY", true, "https://build.nvidia.com/"},
	{"deepseek", "DeepSeek", "https://api.deepseek.com/v1/", "deepseek-chat", "sk-…", "https://platform.deepseek.com/api_keys", "DEEPSEEK_API_KEY", false, "https://platform.deepseek.com/usage"},
	{"moonshot", "Kimi (Moonshot)", "https://api.moonshot.ai/v1/", "", "sk-…", "https://platform.moonshot.ai/console/api-keys", "MOONSHOT_API_KEY", false, "https://platform.moonshot.ai/console/limits"},
	{"openai", "ChatGPT (OpenAI)", "https://api.openai.com/v1/", "", "sk-…", "https://platform.openai.com/api-keys", "OPENAI_API_KEY", false, "https://platform.openai.com/settings/organization/limits"},
	{"anthropic", "Claude (Anthropic)", "https://api.anthropic.com/v1/", "", "sk-ant-…", "https://console.anthropic.com/settings/keys", "ANTHROPIC_API_KEY", false, "https://console.anthropic.com/settings/limits"},
	{"xai", "Grok (xAI)", "https://api.x.ai/v1/", "", "xai-…", "https://console.x.ai/", "XAI_API_KEY", false, "https://console.x.ai/"},
	{"ollama", "Ollama (local)", "http://127.0.0.1:11434/v1/", "", "(no key)", "https://ollama.com/download", "", true, ""},
	{Custom, "Custom (OpenAI-compatible)", "", "", "Your key", "", "", false, ""},
	{KeylessID, "Pollinations (keyless)", "https://text.pollinations.ai/openai/", "openai-fast", "(no key)", "https://pollinations.ai", "", true, ""},
}

// FreeOrder is the default fill-first order for Auto (providers with a real free tier).
var FreeOrder = []string{"gemini", "groq", "cerebras", "nvidia", "openrouter", "mistral", "deepseek", "moonshot"}

var (
	cmu        sync.RWMutex
	customBase string
)

func ProviderByID(id string) (Provider, bool) {
	for _, p := range Providers {
		if p.ID == id {
			if id == Custom {
				cmu.RLock()
				p.BaseURL = customBase
				cmu.RUnlock()
			}
			return p, true
		}
	}
	return Provider{}, false
}

// Name is the provider's display name without the bracketed note ("Kimi (Moonshot)" -> "Kimi").
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
	Chain       []Entry           `json:"chain"`          // tried in order; first healthy one answers
	Keys        map[string]string `json:"keys,omitempty"` // only when no keychain is available
	AutoApprove bool              `json:"auto_approve"`   // --yolo default
	SetupDone   bool              `json:"setup_done"`
	MaxSteps    int               `json:"max_steps"`
	Persona     string            `json:"persona,omitempty"`
	NoKeyless   bool              `json:"no_keyless,omitempty"` // don't fall back to the keyless model

	// v0.3 (desktop): model choice. Default nil or provider "auto" = Auto (free routing over Chain).
	Default    *Entry            `json:"default,omitempty"`
	ModelFor   map[string]string `json:"model_for,omitempty"`   // chosen model per provider
	NoFallback bool              `json:"no_fallback,omitempty"` // a fixed model doesn't fall back to the chain
	NoFastest  bool              `json:"no_fastest,omitempty"`  // Auto keeps strict chain order
	DailyCap   float64           `json:"daily_cap,omitempty"`   // USD; past it a paid default switches to Auto
	CustomBase string            `json:"custom_base,omitempty"` // base URL of the custom provider
	CustomName string            `json:"custom_name,omitempty"` // label for it
	path       string
}

// Auto is the provider id that means "free routing".
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
	b, _ := json.MarshalIndent(c, "", "  ")
	return os.WriteFile(c.path, b, 0o600)
}

// IsAuto is true when no fixed default model is chosen.
func (c *Config) IsAuto() bool {
	return c.Default == nil || c.Default.Provider == "" || c.Default.Provider == Auto
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

// ---------------- keys ----------------

// Key returns the provider's main key: env var first, then keychain, then the file.
func (c *Config) Key(provider string) string {
	if p, ok := ProviderByID(provider); ok && p.Env != "" {
		if v := strings.TrimSpace(os.Getenv(p.Env)); v != "" {
			return v
		}
	}
	if v, err := keyring.Get(service, provider); err == nil && v != "" {
		return v
	}
	return c.Keys[provider]
}

// SetKey stores a key in the keychain when possible. Returns where it went.
func (c *Config) SetKey(provider, key string) (string, error) {
	key = strings.TrimSpace(key)
	if err := keyring.Set(service, provider, key); err == nil {
		if c.Keys != nil {
			delete(c.Keys, provider)
		}
		return "your system keychain", c.Save()
	}
	if c.Keys == nil {
		c.Keys = map[string]string{}
	}
	c.Keys[provider] = key
	return "~/.blaze/config.json (owner-only)", c.Save()
}

// DeleteKey removes every key of a provider (main and extras).
func (c *Config) DeleteKey(provider string) {
	_ = keyring.Delete(service, provider)
	_ = keyring.Delete(service, provider+extraSuffix)
	delete(c.Keys, provider)
	delete(c.Keys, provider+extraSuffix)
	_ = c.Save()
}

const extraSuffix = "#extra"

// ExtraKeys are the provider's additional keys (the key ring), stored as one JSON list.
func (c *Config) ExtraKeys(provider string) []string {
	raw := ""
	if v, err := keyring.Get(service, provider+extraSuffix); err == nil {
		raw = v
	} else {
		raw = c.Keys[provider+extraSuffix]
	}
	var out []string
	_ = json.Unmarshal([]byte(raw), &out)
	return out
}

func (c *Config) setExtras(provider string, l []string) error {
	if len(l) == 0 {
		_ = keyring.Delete(service, provider+extraSuffix)
		delete(c.Keys, provider+extraSuffix)
		return c.Save()
	}
	b, _ := json.Marshal(l)
	if err := keyring.Set(service, provider+extraSuffix, string(b)); err == nil {
		delete(c.Keys, provider+extraSuffix)
		return c.Save()
	}
	if c.Keys == nil {
		c.Keys = map[string]string{}
	}
	c.Keys[provider+extraSuffix] = string(b)
	return c.Save()
}

// AllKeys is the key ring: the main key first, then the extras, without duplicates.
func (c *Config) AllKeys(provider string) []string {
	var out []string
	seen := map[string]bool{}
	for _, k := range append([]string{c.Key(provider)}, c.ExtraKeys(provider)...) {
		k = strings.TrimSpace(k)
		if k != "" && !seen[k] {
			seen[k] = true
			out = append(out, k)
		}
	}
	return out
}

// AddKey adds a key to the ring: it becomes the main key when there is none yet.
// Returns where it was stored, or "" when it was already saved.
func (c *Config) AddKey(provider, key string) (string, error) {
	key = strings.TrimSpace(key)
	for _, k := range c.AllKeys(provider) {
		if k == key {
			return "", nil
		}
	}
	if c.Key(provider) == "" {
		return c.SetKey(provider, key)
	}
	ex := append(c.ExtraKeys(provider), key)
	if err := c.setExtras(provider, ex); err != nil {
		return "", err
	}
	if _, err := keyring.Get(service, provider+extraSuffix); err == nil {
		return "your system keychain", nil
	}
	return "~/.blaze/config.json (owner-only)", nil
}

// RemoveKey removes one key from the ring. Removing the main key promotes the first extra.
func (c *Config) RemoveKey(provider, key string) error {
	ex := c.ExtraKeys(provider)
	var keep []string
	for _, k := range ex {
		if k != key {
			keep = append(keep, k)
		}
	}
	if c.Key(provider) == key {
		_ = keyring.Delete(service, provider)
		delete(c.Keys, provider)
		if len(keep) > 0 {
			if _, err := c.SetKey(provider, keep[0]); err != nil {
				return err
			}
			keep = keep[1:]
		}
	}
	return c.setExtras(provider, keep)
}

// ---------------- routing helpers ----------------

// HasAnyModel is true when at least one chain entry has what it needs.
func (c *Config) HasAnyModel() bool {
	for _, e := range c.Chain {
		if (Keyless(e.Provider) && e.Provider != KeylessID) || c.Key(e.Provider) != "" {
			return true
		}
	}
	if !c.IsAuto() && (c.Key(c.Default.Provider) != "" || c.Default.Provider == "ollama") {
		return true
	}
	return false
}

// Keyless providers need no API key.
func Keyless(id string) bool { return id == "ollama" || id == KeylessID }

// RouteChain is the chain without the keyless model; keyless is only ever a plain-chat
// last resort and is added by the router itself, never as a chain entry.
func (c *Config) RouteChain() []Entry {
	var ch []Entry
	for _, e := range c.Chain {
		if e.Provider != KeylessID && e.Provider != "" {
			ch = append(ch, e)
		}
	}
	return ch
}

// AllowKeyless is whether the keyless model may answer plain chat when nothing else can.
func (c *Config) AllowKeyless() bool { return !c.NoKeyless }
