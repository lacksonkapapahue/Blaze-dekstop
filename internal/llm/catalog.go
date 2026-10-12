package llm

// Model catalog: what each model can do (tools, vision, context). Blaze's own models
// come from the plan (/v1/models, see blaze.go) with the built-in aliases below as a
// fallback; local servers (Ollama, LM Studio…) are listed live from their /models.

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/lacksonkapapahue/blaze-desktop/internal/config"
)

// Cap is a tri-state capability: yes, no, or not known (allowed, learned at run time).
type Cap string

const (
	Yes     Cap = "yes"
	No      Cap = "no"
	Unknown Cap = "unknown"
)

type ModelInfo struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Tools   Cap    `json:"tools"`
	Vision  bool   `json:"vision"`
	Context int    `json:"context"` // tokens, 0 = unknown
	Free    bool   `json:"free"`    // on the provider's free tier
	Note    string `json:"note,omitempty"`
	Live    bool   `json:"live"`  // seen in the provider's live list
	Known   bool   `json:"known"` // in Blaze's built-in table
	// Blaze plan models
	Tier   string `json:"tier,omitempty"`   // the lowest plan that may use it: basic | pro | max
	Locked bool   `json:"locked,omitempty"` // the user's plan doesn't include it
	Alias  bool   `json:"alias,omitempty"`  // a plan alias (Blaze Fast / Smart / Max)
	Desc   string `json:"desc,omitempty"`
}

// Catalog is Blaze's built-in knowledge of its plan aliases (the plan's live list,
// from the Blaze service, adds the rest).
var Catalog = map[string][]ModelInfo{
	config.Blaze: {
		{ID: "blaze-fast", Name: "Blaze Fast", Tools: Yes, Vision: true, Context: 131072, Free: true, Note: "Basic", Known: true, Tier: "basic"},
		{ID: "blaze-smart", Name: "Blaze Smart", Tools: Yes, Vision: true, Context: 1048576, Note: "Pro", Known: true, Tier: "pro"},
		{ID: "blaze-max", Name: "Blaze Max", Tools: Yes, Vision: true, Context: 1048576, Note: "Max", Known: true, Tier: "max"},
	},
}

var (
	nonChat = []string{"tts", "image", "imagen", "veo", "lyria", "embedding", "embed", "transcribe", "robotics", "native-audio",
		"audio", "computer-use", "omni", "banana", "aqa", "deep-research", "antigravity", "learnlm", "whisper", "dall-e",
		"moderation", "davinci", "babbage", "realtime", "sora", "rerank", "guard", "nemoretriever", "ocr", "speech", "-live", "live-"}
	noToolsRe = regexp.MustCompile(`(?i)(gemma|deepseek-r1|-r1\b|r1-distill|o1-mini|\bo1-preview|-base\b|instruct-v0\.1|search-preview)`)
	visionRe  = regexp.MustCompile(`(?i)(vision|-vl\b|-vl-|gemini|gpt-4o|gpt-4\.1|gpt-5|claude|pixtral|llava|llama-4|grok-4|mistral-small|mistral-medium)`)
)

// IsChat is false for embedding, speech, image and other non-chat models.
func IsChat(id string) bool {
	low := strings.ToLower(id)
	for _, s := range nonChat {
		if strings.Contains(low, s) {
			return false
		}
	}
	return true
}

// Info describes a model: the built-in entry when there is one, otherwise a guess from its name.
func Info(provider, model string) ModelInfo {
	if provider == config.Blaze {
		if mi, ok := BlazeModel(model); ok {
			return mi
		}
	}
	for _, mi := range Catalog[provider] {
		if mi.ID == model {
			return mi
		}
	}
	mi := ModelInfo{ID: model, Name: model, Tools: Unknown}
	if noToolsRe.MatchString(model) {
		mi.Tools = No
	}
	mi.Vision = visionRe.MatchString(model)
	mi.Free = config.Local(provider)
	return mi
}

// CanUseTools is false only when the model is known (or learned) not to support tool calls.
func CanUseTools(provider, model string) bool {
	if learnedNoTools(provider, model) {
		return false
	}
	return Info(provider, model).Tools != No
}

// ---------------- live list ----------------

type cacheEntry struct {
	At     time.Time   `json:"at"`
	Tag    string      `json:"tag"`
	Plan   string      `json:"plan,omitempty"`
	Models []ModelInfo `json:"models"`
}

var (
	cacheMu sync.Mutex
	cache   map[string]cacheEntry
)

func cachePath() string { return filepath.Join(config.Dir(), "desktop", "models-cache.json") }

