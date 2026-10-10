package tools

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestMemoryFacts(t *testing.T) {
	d := t.TempDir()
	t.Setenv("BLAZE_HOME", d)
	_ = os.WriteFile(filepath.Join(d, "memory.md"), []byte("# Notes\n- Uses pnpm, not npm (2026-10-09)\n- Likes short answers\n\n- Likes short answers\n"), 0o600)
	fs := Facts()
	if len(fs) != 3 {
		t.Fatalf("want 3 facts, got %d", len(fs))
	}
	if fs[0].Text != "Uses pnpm, not npm" || fs[0].Date.Format("2006-01-02") != "2026-10-09" {
		t.Errorf("bad parse: %+v", fs[0])
	}
	if fs[1].ID == fs[2].ID {
		t.Error("repeated lines need distinct ids")
	}
	SetMemoryContext("p1", "c1")
	if r := Run(&Env{}, "remember", `{"fact":"Deploys HomeGlow with  pnpm deploy"}`); r != "Remembered." {
		t.Fatal(r)
	}
	ix := LoadMemIndex()
	m := ix.Items[MemID("Deploys HomeGlow with pnpm deploy", 0)]
	if m == nil || m.Project != "p1" || m.Chat != "c1" || m.Created.IsZero() {
		t.Fatalf("remember should record metadata, got %+v", m)
	}
	nid, err := EditFact(fs[0].ID, "Uses pnpm everywhere")
	if err != nil {
		t.Fatal(err)
	}
	b, _ := os.ReadFile(filepath.Join(d, "memory.md"))
	if !strings.Contains(string(b), "- Uses pnpm everywhere (2026-10-09)") || !strings.Contains(string(b), "# Notes") {
		t.Errorf("edit should keep the date and other lines:\n%s", b)
	}
	if err := ForgetFact(nid); err != nil {
		t.Fatal(err)
	}
	if len(Facts()) != 3 {
		t.Errorf("forget should remove exactly one fact, have %d", len(Facts()))
	}
	if ForgetFact("nope") == nil {
		t.Error("forgetting a missing id should fail")
	}
}
