package main

import (
	"testing"
	"time"
)

func TestParseSuggestion(t *testing.T) {
	no := []string{
		"NONE", "none.", "", "Sure! Here's a tip", `{"title":"Hi there","body":"How can I help you today?","ask":"help"}`,
		`{"title":"","body":"x","ask":"y"}`, `{"title":"Error in build","body":"","ask":"fix"}`, `{bad json`,
	}
	for _, s := range no {
		if _, ok := parseSuggestion(s); ok {
			t.Errorf("should be no: %q", s)
		}
	}
	s, ok := parseSuggestion("Here:\n```json\n{\"title\":\"pnpm test fails\",\"body\":\"price.test.ts expects 19.99; I can fix the rounding.\",\"ask\":\"Fix the failing price test\"}\n```")
	if !ok || s.Title != "pnpm test fails" || s.Ask == "" {
		t.Fatalf("a real suggestion: %+v %v", s, ok)
	}
}

func TestNotifyPrefsPolicy(t *testing.T) {
	var p NotifyPrefs
	pol := p.policy()
	if pol.Every != 10*time.Minute || pol.MaxHour != 3 || pol.QuietFrom != "22:00" || pol.QuietTo != "08:00" {
		t.Fatalf("defaults: %+v", pol)
	}
	p = NotifyPrefs{Every: 1, MaxHour: 1, NoQuiet: true}
	pol = p.policy()
	if pol.Every != 5*time.Minute || pol.MaxHour != 1 || pol.QuietFrom != "" {
		t.Fatalf("floor and no quiet hours: %+v", pol)
	}
	night := time.Date(2026, 10, 10, 23, 0, 0, 0, time.Local)
	if v := (NotifyPrefs{}).policy().Check(night, time.Time{}, nil, 0); v.Run {
		t.Fatal("default quiet hours block 23:00")
	}
}
