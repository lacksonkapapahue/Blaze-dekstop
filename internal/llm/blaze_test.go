package llm

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/lacksonkapapahue/blaze-desktop/internal/config"
)

// blazeEnv points the Blaze provider at a fake Worker and Ollama at a fake local server.
func blazeEnv(t *testing.T, blaze, local http.HandlerFunc, token string) (*config.Config, *int32, *int32) {
	t.Helper()
	t.Setenv("BLAZE_HOME", t.TempDir())
	var bc, lc int32
	bs := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { atomic.AddInt32(&bc, 1); blaze(w, r) }))
	ls := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { atomic.AddInt32(&lc, 1); local(w, r) }))
	t.Cleanup(bs.Close)
	t.Cleanup(ls.Close)
	config.SetBlazeBase(bs.URL)
	t.Cleanup(func() { config.SetBlazeBase("") })
	saved := append([]config.Provider(nil), config.Providers...)
	t.Cleanup(func() { config.Providers = saved })
	for i := range config.Providers {
		if config.Providers[i].ID == "ollama" {
			config.Providers[i].BaseURL = ls.URL + "/v1/"
		}
	}
	SetBlazeAuth(func() string { return token }, nil)
	t.Cleanup(func() { SetBlazeAuth(nil, nil) })
	hmu.Lock()
	health = map[string]*Health{}
	hmu.Unlock()
	cfg := config.Load()
	return cfg, &bc, &lc
}

func say(text string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		w.Write([]byte(sse(`{"choices":[{"delta":{"content":"` + text + `"}}]}`, `{"choices":[],"usage":{"prompt_tokens":12,"completion_tokens":3,"total_tokens":15}}`)))
	}
}

func refuse(code int, body string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if code == 429 {
			w.Header().Set("Retry-After", "7")
		}
		w.WriteHeader(code)
		w.Write([]byte(body))
	}
}

var tool = func() []Tool {
	var tl Tool
	tl.Type = "function"
	tl.Function.Name = "file_list"
	tl.Function.Parameters = map[string]any{"type": "object", "properties": map[string]any{}}
	return []Tool{tl}
}()

var hi = []Message{{Role: "user", Content: "hi"}}

func TestBlazeProviderStreamsWithSessionToken(t *testing.T) {
	var got struct {
		path, auth, client string
		body               map[string]any
	}
	cfg, _, lc := blazeEnv(t, func(w http.ResponseWriter, r *http.Request) {
		got.path, got.auth, got.client = r.URL.Path, r.Header.Get("Authorization"), r.Header.Get("X-Blaze-Client")
		_ = json.NewDecoder(r.Body).Decode(&got.body)
		say("Hello from Blaze")(w, r)
	}, say("local"), "bz_session_token_0123456789")
	cfg.Chain = []config.Entry{{Provider: "ollama", Model: "qwen3:8b"}}
	var streamed strings.Builder
	r, err := CompleteWith(context.Background(), cfg, hi, tool, Opts{OnText: func(s string) { streamed.WriteString(s) }})
	if err != nil {
		t.Fatal(err)
	}
	if r.Text != "Hello from Blaze" || streamed.String() != "Hello from Blaze" || r.Provider != config.Blaze || r.Model != "blaze-fast" {
		t.Fatalf("reply %+v (streamed %q)", r, streamed.String())
	}
	if got.path != "/v1/chat/completions" || got.auth != "Bearer bz_session_token_0123456789" || got.client != "desktop" {
		t.Fatalf("request %+v", got)
	}
	if got.body["model"] != "blaze-fast" || got.body["stream"] != true || got.body["tools"] == nil {
		t.Fatalf("body %+v", got.body)
	}
	if r.Usage == nil || r.Usage.Prompt != 12 {
		t.Fatalf("usage not read: %+v", r.Usage)
	}
	if *lc != 0 {
		t.Fatal("the local model must not be asked when Blaze answered")
	}
}

