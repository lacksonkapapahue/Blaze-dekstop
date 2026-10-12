package main

// Models: what Settings › Models, the model chip and /model use.
//
// Blaze's models come with the user's plan (provider "blaze", through the Blaze account;
// see plan.go). Local models (Ollama, or an OpenAI-compatible server on this computer)
// work offline and without an account. Blaze takes no cloud API keys.

import (
	"context"
	"fmt"
	"strings"
	"time"

	wr "github.com/wailsapp/wails/v2/pkg/runtime"

	"github.com/lacksonkapapahue/blaze-desktop/internal/config"
	"github.com/lacksonkapapahue/blaze-desktop/internal/llm"
)

type ProviderView struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Short   string `json:"short"`
	Local   bool   `json:"local"`    // runs on this computer
	Page    string `json:"page"`     // where to get it (Ollama)
	Model   string `json:"model"`    // the model Blaze uses for it
	InChain bool   `json:"in_chain"` // a local model Auto may use
	Ready   bool   `json:"ready"`    // usable now (signed in, or set up locally)
	Base    string `json:"base,omitempty"`
}

// Selection is the default model: Auto, or one provider + model.
type Selection struct {
	Auto     bool   `json:"auto"`
	Provider string `json:"provider"`
	Model    string `json:"model"`
	Label    string `json:"label"` // "Auto" or "Blaze · blaze-smart"
}

type RoutingView struct {
	FastestFirst bool `json:"fastest_first"` // Auto puts the fastest healthy local model first
}

func (a *App) signedIn() bool {
	if a.cloud == nil {
		return false
	}
	a.cloud.mu.Lock()
	defer a.cloud.mu.Unlock()
	return a.cloud.user != nil
}

func (a *App) providerViews() []ProviderView {
	inChain := map[string]bool{}
	for _, e := range a.cfg.RouteChain() {
		inChain[e.Provider] = true
	}
	var out []ProviderView
	for _, p := range config.Providers {
		v := ProviderView{ID: p.ID, Name: p.Name, Short: config.Name(p.ID), Local: p.Local, Page: p.Page, Model: a.cfg.Model(p.ID), InChain: inChain[p.ID]}
		switch p.ID {
		case config.Blaze:
			v.Ready = a.signedIn()
			if a.cfg.IsAuto() || a.cfg.Default.Provider != config.Blaze {
				v.Model = llm.BlazeDefault()
			}
		case config.Custom:
			v.Base = a.cfg.CustomBase
			if a.cfg.CustomName != "" {
				v.Short = a.cfg.CustomName
			}
			v.Ready = config.LocalURL(a.cfg.CustomBase) && (v.InChain || !a.cfg.IsAuto() && a.cfg.Default.Provider == config.Custom)
		default:
			v.Ready = v.InChain || !a.cfg.IsAuto() && a.cfg.Default.Provider == p.ID
		}
		out = append(out, v)
	}
	return out
}

func (a *App) selection() Selection {
	if a.cfg.IsAuto() {
		return Selection{Auto: true, Provider: config.Auto, Label: "Auto"}
	}
	d := a.cfg.Default
	m := d.Model
	if m == "" {
		m = a.cfg.Model(d.Provider)
	}
	return Selection{Provider: d.Provider, Model: m, Label: config.Name(d.Provider) + " · " + m}
}

func (a *App) routing() RoutingView { return RoutingView{FastestFirst: !a.cfg.NoFastest} }

// modelName is what the model chip shows before a turn has answered.
func (a *App) modelName() string {
	if !a.cfg.IsAuto() {
		return a.selection().Label
	}
	if t := llm.Targets(a.cfg, true); len(t) > 0 {
		return "Auto · " + t[0].Name + " · " + t[0].Model
	}
	return "Auto"
}

// ---------------- choosing ----------------

