package tools

// Memory metadata (v0.5 Memory screen). memory.md stays the source of truth: the
// system prompt reads it and people edit it by hand. This sidecar
// (~/.blaze/memory.meta.json) adds what the graph needs, keyed by a hash of each
// fact's text: when it was saved, in which project and chat, and the category a
// model gave it (cached, so the model is never asked twice about the same fact).
// Old memory.md files work as they are; missing metadata is backfilled from the
// "(YYYY-MM-DD)" suffix the remember tool always wrote.

import (
	"crypto/sha1"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/lacksonkapapahue/blaze-desktop/internal/config"
)

type MemMeta struct {
	Created  time.Time `json:"created"`
	Project  string    `json:"project,omitempty"`
	Chat     string    `json:"chat,omitempty"`
	Category string    `json:"category,omitempty"` // from the model; "" = use the local guess
}

type MemIndex struct {
	Version  int                 `json:"version"`
	Items    map[string]*MemMeta `json:"items"`
	SortedAt time.Time           `json:"sorted_at"` // last model categorisation attempt
}

// A Fact is one line of memory.md.
type Fact struct {
	ID   string
	Text string
	Date time.Time // from the "(YYYY-MM-DD)" suffix, zero if none
	Line int
}

var (
	memMu  sync.Mutex
	memCtx struct {
		sync.Mutex
		project, chat string
	}
	dateSuffix = regexp.MustCompile(`\s*\((\d{4}-\d{2}-\d{2})\)\s*$`)
)

// SetMemoryContext tells remember which project and chat the current turn belongs to.
func SetMemoryContext(project, chat string) {
	memCtx.Lock()
	memCtx.project, memCtx.chat = project, chat
	memCtx.Unlock()
}

func memMetaFile() string { return filepath.Join(config.Dir(), "memory.meta.json") }

func LoadMemIndex() MemIndex {
	memMu.Lock()
	defer memMu.Unlock()
	return loadIx()
}

func loadIx() MemIndex {
	var ix MemIndex
	b, _ := os.ReadFile(memMetaFile())
	_ = json.Unmarshal(b, &ix)
	if ix.Items == nil {
		ix.Items = map[string]*MemMeta{}
	}
	ix.Version = 1
	return ix
}

func SaveMemIndex(ix MemIndex) {
	memMu.Lock()
	defer memMu.Unlock()
	saveIx(ix)
}

func saveIx(ix MemIndex) {
	_ = os.MkdirAll(config.Dir(), 0o700)
	b, _ := json.Marshal(ix)
	tmp := memMetaFile() + ".tmp"
	if os.WriteFile(tmp, b, 0o600) == nil {
		_ = os.Rename(tmp, memMetaFile())
	}
}

// UpdateMemIndex loads, changes and saves the index under one lock.
func UpdateMemIndex(fn func(ix *MemIndex)) {
	memMu.Lock()
	defer memMu.Unlock()
	ix := loadIx()
	fn(&ix)
	saveIx(ix)
}

func normFact(s string) string { return strings.Join(strings.Fields(strings.ToLower(s)), " ") }

// MemID is a short stable id for a fact's text (n>0 for repeated identical lines).
func MemID(text string, n int) string {
	h := sha1.Sum([]byte(normFact(text)))
	id := hex.EncodeToString(h[:6])
	if n > 0 {
		id += "-" + string(rune('a'+n%26))
	}
	return id
}

// parseFact turns "- Uses pnpm (2026-10-09)" into its text and date.
func parseFact(l string) (string, time.Time, bool) {
	t := strings.TrimSpace(l)
	if t == "" || strings.HasPrefix(t, "#") || strings.HasPrefix(t, "```") {
		return "", time.Time{}, false
	}
	for _, p := range []string{"- [ ] ", "- [x] ", "- ", "* ", "• "} {
		if strings.HasPrefix(t, p) {
			t = strings.TrimSpace(t[len(p):])
			break
		}
	}
	var d time.Time
	if m := dateSuffix.FindStringSubmatch(t); m != nil {
		d, _ = time.ParseInLocation("2006-01-02", m[1], time.Local)
		t = strings.TrimSpace(t[:len(t)-len(m[0])])
	}
	return t, d, t != ""
}

// Facts reads memory.md line by line.
func Facts() []Fact {
	b, _ := os.ReadFile(memFile())
	seen := map[string]int{}
	var out []Fact
	for i, l := range strings.Split(string(b), "\n") {
		txt, d, ok := parseFact(l)
		if !ok {
			continue
		}
		k := normFact(txt)
		out = append(out, Fact{ID: MemID(txt, seen[k]), Text: txt, Date: d, Line: i})
		seen[k]++
	}
	return out
}

// noteFact records metadata for a fact the remember tool just saved.
func noteFact(text string) {
	memCtx.Lock()
	p, c := memCtx.project, memCtx.chat
	memCtx.Unlock()
	UpdateMemIndex(func(ix *MemIndex) {
		id := MemID(text, 0)
		if old, ok := ix.Items[id]; ok && !old.Created.IsZero() {
			return
		}
		ix.Items[id] = &MemMeta{Created: time.Now(), Project: p, Chat: c}
	})
}

func rewriteFact(id string, fn func(f Fact) (string, bool)) error {
	memMu.Lock()
	defer memMu.Unlock()
	b, err := os.ReadFile(memFile())
	if err != nil {
		return errors.New("Blaze has no saved memory yet.")
	}
	lines := strings.Split(string(b), "\n")
	seen := map[string]int{}
	for i, l := range lines {
		txt, d, ok := parseFact(l)
		if !ok {
			continue
		}
		k := normFact(txt)
		fid := MemID(txt, seen[k])
		seen[k]++
		if fid != id {
			continue
		}
		repl, keep := fn(Fact{ID: fid, Text: txt, Date: d, Line: i})
		if keep {
			lines[i] = repl
		} else {
			lines = append(lines[:i], lines[i+1:]...)
		}
		out := strings.TrimRight(strings.Join(lines, "\n"), "\n") + "\n"
		if strings.TrimSpace(out) == "" {
			out = ""
		}
		return os.WriteFile(memFile(), []byte(out), 0o600)
	}
	return errors.New("That memory changed or was removed. Reopen the graph.")
}

// EditFact replaces one fact's text, keeping its date and metadata. Returns the new id.
func EditFact(id, text string) (string, error) {
	text = strings.Join(strings.Fields(text), " ")
	if text == "" {
		return "", errors.New("A memory can't be empty. Use Forget to remove it.")
	}
	var date time.Time
	err := rewriteFact(id, func(f Fact) (string, bool) {
		date = f.Date
		if date.IsZero() {
			date = time.Now()
		}
		return "- " + text + " (" + date.Format("2006-01-02") + ")", true
	})
	if err != nil {
		return "", err
	}
	nid := MemID(text, 0)
	UpdateMemIndex(func(ix *MemIndex) {
		m := ix.Items[id]
		if m == nil {
			m = &MemMeta{Created: date}
		}
		delete(ix.Items, id)
		ix.Items[nid] = m
	})
	return nid, nil
}

// ForgetFact removes one fact by id.
func ForgetFact(id string) error {
	if err := rewriteFact(id, func(Fact) (string, bool) { return "", false }); err != nil {
		return err
	}
	UpdateMemIndex(func(ix *MemIndex) { delete(ix.Items, id) })
	return nil
}
