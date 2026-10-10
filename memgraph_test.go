package main

import "testing"

func TestInferEdges(t *testing.T) {
	texts := []string{"Uses pnpm for the HomeGlow theme", "HomeGlow store sells lamps", "Prefers dark mode", "Runs pnpm build before deploys", "Prefers concise replies in dark mode"}
	var nodes []MemNode
	var toks [][]string
	for _, s := range texts {
		nodes = append(nodes, MemNode{Kind: "memory", Text: s})
		toks = append(toks, linkTokens(s))
	}
	es := inferEdges(nodes, toks, len(nodes))
	has := func(a, b int) bool {
		for _, e := range es {
			if (e.A == a && e.B == b) || (e.A == b && e.B == a) {
				return true
			}
		}
		return false
	}
	if !has(0, 1) || !has(0, 3) || !has(2, 4) {
		t.Errorf("missing expected links: %+v", es)
	}
	if has(1, 2) {
		t.Errorf("unrelated memories linked: %+v", es)
	}
	if c := localCategory(linkTokens("Prefers dark mode and short answers")); c != "Preferences" {
		t.Errorf("category = %s", c)
	}
	if l := shortLabel("User prefers British spelling in every reply, even code comments"); len(l) > 40 {
		t.Errorf("label too long: %s", l)
	}
}