func loadCache() {
	if cache != nil {
		return
	}
	cache = map[string]cacheEntry{}
	b, _ := os.ReadFile(cachePath())
	_ = json.Unmarshal(b, &cache)
}

func saveCache() {
	_ = os.MkdirAll(filepath.Dir(cachePath()), 0o700)
	b, _ := json.Marshal(cache)
	_ = os.WriteFile(cachePath(), b, 0o600)
}

// keyTag tells cached lists apart per key without storing the key.
func keyTag(p config.Provider, key string) string {
	h := uint32(2166136261)
	for _, c := range key + "|" + p.BaseURL {
		h = (h ^ uint32(c)) * 16777619
	}
	return p.ID + ":" + itoa(int(h))
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	var b []byte
	for n > 0 {
		b = append([]byte{byte('0' + n%10)}, b...)
		n /= 10
	}
	return string(b)
}

// ModelList is what Settings and the model picker show for one provider.
type ModelList struct {
	Provider string      `json:"provider"`
	Models   []ModelInfo `json:"models"`
	Plan     string      `json:"plan,omitempty"`
	Error    string      `json:"error,omitempty"`
	Fetched  string      `json:"fetched,omitempty"` // when the live list was fetched
}

// Options merges the built-in catalog with the provider's live list (cached for 12 h,
// or fetched now when refresh is set). Non-chat models are left out.
func Options(ctx context.Context, p config.Provider, key string, refresh bool) ModelList {
	out := ModelList{Provider: p.ID}
	var live []ModelInfo
	cacheMu.Lock()
	loadCache()
	ce, ok := cache[p.ID]
	cacheMu.Unlock()
	tag := keyTag(p, key)
	fresh := ok && ce.Tag == tag && time.Since(ce.At) < 12*time.Hour
	if fresh && !refresh {
		live, out.Plan = ce.Models, ce.Plan
		out.Fetched = ce.At.Format("Jan 2 15:04")
	} else if p.BaseURL != "" && (key != "" || p.Local) {
		ls, err := ListModels(ctx, p, key)
		if err != nil {
			out.Error = err.Error()
			if ok && ce.Tag == tag {
				live = ce.Models
				out.Fetched = ce.At.Format("Jan 2 15:04")
			}
		} else {
			live = ls
			cacheMu.Lock()
			cache[p.ID] = cacheEntry{At: time.Now(), Tag: tag, Plan: ce.Plan, Models: ls}
			saveCache()
			cacheMu.Unlock()
			out.Fetched = time.Now().Format("Jan 2 15:04")
		}
	}
	seen := map[string]int{}
	for _, mi := range Catalog[p.ID] {
		seen[mi.ID] = len(out.Models)
		out.Models = append(out.Models, mi)
	}
	for _, l := range live {
		if i, ok := seen[l.ID]; ok {
			k := out.Models[i]
			k.Live = true
			if l.Context > 0 {
				k.Context = l.Context
			}
			if l.Tools != Unknown && k.Tools == Unknown {
				k.Tools = l.Tools
			}
			if l.Note != "" {
				k.Note = l.Note
			}
			out.Models[i] = k
			continue
		}
		seen[l.ID] = len(out.Models)
		out.Models = append(out.Models, l)
	}
	for i := range out.Models {
		if learnedNoTools(p.ID, out.Models[i].ID) {
			out.Models[i].Tools = No
			out.Models[i].Note = strings.TrimPrefix(out.Models[i].Note+" · refused tools", " · ")
		}
	}
	// Built-in entries first, then live ones (stable before preview, newest first).
	sort.SliceStable(out.Models, func(i, j int) bool {
		a, b := out.Models[i], out.Models[j]
		if a.Known != b.Known {
			return a.Known
		}
		if a.Known {
			return false
		}
		if ra, rb := rank(a.ID), rank(b.ID); ra != rb {
			return ra < rb
		}
		return a.ID < b.ID
	})
	return out
}

func rank(id string) int {
	switch {
	case strings.Contains(id, "latest"):
		return 2
	case strings.Contains(id, "preview") || strings.Contains(id, "exp"):
		return 1
	}
	return 0
}

