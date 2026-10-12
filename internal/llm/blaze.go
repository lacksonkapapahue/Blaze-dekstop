package llm

// Blaze: the managed provider. Turns go to blaze-auth's OpenAI-compatible
// /v1/chat/completions with the Blaze account's session token; the Worker picks the
// upstream model for the plan. Its refusals are about the plan, not a model's health:
//
//	401 unauthorized       signed out (the app shows the sign-in screen)
//	402 plan_limit         today's tokens are used up (Upgrade)
//	403 model_not_in_plan  the chosen model needs a higher plan (Upgrade)
//	429 rate_limited       too many requests this minute (wait)
//
// Those come back as a *PlanError and never fall back to another model: a chosen cloud
// model is never quietly swapped for a local one.

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/lacksonkapapahue/blaze-desktop/internal/config"
)

var (
	blzmu          sync.RWMutex
	blazeToken   func() string
	onSignedOut  func()
	blazeModels  = map[string]ModelInfo{}
	blazeDefault string
)

// SetBlazeAuth tells the router where the session token comes from, and what to do when
// the service says the session is gone (the app signs out and shows the sign-in screen).
func SetBlazeAuth(token func() string, signedOut func()) {
	blzmu.Lock()
	blazeToken, onSignedOut = token, signedOut
	blzmu.Unlock()
}

// BlazeToken is the session token ("" when signed out).
func BlazeToken() string {
	blzmu.RLock()
	f := blazeToken
	blzmu.RUnlock()
	if f == nil {
		return ""
	}
	return f()
}

// SetBlazePlan keeps what /v1/models said: the plan's default model and every model with
// whether the plan allows it.
func SetBlazePlan(defaultModel string, models []ModelInfo) {
	m := map[string]ModelInfo{}
	for _, mi := range models {
		m[mi.ID] = mi
	}
	blzmu.Lock()
	blazeDefault, blazeModels = defaultModel, m
	blzmu.Unlock()
}

// BlazeDefault is the model Auto asks Blaze for: the plan's default, else Blaze Fast.
func BlazeDefault() string {
	blzmu.RLock()
	defer blzmu.RUnlock()
	if blazeDefault != "" {
		return blazeDefault
	}
	if p, ok := config.ProviderByID(config.Blaze); ok {
		return p.DefaultModel
	}
	return "blaze-fast"
}

// BlazeModel is what the plan said about one model (ok=false when not listed yet).
func BlazeModel(id string) (ModelInfo, bool) {
	blzmu.RLock()
	defer blzmu.RUnlock()
	mi, ok := blazeModels[id]
	return mi, ok
}

// BlazeModels is the plan's model list (aliases first), as last fetched.
func BlazeModels() []ModelInfo {
	blzmu.RLock()
	defer blzmu.RUnlock()
	out := make([]ModelInfo, 0, len(blazeModels))
	for _, mi := range blazeModels {
		out = append(out, mi)
	}
	return out
}

// PlanError is a refusal from the Blaze service about the account or plan.
type PlanError struct {
	Status     int    `json:"status"`
	Code       string `json:"code"` // signed_out | plan_limit | model_not_in_plan | rate_limited | model_not_found | busy
	Message    string `json:"message"`
	Plan       string `json:"plan,omitempty"`
	Required   string `json:"required,omitempty"` // the plan a locked model needs
	Upgrade    string `json:"upgrade,omitempty"`  // the next plan up, for plan_limit
	RetryAfter int    `json:"retry_after,omitempty"`
	ResetAt    int64  `json:"reset_at,omitempty"`
	Model      string `json:"model,omitempty"`
}

func (e *PlanError) Error() string { return e.Message }

// Upgradable is true when a higher plan would fix it (the chat shows an Upgrade button).
func (e *PlanError) Upgradable() bool {
	return e.Code == "plan_limit" || e.Code == "model_not_in_plan"
}

// ErrSignedOut is the plain error when a Blaze model is needed and nobody is signed in.
var ErrSignedOut = &PlanError{Status: 401, Code: "signed_out", Message: "Sign in to your Blaze account to use Blaze's models."}

func titleTier(t string) string {
	if t == "" {
		return ""
	}
	return strings.ToUpper(t[:1]) + t[1:]
}

// blazeError turns the Blaze service's plan refusals into a *PlanError. Anything else
// (an upstream outage, the network) is returned unchanged.
func blazeError(err error) error {
	var already *PlanError
	if errors.As(err, &already) {
		return err
	}
	var he *HTTPError
	if !errors.As(err, &he) {
		return err
	}
	var b struct {
		Error      string `json:"error"`
		Message    string `json:"message"`
		Plan       string `json:"plan"`
		Required   string `json:"required_tier"`
		Upgrade    string `json:"upgrade"`
		RetryAfter int    `json:"retry_after"`
		ResetAt    int64  `json:"reset_at"`
		Model      string `json:"model"`
	}
	_ = json.Unmarshal([]byte(he.Raw), &b)
	pe := &PlanError{Status: he.Code, Code: b.Error, Message: b.Message, Plan: b.Plan, Required: b.Required, Upgrade: b.Upgrade, RetryAfter: b.RetryAfter, ResetAt: b.ResetAt, Model: b.Model}
	if pe.RetryAfter == 0 {
		pe.RetryAfter = he.RetryAfter
	}
	switch {
	case he.Code == 401:
		pe.Code = "signed_out"
		pe.Message = "Your Blaze sign-in has expired. Sign in again to keep going."
		blzmu.RLock()
		f := onSignedOut
		blzmu.RUnlock()
		if f != nil {
			go f()
		}
	case he.Code == 402 || b.Error == "plan_limit":
		pe.Code = "plan_limit"
		if pe.Message == "" {
			pe.Message = "You've used today's tokens on your plan."
		}
		if pe.ResetAt > 0 {
			pe.Message += " It resets at " + time.Unix(pe.ResetAt, 0).Local().Format("15:04") + "."
		}
	case b.Error == "model_not_in_plan":
		if pe.Message == "" {
			pe.Message = fmt.Sprintf("That model needs the %s plan.", titleTier(pe.Required))
		}
	case he.Code == 429:
		pe.Code = "rate_limited"
		if pe.Message == "" {
			pe.Message = "Too many requests this minute on your plan."
		}
		if pe.RetryAfter > 0 {
			pe.Message += fmt.Sprintf(" Try again in %ds.", pe.RetryAfter)
		}
	case he.Code == 404 && b.Error == "model_not_found":
		if pe.Message == "" {
			pe.Message = "Blaze doesn't offer that model any more. Pick another in the model menu."
		}
	default:
		return err // 5xx, upstream_busy, a provider's 400: not a plan matter
	}
	return pe
}

// AsPlanError is the plan refusal inside an error from the Blaze provider, or nil.
func AsPlanError(err error) *PlanError {
	var pe *PlanError
	if errors.As(blazeError(err), &pe) {
		return pe
	}
	return nil
}
