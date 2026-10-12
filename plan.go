package main

// Plans: Basic (free), Pro and Max, sold through PayPal by blaze-auth (cloud/). The plan
// decides which Blaze models a turn may use and how many tokens a day. Settings › Plan
// shows it with today's usage; Upgrade opens PayPal's checkout in the browser and then
// polls /v1/plan until the new plan is in force.
//
// Everyone signs in: a signed-out app shows only the sign-in screen (the onboarding's
// account step for a new user). Local models still answer without the Blaze service.

import (
	"context"
	"errors"
	"sync"
	"time"

	wr "github.com/wailsapp/wails/v2/pkg/runtime"

	"github.com/lacksonkapapahue/blaze-desktop/internal/cloud"
	"github.com/lacksonkapapahue/blaze-desktop/internal/llm"
)

type planCache struct {
	mu      sync.Mutex
	plan    *cloud.Plan
	at      time.Time
	err     string
	polling bool
}

// signInGate says what the app may show: "" (everything), "setup" (a new user: the
// onboarding flow, which can't get past its account step signed out) or "signin" (only
// the sign-in screen, for anyone else who is signed out, including after a session expires).
func signInGate(setupDone, signedIn bool) string {
	switch {
	case signedIn:
		return ""
	case !setupDone:
		return "setup"
	default:
		return "signin"
	}
}

func (a *App) signInView() string { return signInGate(a.cfg.SetupDone, a.signedIn()) }

func (a *App) sessionToken() string {
	if a.cloud == nil {
		return ""
	}
	t, _ := a.cloud.sec.Get(sessionKey)
	return t
}

// startPlans wires the Blaze provider to the account: the session token for each
// request, and the sign-in screen when the service says the session is gone.
func (a *App) startPlans() {
	llm.SetBlazeAuth(a.sessionToken, func() { a.checkSession() })
}

func (a *App) planNow() *cloud.Plan {
	a.plans.mu.Lock()
	defer a.plans.mu.Unlock()
	return a.plans.plan
}

// toModels turns the service's model list into the router's model info.
func toModels(ms []cloud.PlanModel) []llm.ModelInfo {
	out := make([]llm.ModelInfo, 0, len(ms))
	for _, m := range ms {
		mi := llm.ModelInfo{ID: m.ID, Name: m.Name, Vision: m.Vision, Context: m.Context, Known: true, Live: true,
			Tier: m.Tier, Locked: !m.Allowed, Alias: m.Alias, Desc: m.Desc, Note: titleTier(m.Tier), Tools: llm.Yes}
		if !m.Tools {
			mi.Tools = llm.No
		}
		out = append(out, mi)
	}
	return out
}

// refreshPlan reads /v1/plan (at most every 30 s unless forced) and hands the plan's
// models to the router. A 401 signs out.
func (a *App) refreshPlan(force bool) *cloud.Plan {
	tok := a.sessionToken()
	if tok == "" || a.cloud == nil {
		a.plans.mu.Lock()
		a.plans.plan, a.plans.err = nil, ""
		a.plans.mu.Unlock()
		llm.SetBlazePlan("", nil)
		return nil
	}
	a.plans.mu.Lock()
	if !force && a.plans.plan != nil && time.Since(a.plans.at) < 30*time.Second {
		p := a.plans.plan
		a.plans.mu.Unlock()
		return p
	}
	a.plans.mu.Unlock()
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	p, err := a.cloud.client.Plan(ctx, tok)
	var ae *cloud.APIError
	if errors.As(err, &ae) && ae.Status == 401 {
		go a.checkSession()
	}
	a.plans.mu.Lock()
	if err != nil {
		a.plans.err = cloud.Message(err)
		p = a.plans.plan // keep the last good one (offline)
		a.plans.mu.Unlock()
		return p
	}
	old := a.plans.plan
	a.plans.plan, a.plans.at, a.plans.err = p, time.Now(), ""
	a.plans.mu.Unlock()
	llm.SetBlazePlan(p.DefaultModel, toModels(p.Models))
	if old == nil || old.Plan.ID != p.Plan.ID {
		a.emitModel()
	}
	a.emitPlan()
	return p
}

func (a *App) emitPlan() {
	if a.ctx != nil {
		wr.EventsEmit(a.ctx, "plan", a.planView())
	}
}

// PlanView is Settings › Plan.
type PlanView struct {
	SignedIn bool        `json:"signed_in"`
	Plan     *cloud.Plan `json:"plan"`
	Error    string      `json:"error,omitempty"`
	Waiting  bool        `json:"waiting"` // checkout open in the browser; polling for the change
}

func (a *App) planView() PlanView {
	a.plans.mu.Lock()
	defer a.plans.mu.Unlock()
	return PlanView{SignedIn: a.sessionToken() != "", Plan: a.plans.plan, Error: a.plans.err, Waiting: a.plans.polling}
}

// PlanState is the plan, today's usage and billing state (fetched now).
func (a *App) PlanState() PlanView {
	a.waitReady()
	a.refreshPlan(true)
	return a.planView()
}

// PlanUpgrade starts PayPal's checkout for "pro" or "max" in the browser, then polls the
// plan until it changes (up to 15 minutes). Returns "" or what went wrong.
func (a *App) PlanUpgrade(tier string) string {
	tok := a.sessionToken()
	if tok == "" {
		return "Sign in to your Blaze account first."
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	co, err := a.cloud.client.Checkout(ctx, tok, tier)
	if err != nil {
		return cloud.Message(err)
	}
	if a.ctx != nil {
		wr.BrowserOpenURL(a.ctx, co.ApproveURL)
	}
	from := ""
	if p := a.planNow(); p != nil {
		from = p.Plan.ID
	}
	go a.pollPlan(tier, from, 15*time.Minute, 5*time.Second)
	return ""
}

// pollPlan asks for the plan until it is the tier the user paid for.
func (a *App) pollPlan(tier, from string, limit, every time.Duration) {
	a.plans.mu.Lock()
	if a.plans.polling {
		a.plans.mu.Unlock()
		return
	}
	a.plans.polling = true
	a.plans.mu.Unlock()
	a.emitPlan()
	defer func() {
		a.plans.mu.Lock()
		a.plans.polling = false
		a.plans.mu.Unlock()
		a.emitPlan()
	}()
	end := time.Now().Add(limit)
	for time.Now().Before(end) {
		time.Sleep(every)
		p := a.refreshPlan(true)
		if p != nil && p.Plan.ID == tier && p.Plan.ID != from {
			if a.ctx != nil {
				wr.EventsEmit(a.ctx, "toast", map[string]string{"text": "You're on Blaze " + p.Plan.Name + " now. Thank you!", "kind": "ok"})
			}
			return
		}
		if a.sessionToken() == "" {
			return
		}
	}
}

// PlanCancel cancels the subscription at PayPal. The plan lasts until the paid period ends.
func (a *App) PlanCancel() string {
	tok := a.sessionToken()
	if tok == "" {
		return "Sign in to your Blaze account first."
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err := a.cloud.client.CancelPlan(ctx, tok); err != nil {
		return cloud.Message(err)
	}
	a.refreshPlan(true)
	return ""
}
