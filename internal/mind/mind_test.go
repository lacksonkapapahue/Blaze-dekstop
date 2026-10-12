package mind

import (
	"path/filepath"
	"strings"
	"testing"
)

func open(t *testing.T) *DB {
	d, err := Open(filepath.Join(t.TempDir(), "mind.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { d.Close() })
	return d
}

func TestJournalIdempotentAndSearch(t *testing.T) {
	d := open(t)
	msgs := []Msg{{Turn: 0, Role: "user", Content: "My final exams start on 16 November"}, {Turn: 1, Role: "assistant", Content: "Noted."}, {Turn: 2, Role: "tool", Content: "ok"}}
	if n, _ := d.Journal("c1", msgs); n != 3 {
		t.Fatal(n)
	}
	if n, _ := d.Journal("c1", msgs); n != 0 {
		t.Fatal("second import must add nothing", n)
	}
	if d.Journaled("c1") != 2 || d.Journaled("nope") != -1 {
		t.Fatal("journaled")
	}
	hits := d.SearchJournal("when are my exams", "", 5)
	if len(hits) != 1 || hits[0].Conv != "c1" || !strings.Contains(hits[0].Content, "[exams]") {
		t.Fatalf("%+v", hits)
	}
	if d.CountUnreviewed() != 2 {
		t.Fatal("tool rows aren't reviewed")
	}
	u := d.Unreviewed(10000)
	if err := d.MarkReviewed([]int64{u[0].ID, u[1].ID}); err != nil || d.CountUnreviewed() != 0 {
		t.Fatal("mark reviewed")
	}
	if tr, ok := d.JournalTurn(u[0].ID); !ok || !tr.Reviewed {
		t.Fatal("turn reviewed")
	}
}

func TestSaveDedupeUpdateSearch(t *testing.T) {
	d := open(t)
	s1, _ := d.Save(Memory{Kind: "preference", Subject: "food", Text: "Luke likes nshima with beans for lunch on weekdays"})
	s2, _ := d.Save(Memory{Kind: "preference", Subject: "Food", Text: "Luke likes nshima with beans for lunch on weekdays"})
	if s1.Action != "added" || s2.Action != "same" || s2.ID != s1.ID {
		t.Fatal(s1, s2)
	}
	s3, _ := d.Save(Memory{Kind: "pref", Subject: "food", Text: "Luke likes nshima with chicken for lunch on weekdays"})
	if s3.Action != "updated" || s3.ID != s1.ID || d.Count() != 1 {
		t.Fatalf("newest wins without a duplicate: %+v count %d", s3, d.Count())
	}
	m, _ := d.Get(s1.ID)
	if !strings.Contains(m.Text, "chicken") || !strings.Contains(m.Text, "on weekdays") {
		t.Fatal("conditions kept, newest text:", m.Text)
	}
	d.Save(Memory{Kind: "person", Subject: "Gloria Gozza", Text: "Luke's mother; handles his tuition payment plan"})
	d.Save(Memory{Kind: "profile", Subject: "Luke", Text: "Student at Northrise University, Ndola"})
	if r := d.Search("who pays tuition", "", 5); len(r) == 0 || r[0].Subject != "Gloria Gozza" {
		t.Fatalf("FTS recall: %+v", r)
	}
	if r := d.Search("gloria", "person", 5); len(r) != 1 {
		t.Fatal("subject search")
	}
	if err := d.Update(s1.ID, "Luke likes nshima with fish for lunch on weekdays", "", ""); err != nil {
		t.Fatal(err)
	}
	if r := d.Search("fish", "", 5); len(r) != 1 || d.Search("chicken", "", 5) != nil {
		t.Fatal("update rewrites the line in the index too")
	}
	core := d.Core(2000)
	if len(core) != 2 || core[0].Kind != "profile" {
		t.Fatalf("core: %+v", core)
	}
	idx := d.Index(10)
	if len(idx["person"]) != 1 || !strings.HasPrefix(idx["person"][0], "Gloria Gozza") {
		t.Fatal(idx)
	}
	b := Block(core, idx)
	if !strings.Contains(b, "MEMORY INDEX") || !strings.Contains(b, "person: Gloria Gozza (1)") || strings.Contains(b, "tuition") {
		t.Fatal("block carries the index, not every memory:\n" + b)
	}
}

func TestLadder(t *testing.T) {
	// 32k window: budget 60% = 19.6k (or the free budget), hard = 90%.
	if l := Ladder(5000, 0, 0, 12000, 32768, false); l != Recent {
		t.Fatal(l)
	}
	if l := Ladder(12001, 800, 4000, 12000, 32768, false); l != Summary {
		t.Fatal(l)
	}
	if l := Ladder(90000, 2000, 28000, 12000, 32768, false); l != Lookup {
		t.Fatal("summary + tail past 90% of the window:", l)
	}
	if l := Ladder(13000, 0, 0, 12000, 32768, true); l != Lookup {
		t.Fatal("failed compression:", l)
	}
	if l := Ladder(13000, 9000, 9500, 12000, 0, false); l != Lookup {
		t.Fatal("unknown window: hard = 1.5 × budget", l)
	}
}

func TestParseExtract(t *testing.T) {
	ms := ParseExtract("Sure:\n```json\n[{\"kind\":\"people\",\"subject\":\"Mutale\",\"text\":\"In Luke's NET103 group\"},{\"kind\":\"x\",\"text\":\"\"}]\n```")
	if len(ms) != 1 || ms[0].Kind != "person" {
		t.Fatalf("%+v", ms)
	}
	if ParseExtract("nothing") != nil {
		t.Fatal("no array")
	}
}
