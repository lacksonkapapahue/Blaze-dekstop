package screen

import (
	"image"
	"image/color"
	"strings"
	"testing"
	"time"
)

func pic(w, h int, f func(x, y int) uint8) *image.RGBA {
	m := image.NewRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			v := f(x, y)
			m.Set(x, y, color.RGBA{v, v, v, 255})
		}
	}
	return m
}

func TestDHashNear(t *testing.T) {
	a := pic(320, 200, func(x, y int) uint8 { return uint8(x * 255 / 320) })
	b := pic(320, 200, func(x, y int) uint8 { // same picture, a few pixels changed (a cursor blink)
		if x == 10 && y < 4 {
			return 0
		}
		return uint8(x * 255 / 320)
	})
	c := pic(320, 200, func(x, y int) uint8 { return uint8(255 - x*255/320) })
	ha, hb, hc := DHash(a), DHash(b), DHash(c)
	if !Near(ha, hb) {
		t.Errorf("tiny change should keep the hash near: %016x %016x", ha, hb)
	}
	if Near(ha, hc) {
		t.Errorf("a different picture should not be near: %016x %016x", ha, hc)
	}
	if DHash(Fit(a, 64)) != ha && !Near(DHash(Fit(a, 64)), ha) {
		t.Error("downscaling must not change the hash much")
	}
}

func TestFresh(t *testing.T) {
	now := time.Now()
	w := Win{ID: 7, PID: 42, Title: "Invoice — Firefox"}
	snap := &Snapshot{Win: w, At: now.Add(-1 * time.Second), Thumb: 0xF0F0, key: w.Key()}

	if !Fresh(snap, w, 0, false, 2*time.Second, now) {
		t.Error("same window inside the ttl is a cache hit")
	}
	if Fresh(snap, w, 0, false, 500*time.Millisecond, now) {
		t.Error("older than the ttl is a miss")
	}
	if Fresh(snap, w, 0, false, 0, now) {
		t.Error("ttl 0 (fresh) always reads")
	}
	other := w
	other.Title = "Inbox — Firefox"
	if Fresh(snap, other, 0, false, time.Minute, now) {
		t.Error("another window (title changed) is a miss")
	}
	other = w
	other.ID = 8
	if Fresh(snap, other, 0, false, time.Minute, now) {
		t.Error("another window id is a miss")
	}
	// with a thumbnail: the picture hash decides, for up to ThumbMaxAge
	old := &Snapshot{Win: w, At: now.Add(-20 * time.Second), Thumb: 0xF0F0, key: w.Key()}
	if !Fresh(old, w, 0xF0F1, true, 2*time.Second, now) {
		t.Error("same window, same picture (1 bit off) within 30s is a hit")
	}
	if Fresh(old, w, 0x0F0F, true, 2*time.Second, now) {
		t.Error("same window, changed picture is a miss")
	}
	older := &Snapshot{Win: w, At: now.Add(-ThumbMaxAge - time.Second), Thumb: 0xF0F0, key: w.Key()}
	if Fresh(older, w, 0xF0F0, true, 2*time.Second, now) {
		t.Error("past ThumbMaxAge it reads again even if the picture matches")
	}
	failed := &Snapshot{Win: w, At: now, Err: "timeout", key: w.Key()}
	if Fresh(failed, w, 0, false, time.Minute, now) {
		t.Error("a failed read is never cached")
	}
	if Fresh(nil, w, 0, false, time.Minute, now) {
		t.Error("no snapshot is a miss")
	}
}

func TestAnswers(t *testing.T) {
	var c Answers
	now := time.Now()
	c.Put("win|q", 0xAAAA, "a red error banner", now)
	if a, age, ok := c.Get("win|q", 0xAAAB, now.Add(10*time.Second)); !ok || a != "a red error banner" || age != 10*time.Second {
		t.Fatalf("same key + near picture is a hit: %v %v %v", a, age, ok)
	}
	if _, _, ok := c.Get("win|q", 0x5555, now); ok {
		t.Error("different picture is a miss")
	}
	if _, _, ok := c.Get("win|other question", 0xAAAA, now); ok {
		t.Error("different question is a miss")
	}
	if _, _, ok := c.Get("win|q", 0xAAAA, now.Add(AnswersMaxAge)); ok {
		t.Error("expired answer is a miss")
	}
	c.Put("nohash", 0, "x", now)
	if _, _, ok := c.Get("nohash", 0, now); ok {
		t.Error("a picture that couldn't be hashed is never cached")
	}
	for i := 0; i < 100; i++ {
		c.Put(strings.Repeat("k", i+1), uint64(i+1), "x", now.Add(time.Duration(i)*time.Millisecond))
	}
	if c.Len() > answersMax {
		t.Errorf("cache is bounded: %d", c.Len())
	}
	if _, _, ok := c.Get(strings.Repeat("k", 100), 100, now.Add(time.Second)); !ok {
		t.Error("the newest entry survives eviction")
	}
}

func TestDiff(t *testing.T) {
	a := "window: Code — \"main.go\"\n txt line 1\n txt line 2\n txt line 3\n txt line 4\n txt line 5\n"
	b := strings.Replace(a, "line 3", "line three", 1)
	d, ok := Diff(a, b)
	if !ok || !strings.Contains(d, "+ txt line three") || !strings.Contains(d, "- txt line 3") {
		t.Fatalf("small change gives a diff: %q %v", d, ok)
	}
	if d, ok := Diff(a, a); !ok || d != "" {
		t.Fatal("no change gives an empty diff")
	}
	if _, ok := Diff(a, "window: x\n totally\n different\n text\n here\n now\n"); ok {
		t.Fatal("mostly changed: send the full text instead")
	}
}

func TestEncodeSkipsSecrets(t *testing.T) {
	tr := &Tree{Win: Win{App: "Firefox", Title: "Sign in"}, Nodes: []Flat{
		{D: 0, Role: "document", Name: "Sign in"},
		{D: 1, Role: "entry", Name: "Email", Value: "luke@example.com", Focus: true},
		{D: 1, Role: "password text", Name: "Password", Value: "hunter2", Secret: true},
		{D: 1, Role: "button", Name: "Continue"},
	}}
	s := Encode(tr, 0)
	if strings.Contains(s, "hunter2") {
		t.Fatalf("a password value must never be encoded:\n%s", s)
	}
	if !strings.Contains(s, "Continue") || !strings.HasPrefix(s, "window: Firefox") {
		t.Fatalf("encoding lost content:\n%s", s)
	}
}

func TestReaderForModel(t *testing.T) {
	r := NewReader()
	s1 := &Snapshot{Text: "window: A — \"x\"\n a\n b\n c\n d\n e\n f\n", Hash: 1, At: time.Now(), Source: "AT-SPI"}
	if out := r.ForModel("c1", s1, false); !strings.Contains(out, " a\n") {
		t.Fatal("first read is the full text")
	}
	if out := r.ForModel("c1", s1, false); !strings.Contains(out, "Nothing changed") {
		t.Fatalf("same hash: unchanged, got %q", out)
	}
	if out := r.ForModel("c2", s1, false); !strings.Contains(out, " a\n") {
		t.Fatal("another conversation gets the full text")
	}
	if out := r.ForModel("c1", s1, true); !strings.Contains(out, " a\n") {
		t.Fatal("full=true always returns the full text")
	}
}