// blazeList is the plan's models for the pickers: every model the service offers, the
// ones above the plan marked locked with the plan they need.
func (a *App) blazeList(refresh bool) llm.ModelList {
	if refresh || len(llm.BlazeModels()) == 0 {
		a.refreshPlan(true)
	}
	out := llm.ModelList{Provider: config.Blaze}
	ms := llm.BlazeModels()
	if len(ms) == 0 {
		ms = llm.Catalog[config.Blaze]
		if !a.signedIn() {
			out.Error = "Sign in to your Blaze account to use Blaze's models."
		}
	}
	rank := map[string]int{"basic": 0, "pro": 1, "max": 2}
	sortModels(ms, func(x, y llm.ModelInfo) bool {
		if x.Alias != y.Alias {
			return x.Alias
		}
		if rank[x.Tier] != rank[y.Tier] {
			return rank[x.Tier] < rank[y.Tier]
		}
		return x.Name < y.Name
	})
	out.Models = ms
	if p := a.planNow(); p != nil {
		out.Plan = p.Plan.Name
	}
	return out
}

func sortModels(ms []llm.ModelInfo, less func(x, y llm.ModelInfo) bool) {
	for i := 1; i < len(ms); i++ {
		for j := i; j > 0 && less(ms[j], ms[j-1]); j-- {
			ms[j], ms[j-1] = ms[j-1], ms[j]
		}
	}
}

