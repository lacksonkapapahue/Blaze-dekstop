package main

import "testing"

func TestOpenView(t *testing.T) {
	var got []string
	emit := func(v string) { got = append(got, v) }
	no := func(string, string) bool { return false }
	yes := func(string, string) bool { return true }
	if r := openView("Design", "", false, no, emit); len(got) != 1 || got[0] != "design" || r == "" {
		t.Fatalf("design should open without asking: %v %q", got, r)
	}
	if r := openView("memory", "to show what I saved", true, no, emit); len(got) != 1 || r != "The user stayed in the chat." {
		t.Fatalf("a refused ask must not switch: %v %q", got, r)
	}
	openView("memory", "", true, yes, emit)
	openView("chat", "", true, no, emit) // going back never asks
	if len(got) != 3 || got[1] != "memory" || got[2] != "chat" {
		t.Fatalf("got %v", got)
	}
	if r := openView("nope", "", false, yes, emit); len(got) != 3 || r[:6] != "Error:" {
		t.Fatalf("unknown view: %q", r)
	}
	if r := openView("design", "", false, yes, nil); r[:6] != "Error:" {
		t.Fatalf("no window: %q", r)
	}
}
