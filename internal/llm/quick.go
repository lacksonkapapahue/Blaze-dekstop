package llm

// Quick: tiny background calls (chat titles) on the cheapest healthy model.
// They never stream, never use tools, try at most two models, and stay out of the
// router's speed stats so a 6-word answer doesn't make a model look fast for real turns.

import (
	"context"
	"errors"
	"time"

	"github.com/lacksonkapapahue/blaze-desktop/internal/config"
)

// QuickTargets is who a tiny call tries: the router's order with resting and cooling
// models skipped. The plan's model is swapped for Blaze Fast (on every plan, and cheap
// on the daily tokens).
func QuickTargets(cfg *config.Config) []Target {
	all := Targets(cfg, false)
	now := time.Now()
	var out []Target
	hmu.Lock()
	for _, t := range all {
		if x := health[t.key()]; x != nil && x.CoolUntil.After(now) {
			continue
		}
		if t.Provider == config.Blaze && !t.Fixed {
			t.Model = "blaze-fast"
		}
		out = append(out, t)
	}
	hmu.Unlock()
	return out
}

// Quick asks for a short plain-text answer. It gives up after timeout.
func Quick(ctx context.Context, cfg *config.Config, msgs []Message, timeout time.Duration) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	list := QuickTargets(cfg)
	tokens := Estimate(chars(msgs, nil))
	tried := 0
	var last error
	for _, t := range list {
		if tried >= 2 {
			break
		}
		if w, _ := Wait(t.key(), tokens); w > 0 {
			continue
		}
		p, _ := config.ProviderByID(t.Provider)
		key := Credential(t.Provider)
		if t.Provider == config.Blaze && key == "" {
			last = ErrSignedOut
			continue
		}
		tried++
		Spend(t.key(), tokens)
		r, err := Chat(ctx, p, key, t.Model, msgs, nil, nil)
		if err == nil && r != nil {
			RecordUsage(t.Provider, t.Model, chars(msgs, nil), r)
			return r.Text, nil
		}
		if r != nil {
			Headers(t.key(), r.Headers)
		}
		if t.Provider == config.Blaze {
			var pe *PlanError
			if errors.As(blazeError(err), &pe) {
				return "", pe // a plan refusal: background calls stop here too
			}
		} else if IsQuota(err) {
			var he *HTTPError
			ra := 0
			if errors.As(err, &he) {
				ra = he.RetryAfter
			}
			Limited(t.key(), err.Error(), ra)
		}
		last = err
		if ctx.Err() != nil {
			return "", ctx.Err()
		}
	}
	if last == nil {
		last = errors.New("no model free for a quick call")
	}
	return "", last
}