func TestAutoUsesThePlansDefaultModel(t *testing.T) {
	var model string
	cfg, _, _ := blazeEnv(t, func(w http.ResponseWriter, r *http.Request) {
		var b map[string]any
		_ = json.NewDecoder(r.Body).Decode(&b)
		model, _ = b["model"].(string)
		say("ok")(w, r)
	}, say("local"), "bz_x_0123456789012345678901")
	SetBlazePlan("blaze-smart", []ModelInfo{{ID: "blaze-smart", Tools: Yes}})
	defer SetBlazePlan("", nil)
	if _, err := CompleteWith(context.Background(), cfg, hi, tool, Opts{}); err != nil {
		t.Fatal(err)
	}
	if model != "blaze-smart" {
		t.Fatalf("Auto asked for %q, want the plan's default", model)
	}
}

// A 402 plan_limit is shown with what to upgrade to, and never handed to Ollama.
func TestPlanLimitNeverFallsBack(t *testing.T) {
	cfg, bc, lc := blazeEnv(t, refuse(402, `{"error":"plan_limit","plan":"basic","limit":50000,"used":50000,"reset_at":1760313600,"upgrade":"pro","message":"You've used today's 50,000 tokens on Basic."}`), say("local"), "bz_x_0123456789012345678901")
	cfg.Chain = []config.Entry{{Provider: "ollama", Model: "qwen3:8b"}}
	_, err := CompleteWith(context.Background(), cfg, hi, tool, Opts{})
	var pe *PlanError
	if !errors.As(err, &pe) || pe.Code != "plan_limit" || pe.Upgrade != "pro" || !pe.Upgradable() {
		t.Fatalf("want a plan_limit PlanError, got %#v", err)
	}
	if !strings.Contains(Plain(err), "50,000 tokens") || !strings.Contains(Plain(err), "resets at") {
		t.Fatalf("message %q", Plain(err))
	}
	if *lc != 0 || *bc != 1 {
		t.Fatalf("blaze %d calls, local %d calls: a plan refusal must not fall back", *bc, *lc)
	}
}

func TestRateLimitAndLockedModelSurface(t *testing.T) {
	cfg, _, lc := blazeEnv(t, refuse(429, `{"error":"rate_limited","retry_after":7,"limit":6,"message":"Your Basic plan allows 6 requests a minute."}`), say("local"), "bz_x_0123456789012345678901")
	cfg.Chain = []config.Entry{{Provider: "ollama", Model: "qwen3:8b"}}
	_, err := CompleteWith(context.Background(), cfg, hi, tool, Opts{})
	var pe *PlanError
	if !errors.As(err, &pe) || pe.Code != "rate_limited" || pe.RetryAfter != 7 || pe.Upgradable() {
		t.Fatalf("want rate_limited, got %#v", err)
	}
	if *lc != 0 {
		t.Fatal("a 429 from the plan must not fall back to Ollama")
	}

	cfg2, _, _ := blazeEnv(t, refuse(403, `{"error":"model_not_in_plan","model":"blaze-max","plan":"basic","required_tier":"max","message":"Blaze Max needs the Max plan. You're on Basic."}`), say("local"), "bz_x_0123456789012345678901")
	cfg2.Default = &config.Entry{Provider: config.Blaze, Model: "blaze-max"}
	_, err = CompleteWith(context.Background(), cfg2, hi, tool, Opts{})
	if !errors.As(err, &pe) || pe.Code != "model_not_in_plan" || pe.Required != "max" || !pe.Upgradable() {
		t.Fatalf("want model_not_in_plan, got %#v", err)
	}
}