// ModelOptions lists one provider's models: the plan's models for Blaze (locked ones
// marked), or what a local server has (cached; refresh fetches it now).
func (a *App) ModelOptions(provider string, refresh bool) llm.ModelList {
	a.waitReady()
	if provider == config.Blaze {
		return a.blazeList(refresh)
	}
	p, ok := config.ProviderByID(provider)
	if !ok {
		return llm.ModelList{Provider: provider, Error: "Unknown provider."}
	}
	if p.BaseURL == "" {
		return llm.ModelList{Provider: provider, Error: "Set the local server's address first (it ends in /v1)."}
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	l := llm.Options(ctx, p, "", refresh)
	if l.Error != "" {
		l.Error = llm.PlainText(config.Name(provider), 0, l.Error)
	}
	return l
}

// lockedMessage says which plan a Blaze model needs ("" when the plan has it).
func lockedMessage(provider, model string) string {
	if provider != config.Blaze {
		return ""
	}
	mi, ok := llm.BlazeModel(model)
	if !ok || !mi.Locked {
		return ""
	}
	return fmt.Sprintf("%s needs the %s plan.", mi.Name, titleTier(mi.Tier))
}

func titleTier(t string) string {
	if t == "" {
		return ""
	}
	return strings.ToUpper(t[:1]) + t[1:]
}

// SelectModel makes a model the default. provider "auto" switches to Auto. An empty
// model uses the provider's current model. Returns the chip label. A Blaze model above
// the plan isn't selected (the picker offers Upgrade instead).
func (a *App) SelectModel(provider, model string) string {
	a.waitReady()
	if provider == "" || provider == config.Auto {
		a.cfg.Default = nil
		_ = a.cfg.Save()
		a.emitModel()
		return a.modelName()
	}
	if _, ok := config.ProviderByID(provider); !ok {
		return "Unknown provider."
	}
	if model == "" {
		model = a.cfg.Model(provider)
	}
	if lockedMessage(provider, model) != "" || !llm.CanUseTools(provider, model) {
		return a.modelName() // a locked model, or one that can't call tools, is never the default
	}
	a.cfg.Default = &config.Entry{Provider: provider, Model: model}
	a.cfg.SetModelFor(provider, model)
	for i, e := range a.cfg.Chain {
		if e.Provider == provider {
			a.cfg.Chain[i].Model = model
		}
	}
	_ = a.cfg.Save()
	a.emitModel()
	return a.modelName()
}

// SetProviderModel sets which model a local provider uses (in the chain and as default if it is the default).
func (a *App) SetProviderModel(provider, model string) {
	a.cfg.SetModelFor(provider, model)
	for i, e := range a.cfg.Chain {
		if e.Provider == provider {
			a.cfg.Chain[i].Model = model
		}
	}
	if !a.cfg.IsAuto() && a.cfg.Default.Provider == provider {
		a.cfg.Default.Model = model
	}
	_ = a.cfg.Save()
	a.emitModel()
}

func (a *App) emitModel() {
	if a.ctx != nil {
		wr.EventsEmit(a.ctx, "model", map[string]any{"label": a.modelName(), "selection": a.selection()})
	}
}

type ModelItem struct {
	Provider string `json:"provider"`
	Name     string `json:"name"`
	Model    string `json:"model"`
	Tools    bool   `json:"tools"`
	Current  bool   `json:"current"`
	Ready    bool   `json:"ready"`
	Locked   bool   `json:"locked,omitempty"`
	Tier     string `json:"tier,omitempty"`
}

// Models lists what the /model menu offers: Auto first, then Blaze's models (locked ones
// marked with the plan they need), then each local model that is set up.
func (a *App) Models() []ModelItem {
	a.waitReady()
	sel := a.selection()
	out := []ModelItem{{Provider: config.Auto, Name: "Auto", Model: "your plan's model, then your local models", Tools: true, Current: sel.Auto, Ready: true}}
	if a.signedIn() {
		for _, m := range a.blazeList(false).Models {
			out = append(out, ModelItem{Provider: config.Blaze, Name: m.Name, Model: m.ID, Tools: m.Tools != llm.No, Ready: !m.Locked, Locked: m.Locked, Tier: m.Tier,
				Current: !sel.Auto && sel.Provider == config.Blaze && sel.Model == m.ID})
		}
	}
	for _, p := range a.providerViews() {
		if !p.Local || !p.Ready {
			continue
		}
		out = append(out, ModelItem{Provider: p.ID, Name: p.Short, Model: p.Model, Tools: llm.CanUseTools(p.ID, p.Model), Current: !sel.Auto && sel.Provider == p.ID, Ready: true})
	}
	return out
}

// UseModel makes a provider (with its current model) the default. Kept for older callers.
func (a *App) UseModel(provider string) string { return a.SelectModel(provider, "") }

// ---------------- local models ----------------

// LocalResult answers adding a local model server.
type LocalResult struct {
	OK     bool   `json:"ok"`
	Model  string `json:"model"`
	Error  string `json:"error"`
	Models int    `json:"models"`
}

// AddLocal checks a local model server (Ollama, or the local OpenAI-compatible server)
// is running, picks a model that can use tools, and lets Auto use it after Blaze.
func (a *App) AddLocal(id string) LocalResult {
	a.waitReady()
	p, ok := config.ProviderByID(id)
	if !ok || !p.Local {
		return LocalResult{Error: "Only models on this computer can be added. Blaze's own models come with your plan."}
	}
	if id == config.Custom && p.BaseURL == "" {
		return LocalResult{Error: "Enter the local server's address first, like http://127.0.0.1:1234/v1."}
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	ls, err := llm.ListModels(ctx, p, "")
	if err != nil {
		if id == "ollama" {
			return LocalResult{Error: "Ollama isn't running. Start it, then try again."}
		}
		return LocalResult{Error: "Couldn't reach the local server: " + llm.PlainText(config.Name(id), 0, err.Error())}
	}
	var ids []string
	for _, m := range ls {
		ids = append(ids, m.ID)
	}
	model := a.cfg.ModelFor[id]
	if model == "" {
		model = llm.PickModel(id, ids)
	}
	if model == "" {
		if id == "ollama" {
			return LocalResult{Error: "Ollama has no models yet. Run `ollama pull qwen3` (or another model that can use tools), then try again."}
		}
		return LocalResult{Error: "The local server lists no chat models."}
	}
	a.cfg.SetModelFor(id, model)
	found := false
	for i, e := range a.cfg.Chain {
		if e.Provider == id {
			found = true
			if e.Model == "" {
				a.cfg.Chain[i].Model = model
			}
		}
	}
	if !found {
		a.cfg.Chain = append(a.cfg.Chain, config.Entry{Provider: id, Model: model})
	}
	_ = a.cfg.Save()
	llm.ClearHealth(id)
	a.emitModel()
	return LocalResult{OK: true, Model: model, Models: len(ls)}
}

// RemoveProvider takes a local model out of Auto and drops it as default.
func (a *App) RemoveProvider(id string) {
	var chain []config.Entry
	for _, e := range a.cfg.Chain {
		if e.Provider != id {
			chain = append(chain, e)
		}
	}
	a.cfg.Chain = chain
	if !a.cfg.IsAuto() && a.cfg.Default.Provider == id {
		a.cfg.Default = nil
	}
	_ = a.cfg.Save()
	a.emitModel()
}

// SetCustomProvider sets the local OpenAI-compatible server. Only addresses on this
// computer are accepted. Returns "" or what's wrong.
func (a *App) SetCustomProvider(base, name string) string {
	base = strings.TrimSpace(base)
	if base != "" && !strings.HasPrefix(base, "http") {
		base = "http://" + base
	}
	if base != "" && !config.LocalURL(base) {
		return "Blaze only talks to model servers on this computer (localhost or 127.0.0.1). Its cloud models come with your plan."
	}
	a.cfg.CustomBase, a.cfg.CustomName = base, strings.TrimSpace(name)
	_ = a.cfg.Save()
	return ""
}

// SetChain reorders the local models Auto may use after Blaze.
func (a *App) SetChain(chain []config.Entry) {
	var clean []config.Entry
	for _, e := range chain {
		if e.Provider != "" && config.Local(e.Provider) {
			if e.Model == "" {
				e.Model = a.cfg.Model(e.Provider)
			}
			clean = append(clean, e)
		}
	}
	// Keep entries this Blaze doesn't route to (an older Blaze CLI may still use them).
	for _, e := range a.cfg.Chain {
		if _, ok := config.ProviderByID(e.Provider); !ok {
			clean = append(clean, e)
		}
	}
	a.cfg.Chain = clean
	_ = a.cfg.Save()
	a.emitModel()
}

// SetRouting saves the routing switches.
func (a *App) SetRouting(r RoutingView) {
	a.cfg.NoFastest = !r.FastestFirst
	_ = a.cfg.Save()
}

// RouterStatus is the live health of each model a turn would try, in order.
func (a *App) RouterStatus() []llm.TargetStatus {
	a.waitReady()
	return llm.Status(a.cfg)
}

func (a *App) Usage() llm.UsageReport { return llm.Report() }
func (a *App) ResetUsage()            { llm.ResetUsage() }

// TestModel sends a one-line request to one provider/model and says how it went.
func (a *App) TestModel(provider, model string) Check {
	p, ok := config.ProviderByID(provider)
	if !ok {
		return Check{Name: provider, Detail: "Unknown provider."}
	}
	if model == "" {
		model = a.cfg.Model(provider)
		if provider == config.Blaze && (a.cfg.IsAuto() || a.cfg.Default.Provider != config.Blaze) {
			model = llm.BlazeDefault()
		}
	}
	key := llm.Credential(provider)
	if provider == config.Blaze && key == "" {
		return Check{Name: "Blaze", Detail: "Sign in to your Blaze account to use Blaze's models."}
	}
	ctx, cancel := context.WithTimeout(context.Background(), 40*time.Second)
	defer cancel()
	t0 := time.Now()
	_, err := llm.Chat(ctx, p, key, model, []llm.Message{{Role: "user", Content: "Reply with OK."}}, nil, nil)
	if err != nil {
		if provider == config.Blaze {
			if pe := llm.AsPlanError(err); pe != nil {
				return Check{Name: "Blaze", Detail: model + ": " + pe.Message}
			}
		}
		code := 0
		if he, ok := err.(*llm.HTTPError); ok {
			code = he.Code
		}
		return Check{Name: config.Name(provider), Detail: model + ": " + llm.PlainText(config.Name(provider), code, err.Error())}
	}
	d := fmt.Sprintf("%s answered in %.1fs", model, time.Since(t0).Seconds())
	if !llm.CanUseTools(provider, model) {
		d += " · can't use tools, chat only"
	}
	return Check{Name: config.Name(provider), OK: true, Detail: d}
}
