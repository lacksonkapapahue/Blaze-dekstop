package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/lacksonkapapahue/blaze-desktop/internal/cloud"
	"github.com/lacksonkapapahue/blaze-desktop/internal/config"
	"github.com/lacksonkapapahue/blaze-desktop/internal/connect"
	"github.com/lacksonkapapahue/blaze-desktop/internal/llm"
)

func TestSignInGate(t *testing.T) {
	for _, c := range []struct {
		setup, in bool
		want      string
	}{{false, false, "setup"}, {true, false, "signin"}, {false, true, ""}, {true, true, ""}} {
		if got := signInGate(c.setup, c.in); got != c.want {
			t.Errorf("signInGate(setupDone=%v, signedIn=%v) = %q, want %q", c.setup, c.in, got, c.want)
		}
	}
	// An existing user who is signed out on upgrade sees only the sign-in screen.
	a := testApp(t)
	a.cfg.SetupDone = true
	if g := a.signInView(); g != "signin" {
		t.Fatalf("gate %q", g)
	}
}

// fakeService is a blaze-auth stand-in for /v1/me, /v1/plan and /v1/billing/*.
func fakeService(t *testing.T, plan *atomic.Value, meStatus *int32) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer bz_test_session_0123456789abcdef" || atomic.LoadInt32(meStatus) == 401 {
			w.WriteHeader(401)
			w.Write([]byte(`{"error":"unauthorized"}`))
			return
		}
		switch r.URL.Path {
		case "/v1/me":
			w.Write([]byte(`{"user":{"id":"u_1","email":"joey@example.com","plan":"basic"}}`))
		case "/v1/plan":
			id := plan.Load().(string)
			allowedMax := id == "max"
			json.NewEncoder(w).Encode(map[string]any{
				"plan":  map[string]any{"id": id, "name": strings.ToUpper(id[:1]) + id[1:], "price_usd": 0},
				"usage": map[string]any{"tokens": 1200, "requests": 3, "limit": 50000, "remaining": 48800, "reset_at": 1760313600},
				"default_model": "blaze-" + map[string]string{"basic": "fast", "pro": "smart", "max": "max"}[id],
				"billing":       map[string]any{"enabled": true, "status": ""},
				"models": []map[string]any{
					{"id": "blaze-fast", "name": "Blaze Fast", "tier": "basic", "alias": true, "tools": true, "allowed": true},
					{"id": "blaze-max", "name": "Blaze Max", "tier": "max", "alias": true, "tools": true, "vision": true, "allowed": allowedMax},
				},
			})
		case "/v1/billing/checkout":
			w.Write([]byte(`{"approve_url":"https://www.sandbox.paypal.com/approve?ba_token=1","subscription_id":"I-1","tier":"max","kind":"new"}`))
		default:
			w.WriteHeader(404)
		}
	}))
	t.Cleanup(srv.Close)
	return srv
}

func signedInApp(t *testing.T, base string) *App {
	t.Helper()
	a := testApp(t)
	sec := &connect.MemSecrets{}
	_ = sec.Set(sessionKey, "bz_test_session_0123456789abcdef")
	a.cloud = &cloudState{client: cloud.New(base), sec: sec, user: &cloud.User{ID: "u_1", Email: "joey@example.com"}}
	config.SetBlazeBase(base)
	t.Cleanup(func() { config.SetBlazeBase(""); llm.SetBlazePlan("", nil); llm.SetBlazeAuth(nil, nil) })
	a.startPlans()
	return a
}

func TestPlanFeedsTheModelPicker(t *testing.T) {
	var plan atomic.Value
	plan.Store("basic")
	var me int32
	a := signedInApp(t, fakeService(t, &plan, &me).URL)
	v := a.PlanState()
	if v.Plan == nil || v.Plan.Plan.ID != "basic" || v.Plan.Usage.Remaining != 48800 {
		t.Fatalf("plan view %+v", v)
	}
	l := a.ModelOptions(config.Blaze, false)
	if len(l.Models) != 2 || l.Models[0].ID != "blaze-fast" || l.Models[0].Locked || !l.Models[1].Locked || l.Models[1].Tier != "max" {
		t.Fatalf("picker models %+v", l.Models)
	}
	if got := a.modelName(); got != "Auto · Blaze · blaze-fast" {
		t.Fatalf("chip %q", got)
	}
	// After an upgrade lands, the plan's default and the unlocked models follow.
	plan.Store("max")
	go a.pollPlan("max", "basic", 5*time.Second, 20*time.Millisecond)
	for i := 0; i < 200 && llm.BlazeDefault() != "blaze-max"; i++ {
		time.Sleep(10 * time.Millisecond)
	}
	if llm.BlazeDefault() != "blaze-max" {
		t.Fatal("polling didn't pick up the new plan")
	}
	if mi, _ := llm.BlazeModel("blaze-max"); mi.Locked {
		t.Fatal("Blaze Max should be unlocked on Max")
	}
}

// A session refused by the service (expired, revoked) goes back to the sign-in screen.
func TestExpiredSessionReturnsToTheGate(t *testing.T) {
	var plan atomic.Value
	plan.Store("basic")
	var me int32
	a := signedInApp(t, fakeService(t, &plan, &me).URL)
	a.cfg.SetupDone = true
	if a.signInView() != "" {
		t.Fatal("signed in: no gate")
	}
	atomic.StoreInt32(&me, 401)
	a.checkSession()
	if a.signInView() != "signin" || a.sessionToken() != "" {
		t.Fatalf("gate %q token %q", a.signInView(), a.sessionToken())
	}
	if a.refreshPlan(true) != nil || len(llm.BlazeModels()) != 0 {
		t.Fatal("signing out clears the plan")
	}
}
