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
	fs := Facts() // opening the database imports memory.md
	if len(fs) != 2 {
		t.Fatalf("want 2 facts (duplicates merge), got %d: %+v", len(fs), fs)
	}
	if fs[0].Text != "Uses pnpm, not npm" || fs[0].Date.Format("2006-01-02") != "2026-10-09" {
		t.Errorf("bad parse: %+v", fs[0])
	}
	if _, err := os.Stat(filepath.Join(d, "memory.md.migrated")); err != nil {
		t.Error("memory.md should be kept as a backup")
	}
	SetMemoryContext("p1", "c1")
	if r := Run(&Env{}, "remember", `{"fact":"Deploys HomeGlow with  pnpm deploy"}`); !strings.HasPrefix(r, "Remembered") {
		t.Fatal(r)
	}
	if r := Run(&Env{}, "remember", `{"fact":"deploys homeglow with pnpm deploy."}`); !strings.HasPrefix(r, "Already remembered") {
		t.Fatal(r)
	}
	fs = Facts()
	last := fs[len(fs)-1]
	if last.Project != "p1" || last.Chat != "c1" || last.Date.IsZero() {
		t.Fatalf("remember should record metadata, got %+v", last)
	}
	if r := Run(&Env{}, "recall", `{"query":"how does homeglow get deployed"}`); !strings.Contains(r, "Deploys HomeGlow") {
		t.Errorf("recall: %s", r)
	}
	nid, err := EditFact(fs[0].ID, "Uses pnpm everywhere")
	if err != nil || nid != fs[0].ID {
		t.Fatal(nid, err)
	}
	if Facts()[0].Text != "Uses pnpm everywhere" || !Facts()[0].Date.Equal(fs[0].Date) {
		t.Error("edit should keep the id and date")
	}
	if err := PinFact(nid, true); err != nil || !Facts()[0].Pinned {
		t.Error("pin")
	}
	if !strings.Contains(MemoryFor("anything"), "Uses pnpm everywhere [#") {
		t.Error("a pinned memory goes into every prompt")
	}
	if err := ForgetFact(nid); err != nil {
		t.Fatal(err)
	}
	if len(Facts()) != 2 {
		t.Errorf("forget should remove exactly one fact, have %d", len(Facts()))
	}
	if ForgetFact("nope") == nil || ForgetFact(nid) == nil {
		t.Error("forgetting a missing id should fail")
	}
	if r := Run(&Env{}, "forget", `{"text":"short answers"}`); r != "Forgot 1 fact(s)." {
		t.Error(r)
	}
	SetMemoryText("- One (2026-01-01)\n# heading\n- Two\n")
	if Memory() != "- Deploys HomeGlow with pnpm deploy\n- One\n- Two" && Memory() != "- One\n- Two" {
		t.Errorf("SetMemoryText: %q", Memory())
	}
}

func TestSkillsIndexFollowsFolder(t *testing.T) {
	d := t.TempDir()
	t.Setenv("BLAZE_HOME", d)
	for i, n := range []string{"deploy-site", "pg-docker", "ad-report", "a1", "a2", "a3", "a4", "a5", "a6", "a7"} {
		_ = os.MkdirAll(filepath.Join(d, "skills", n), 0o755)
		desc := "Generic helper number " + string(rune('a'+i))
		switch n {
		case "deploy-site":
			desc = "Build and push the HomeGlow theme with shopify theme push"
		case "pg-docker":
			desc = "Start Postgres in Docker for local apps"
		}
		_ = os.WriteFile(filepath.Join(d, "skills", n, "SKILL.md"), []byte("---\nname: "+n+"\ndescription: "+desc+"\n---\n\nSteps.\n"), 0o644)
	}
	if len(Skills()) != 10 {
		t.Fatalf("skills: %d", len(Skills()))
	}
	block := SkillsFor("please deploy the homeglow theme")
	if !strings.Contains(block, "deploy-site") || strings.Contains(block, "pg-docker") {
		t.Errorf("only matching skills when there are many:\n%s", block)
	}
	if r := Run(&Env{}, "load_skill", `{"name":"pg-docker"}`); !strings.Contains(r, "Start Postgres") {
		t.Error(r)
	}
	if r := Run(&Env{}, "use_skill", `{"name":"pg-docker"}`); !strings.Contains(r, "Start Postgres") {
		t.Error("use_skill stays as an alias")
	}
	// A new SKILL.md is picked up (mtime/count change).
	Run(&Env{}, "write_skill", `{"name":"backup-db","description":"Back up the Postgres database nightly","body":"pg_dump"}`)
	if !strings.Contains(SkillsFor("backup the database"), "backup-db") {
		t.Error("a written skill should be indexed")
	}
}