// ListModels asks a server which chat models it has (Ollama and other local servers).
func ListModels(ctx context.Context, p config.Provider, key string) ([]ModelInfo, error) {
	u := strings.TrimRight(p.BaseURL, "/") + "/models"
	req, _ := http.NewRequestWithContext(ctx, "GET", u, nil)
	for k, v := range AuthHeaders(p.ID, key) {
		req.Header.Set(k, v)
	}
	resp, err := (&http.Client{Timeout: 25 * time.Second}).Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 16<<20))
	if resp.StatusCode >= 300 {
		return nil, &HTTPError{Code: resp.StatusCode, Body: cleanErr(string(raw))}
	}
	var r struct {
		Data []struct {
			ID                  string   `json:"id"`
			Name                string   `json:"name"`
			DisplayName         string   `json:"display_name"`
			ContextLength       int      `json:"context_length"`
			ContextWindow       int      `json:"context_window"`
			MaxModelLen         int      `json:"max_model_len"`
			SupportedParameters []string `json:"supported_parameters"`
			Architecture        struct {
				InputModalities []string `json:"input_modalities"`
			} `json:"architecture"`
			Capabilities struct {
				FunctionCalling *bool `json:"function_calling"`
				Vision          *bool `json:"vision"`
			} `json:"capabilities"`
			Active *bool `json:"active"`
		} `json:"data"`
		Models []struct {
			Name  string `json:"name"`
			Model string `json:"model"`
		} `json:"models"`
	}
	_ = json.Unmarshal(raw, &r)
	var out []ModelInfo
	for _, d := range r.Data {
		id := strings.TrimPrefix(d.ID, "models/")
		if id == "" || !IsChat(id) || (d.Active != nil && !*d.Active) {
			continue
		}
		mi := Info(p.ID, id)
		mi.Known = false
		mi.Live = true
		if n := firstNonEmpty(d.DisplayName, d.Name); n != "" {
			mi.Name = n
		}
		mi.Context = max(d.ContextLength, d.ContextWindow, d.MaxModelLen)
		for _, s := range d.SupportedParameters {
			if s == "tools" {
				mi.Tools = Yes
			}
		}
		for _, s := range d.Architecture.InputModalities {
			if s == "image" {
				mi.Vision = true
			}
		}
		if d.Capabilities.FunctionCalling != nil {
			if *d.Capabilities.FunctionCalling {
				mi.Tools = Yes
			} else {
				mi.Tools = No
			}
		}
		if d.Capabilities.Vision != nil {
			mi.Vision = *d.Capabilities.Vision
		}
		out = append(out, mi)
	}
	for _, d := range r.Models { // Ollama's native shape, just in case
		id := firstNonEmpty(d.Model, d.Name)
		if id != "" && IsChat(id) {
			mi := Info(p.ID, id)
			mi.Live = true
			out = append(out, mi)
		}
	}
	return dedupe(out), nil
}

func dedupe(in []ModelInfo) []ModelInfo {
	seen := map[string]bool{}
	var out []ModelInfo
	for _, mi := range in {
		if !seen[mi.ID] {
			seen[mi.ID] = true
			out = append(out, mi)
		}
	}
	return out
}

func firstNonEmpty(s ...string) string {
	for _, x := range s {
		if strings.TrimSpace(x) != "" {
			return x
		}
	}
	return ""
}

// PickModel chooses a sensible default from a provider's list: the catalog's default
// when listed, else the strongest tool-capable chat model.
func PickModel(provider string, ids []string) string {
	if p, ok := config.ProviderByID(provider); ok && p.DefaultModel != "" {
		for _, id := range ids {
			if id == p.DefaultModel {
				return id
			}
		}
		if len(ids) == 0 {
			return p.DefaultModel
		}
	}
	for _, mi := range Catalog[provider] {
		for _, id := range ids {
			if id == mi.ID && mi.Tools == Yes {
				return id
			}
		}
	}
	best, bestScore := "", -1
	weak := regexp.MustCompile(`(?i)(embed|guard|vision|-vl|ocr|reward|whisper|tts|audio|image|moderation|rerank|\b[0-9]b\b|\b(0\.5|1|1\.5|2|3|4|7|8)b\b|mini|nano|tiny|lite)`)
	strong := []string{"gpt-oss-120b", "kimi", "qwen3", "deepseek", "llama-4", "llama-3.3-70b", "glm", "gemini", "mistral-large", "mistral-medium", "nemotron", "grok", "claude", "gpt-5", "gpt-4.1"}
	for _, id := range ids {
		if weak.MatchString(id) || !CanUseTools(provider, id) || !IsChat(id) {
			continue
		}
		score := 0
		for i, s := range strong {
			if strings.Contains(strings.ToLower(id), s) {
				score = len(strong) - i
				break
			}
		}
		if score > bestScore {
			best, bestScore = id, score
		}
	}
	if best == "" && len(ids) > 0 {
		best = ids[0]
	}
	return best
}
