package llm

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestWireImages(t *testing.T) {
	p := filepath.Join(t.TempDir(), "s.png")
	_ = os.WriteFile(p, []byte("\x89PNG fake"), 0o600)
	msgs := []Message{{Role: "user", Content: "what's this?", Attach: []Attach{{Kind: "image", Path: p, Name: "s.png"}, {Kind: "file", Path: "/x.txt"}}}}

	w := wire(msgs, true)
	parts, ok := w[0].Content.([]map[string]any)
	if !ok || len(parts) != 2 || parts[0]["type"] != "text" || parts[1]["type"] != "image_url" {
		t.Fatalf("vision model content: %#v", w[0].Content)
	}
	if u := parts[1]["image_url"].(map[string]any)["url"].(string); !strings.HasPrefix(u, "data:image/png;base64,") {
		t.Fatalf("image url: %.40s", u)
	}

	w = wire(msgs, false)
	s, ok := w[0].Content.(string)
	if !ok || !strings.Contains(s, "can't see images") || !strings.Contains(s, p) {
		t.Fatalf("non-vision fallback: %#v", w[0].Content)
	}

	plain := wire([]Message{{Role: "user", Content: "hi"}}, true)
	if plain[0].Content != "hi" {
		t.Fatalf("plain message changed: %#v", plain[0].Content)
	}
}

func TestKeepRecentImages(t *testing.T) {
	var msgs []Message
	for i := 0; i < 4; i++ {
		msgs = append(msgs, Message{Role: "user", Content: "m", Attach: []Attach{{Kind: "image", Path: "/i.png"}}})
	}
	out := KeepRecentImages(msgs, 2)
	if imageCount(out[0]) != 0 || imageCount(out[1]) != 0 || imageCount(out[2]) != 1 || imageCount(out[3]) != 1 {
		t.Fatal("only the last two image messages should keep their images")
	}
	if imageCount(msgs[0]) != 1 {
		t.Fatal("KeepRecentImages changed the saved history")
	}
}