// The router.go fallback bug: a chosen cloud model that fails must show its error, not
// quietly continue on another model.
func TestChosenBlazeModelNeverFallsBack(t *testing.T) {
	cfg, bc, lc := blazeEnv(t, refuse(502, `{"error":"upstream_error","message":"Blaze's model providers didn't answer."}`), say("local"), "bz_x_0123456789012345678901")
	cfg.Default = &config.Entry{Provider: config.Blaze, Model: "blaze-smart"}
	cfg.Chain = []config.Entry{{Provider: "ollama", Model: "qwen3:8b"}}
	if ts := Targets(cfg, true); len(ts) != 1 || ts[0].Provider != config.Blaze || !ts[0].Fixed {
		t.Fatalf("a chosen model must be the only target: %+v", ts)
	}
	_, err := CompleteWith(context.Background(), cfg, hi, tool, Opts{})
	var re *RouteError
	if !errors.As(err, &re) || len(re.Failures) != 1 || re.Failures[0].Provider != config.Blaze {
		t.Fatalf("want Blaze's failure, got %v", err)
	}
	if *lc != 0 || *bc != 1 {
		t.Fatalf("blaze %d, local %d", *bc, *lc)
	}
	// A chosen local model doesn't need an account.
	cfg.Default = &config.Entry{Provider: "ollama", Model: "qwen3:8b"}
	SetBlazeAuth(func() string { return "" }, nil)
	r, err := CompleteWith(context.Background(), cfg, hi, tool, Opts{})
	if err != nil || r.Text != "local" {
		t.Fatalf("Ollama without an account: %v %+v", err, r)
	}
}

// In Auto, a local model the user added carries the turn when Blaze's providers are down,
// and the reply says so.
func TestAutoFallsBackToLocalOnlyOnOutage(t *testing.T) {
	cfg, _, lc := blazeEnv(t, refuse(503, `{"error":"upstream_busy","retry_after":20}`), say("local answer"), "bz_x_0123456789012345678901")
	cfg.Chain = []config.Entry{{Provider: "ollama", Model: "qwen3:8b"}}
	r, err := CompleteWith(context.Background(), cfg, hi, tool, Opts{})
	if err != nil || r.Text != "local answer" || *lc != 1 {
		t.Fatalf("%v %+v", err, r)
	}
	if !strings.Contains(r.Note, "Blaze couldn't answer") {
		t.Fatalf("the fallback must be visible: %q", r.Note)
	}
}

func TestSignedOut(t *testing.T) {
	var signedOut int32
	cfg, bc, _ := blazeEnv(t, refuse(401, `{"error":"unauthorized"}`), say("local"), "bz_expired_0123456789012345")
	SetBlazeAuth(func() string { return "bz_expired_0123456789012345" }, func() { atomic.AddInt32(&signedOut, 1) })
	_, err := CompleteWith(context.Background(), cfg, hi, tool, Opts{})
	var pe *PlanError
	if !errors.As(err, &pe) || pe.Code != "signed_out" {
		t.Fatalf("want signed_out, got %v", err)
	}
	for i := 0; i < 50 && atomic.LoadInt32(&signedOut) == 0; i++ {
		time.Sleep(10 * time.Millisecond)
	}
	if atomic.LoadInt32(&signedOut) != 1 {
		t.Fatal("an expired session must send the app back to the sign-in screen")
	}

	// No session at all: a Blaze model asks for sign-in without calling the service.
	SetBlazeAuth(func() string { return "" }, nil)
	*bc = 0
	if _, err := CompleteWith(context.Background(), cfg, hi, tool, Opts{}); !errors.Is(err, ErrSignedOut) {
		t.Fatalf("want ErrSignedOut, got %v", err)
	}
	if *bc != 0 {
		t.Fatal("no request without a session")
	}
	// Auto with a local model: it answers, and says why.
	cfg.Chain = []config.Entry{{Provider: "ollama", Model: "qwen3:8b"}}
	r, err := CompleteWith(context.Background(), cfg, hi, tool, Opts{})
	if err != nil || r.Text != "local" || !strings.Contains(r.Note, "signed out") {
		t.Fatalf("%v %+v", err, r)
	}
	if _, err := Quick(context.Background(), cfg, hi, 5*time.Second); err != nil {
		t.Fatalf("quick calls use the local model when signed out: %v", err)
	}
}

func TestBlazeErrorKeepsOtherErrors(t *testing.T) {
	he := &HTTPError{Code: 400, Body: "tool_calls must be followed by tool messages", Raw: `{"error":{"message":"tool_calls must be followed by tool messages"}}`}
	if err := blazeError(he); err != he {
		t.Fatalf("a provider's 400 must stay an HTTPError for the healing retry: %#v", err)
	}
	if err := blazeError(&HTTPError{Code: 503, Raw: `{"error":"upstream_busy"}`}); errors.As(err, new(*PlanError)) {
		t.Fatal("an outage is not a plan refusal")
	}
}
