package studio

import (
	"bytes"
	"context"
	"image"
	"image/color"
	"image/png"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const page = `<!doctype html>
<html><body>
  <header class="top">
    <h1 class="title big">Hello &amp; welcome</h1>
    <p class="lead">First</p>
    <p class="lead">Second</p>
  </header>
  <img src="a.png">
  <button id="cta" class="btn" style="color: red">Buy now</button>
  <div class="card"><div class="card">inner</div></div>
</body></html>`

func TestLocateByIDClassesTextIndex(t *testing.T) {
	cases := []struct {
		t    Target
		want string
	}{
		{Target{Tag: "button", ID: "cta"}, `<button id="cta" class="btn" style="color: red">Buy now</button>`},
		{Target{Tag: "p", Classes: []string{"lead"}, Index: 1}, `<p class="lead">Second</p>`},
		{Target{Tag: "p", Classes: []string{"lead"}, Text: "First", Index: 1}, `<p class="lead">First</p>`},
		{Target{Tag: "h1", Classes: []string{"title"}}, `<h1 class="title big">Hello &amp; welcome</h1>`},
		{Target{Tag: "img"}, `<img src="a.png">`},
		{Target{Tag: "div", Classes: []string{"card"}}, `<div class="card"><div class="card">inner</div></div>`},
		{Target{Tag: "div", Classes: []string{"card"}, Text: "inner", Index: 1}, `<div class="card">inner</div>`},
	}
	for _, c := range cases {
		got, err := Extract(page, LangHTML, c.t)
		if err != nil || got != c.want {
			t.Errorf("%+v: got %q, %v; want %q", c.t, got, err, c.want)
		}
	}
	if _, err := Extract(page, LangHTML, Target{Tag: "nav"}); err != ErrNotFound {
		t.Errorf("missing element: %v", err)
	}
}

func TestApplyTextHTML(t *testing.T) {
	out, err := Apply(page, LangHTML, Edit{Kind: "text", Target: Target{Tag: "button", ID: "cta"}, OldText: "Buy now", NewText: "Get it"})
	if err != nil || !strings.Contains(out, `>Get it</button>`) {
		t.Fatalf("%v\n%s", err, out)
	}
	out, err = Apply(page, LangHTML, Edit{Kind: "text", Target: Target{Tag: "h1", Classes: []string{"title"}}, OldText: "Hello & welcome", NewText: "Hi & bye"})
	if err != nil || !strings.Contains(out, `>Hi &amp; bye</h1>`) {
		t.Fatalf("escaped text: %v\n%s", err, out)
	}
	// Only the one element changes.
	if strings.Count(out, "\n") != strings.Count(page, "\n") {
		t.Fatal("line count changed")
	}
}

func TestApplyStyleHTML(t *testing.T) {
	out, err := Apply(page, LangHTML, Edit{Kind: "style", Target: Target{Tag: "button", ID: "cta"}, Props: map[string]string{"color": "#1f4bd8", "padding": "12px"}})
	if err != nil || !strings.Contains(out, `style="color: #1f4bd8; padding: 12px"`) {
		t.Fatalf("%v\n%s", err, out)
	}
	out, err = Apply(page, LangHTML, Edit{Kind: "style", Target: Target{Tag: "p", Classes: []string{"lead"}, Index: 1}, Props: map[string]string{"font-size": "20px"}})
	if err != nil || !strings.Contains(out, `<p class="lead" style="font-size: 20px">Second</p>`) {
		t.Fatalf("%v\n%s", err, out)
	}
	out, err = Apply(page, LangHTML, Edit{Kind: "style", Target: Target{Tag: "img"}, Props: map[string]string{"width": "50%"}})
	if err != nil || !strings.Contains(out, `<img src="a.png" style="width: 50%">`) {
		t.Fatalf("void: %v\n%s", err, out)
	}
	// Removing the last declaration removes the attribute.
	out, err = Apply(page, LangHTML, Edit{Kind: "style", Target: Target{Tag: "button", ID: "cta"}, Props: map[string]string{"color": ""}})
	if err != nil || !strings.Contains(out, `<button id="cta" class="btn">Buy now</button>`) {
		t.Fatalf("remove: %v\n%s", err, out)
	}
}

func TestApplyAttrAndRemove(t *testing.T) {
	out, err := Apply(page, LangHTML, Edit{Kind: "attr", Target: Target{Tag: "img"}, Props: map[string]string{"alt": "A cat"}})
	if err != nil || !strings.Contains(out, `<img src="a.png" alt="A cat">`) {
		t.Fatalf("%v\n%s", err, out)
	}
	out, err = Apply(page, LangHTML, Edit{Kind: "remove", Target: Target{Tag: "p", Classes: []string{"lead"}, Text: "First"}})
	if err != nil || strings.Contains(out, "First") || !strings.Contains(out, "Second") || strings.Count(out, "\n") != strings.Count(page, "\n")-1 {
		t.Fatalf("%v\n%s", err, out)
	}
}

const jsx = `export default function Hero({ name }) {
  return (
    <section className="hero">
      <h1 className="hero-title" style={{ fontSize: 48, color: "#111" }}>Ship faster</h1>
      <p className="sub">Hi {name}</p>
      <Button variant="primary" {...rest} />
      <div style={styles.box}>x</div>
    </section>
  );
}`

func TestApplyJSX(t *testing.T) {
	out, err := Apply(jsx, LangJSX, Edit{Kind: "style", Target: Target{Tag: "h1", Classes: []string{"hero-title"}}, Props: map[string]string{"color": "#1f4bd8", "letter-spacing": "-0.02em"}})
	if err != nil || !strings.Contains(out, `style={{ fontSize: 48, color: "#1f4bd8", letterSpacing: "-0.02em" }}`) {
		t.Fatalf("%v\n%s", err, out)
	}
	out, err = Apply(jsx, LangJSX, Edit{Kind: "style", Target: Target{Tag: "p", Classes: []string{"sub"}}, Props: map[string]string{"margin-top": "8px"}})
	if err != nil || !strings.Contains(out, `<p className="sub" style={{ marginTop: "8px" }}>`) {
		t.Fatalf("insert: %v\n%s", err, out)
	}
	if _, err := Apply(jsx, LangJSX, Edit{Kind: "style", Target: Target{Tag: "div"}, Props: map[string]string{"color": "red"}}); err != ErrTooComplex {
		t.Fatalf("variable style: %v", err)
	}
	out, err = Apply(jsx, LangJSX, Edit{Kind: "text", Target: Target{Tag: "h1"}, OldText: "Ship faster", NewText: "Ship today"})
	if err != nil || !strings.Contains(out, ">Ship today</h1>") {
		t.Fatalf("text: %v\n%s", err, out)
	}
	if _, err := Apply(jsx, LangJSX, Edit{Kind: "text", Target: Target{Tag: "p"}, OldText: "Hi Ann", NewText: "Yo"}); err != ErrTooComplex {
		t.Fatalf("text with expression: %v", err)
	}
	// Self-closing component with a spread parses.
	if _, err := Extract(jsx, LangJSX, Target{Tag: "Button"}); err != nil {
		t.Fatal(err)
	}
}

const vue = `<template>
  <div class="box" :class="{ on }">
    <span class="label">Hi</span>
  </div>
</template>
<style scoped>.box { color: #333 }</style>`

func TestApplyVue(t *testing.T) {
	out, err := Apply(vue, LangHTML, Edit{Kind: "style", Target: Target{Tag: "span", Classes: []string{"label"}}, Props: map[string]string{"color": "#ff6600"}})
	if err != nil || !strings.Contains(out, `<span class="label" style="color: #ff6600">Hi</span>`) {
		t.Fatalf("%v\n%s", err, out)
	}
}

func TestRestoreElement(t *testing.T) {
	old := `<main><h2 class="t">Old title</h2><p>x</p></main>`
	cur := `<main><h2 class="t" style="color:red">New title</h2><p>y</p></main>`
	el, err := Extract(old, LangHTML, Target{Tag: "h2", Classes: []string{"t"}})
	if err != nil {
		t.Fatal(err)
	}
	out, err := ReplaceElement(cur, LangHTML, Target{Tag: "h2", Classes: []string{"t"}}, el)
	if err != nil || out != `<main><h2 class="t">Old title</h2><p>y</p></main>` {
		t.Fatalf("%v %s", err, out)
	}
}

func TestSwapColorAndPalette(t *testing.T) {
	css := `a{color:#1F4BD8} b{background:rgba(31, 75, 216, .5)} c{border-color:#1f4bd8cc} d{color:#fff}`
	out, n := SwapColor(css, "#1f4bd8", "#ff6600")
	if n != 3 || !strings.Contains(out, "color:#ff6600}") || !strings.Contains(out, "rgba(255, 102, 0, .5)") || !strings.Contains(out, "#ff6600cc") || !strings.Contains(out, "#fff") {
		t.Fatalf("%d %s", n, out)
	}
	if p := Palette(css); p[0] != "#1f4bd8" {
		t.Fatalf("palette %v", p)
	}
	if c := Contrast(RGB{0, 0, 0}, RGB{255, 255, 255}); c < 20.9 || c > 21.1 {
		t.Fatalf("contrast %v", c)
	}
}

func TestBrandFromPage(t *testing.T) {
	html := `<html><head><title>Docs | Acme</title><style>
	body{background:#fcfcfc;color:#111110;font-family:"Inter Tight", sans-serif}
	.btn{background:#1f4bd8;border-radius:6px}.x{color:#1f4bd8}.y{border-radius:6px}.z{color:#e5484d}
	</style><link rel="icon" href="/favicon.svg"></head><body></body></html>`
	b := BrandFromPage(html, nil, "https://acme.test/docs/")
	if b.Name != "Acme" || b.Paper != "#fcfcfc" || b.Ink != "#111110" || len(b.Accents) == 0 || b.Accents[0] != "#1f4bd8" || b.Radius != "6px" || b.Fonts[0] != "Inter Tight" || b.Logo != "https://acme.test/favicon.svg" {
		t.Fatalf("%+v", b)
	}
	if !strings.Contains(b.Prompt(), "#1f4bd8") {
		t.Fatal(b.Prompt())
	}
	if s := Stylesheets(`<link rel="stylesheet" href="css/a.css">`, "https://acme.test/docs/"); len(s) != 1 || s[0] != "https://acme.test/docs/css/a.css" {
		t.Fatal(s)
	}
}

func TestBrandFromImage(t *testing.T) {
	img := image.NewRGBA(image.Rect(0, 0, 40, 40))
	for y := 0; y < 40; y++ {
		for x := 0; x < 40; x++ {
			c := color.RGBA{255, 102, 0, 255}
			if x < 10 {
				c = color.RGBA{0, 0, 0, 0}
			}
			img.Set(x, y, c)
		}
	}
	var buf bytes.Buffer
	_ = png.Encode(&buf, img)
	b, err := BrandFromImage(&buf, "logo.png")
	if err != nil || len(b.Accents) != 1 || b.Accents[0] != "#ff6600" {
		t.Fatalf("%v %+v", err, b)
	}
}

func TestTaste(t *testing.T) {
	var ts Taste
	before := `body{font-family:Arial}`
	mid := `body{font-family:"Inter";color:#1f4bd8} .a{border-radius:12px}`
	after := `body{font-family:"Inter"} .a{border-radius:12px}`
	ts.Compare(before, mid, after)
	l, d := ts.Top("font", 3)
	if len(l) != 1 || l[0] != "Inter" || len(d) != 0 {
		t.Fatalf("fonts %v %v", l, d)
	}
	_, d = ts.Top("color", 3)
	if len(d) != 1 || d[0] != "#1f4bd8" {
		t.Fatalf("colours %v", d)
	}
	ts.ObserveEdit(map[string]string{"color": "rgb(255, 102, 0)", "padding": "24px"}, 2)
	p := ts.Prompt()
	if !strings.Contains(p, "#ff6600") || !strings.Contains(p, "Avoid: colours #1f4bd8") || !strings.Contains(p, "24px") {
		t.Fatal(p)
	}
	ts.Undo(`.x{color:#00ff00}`, `.x{color:#ff6600}`)
	if _, d := ts.Top("color", 5); !contains(d, "#00ff00") {
		t.Fatal(d)
	}
}

func TestCritic(t *testing.T) {
	c := Score([]Audit{
		{Width: 1280, Nodes: 200},
		{Width: 390, OverflowPx: 40, SmallTaps: []Finding{{Sel: "a.x"}}, Contrast: []Finding{{Sel: "p.muted", Ratio: 2.1, Need: 4.5}}, NoAlt: []Finding{{Sel: "img"}}},
	})
	if c.Score >= 90 || c.Layout != 75 || len(c.Issues) != 4 {
		t.Fatalf("%+v", c)
	}
	if !c.NeedsFix(90) {
		t.Fatal("should fix")
	}
	if Score([]Audit{{Width: 1280}, {Width: 390}}).Score != 100 {
		t.Fatal("clean page should be 100")
	}
	if p := FixPrompt(c, nil, "index.html"); !strings.Contains(p, "[Critic fix]") || !strings.Contains(p, "low contrast") {
		t.Fatal(p)
	}
}

func TestStackAndStage(t *testing.T) {
	d := t.TempDir()
	if s := DetectStack(d); s.Framework != "html" || s.Describe() != "plain HTML/CSS" {
		t.Fatal(s)
	}
	_ = os.WriteFile(filepath.Join(d, "package.json"), []byte(`{"scripts":{"build":"vite build"},"dependencies":{"react":"19"},"devDependencies":{"tailwindcss":"4","typescript":"5"}}`), 0o644)
	if s := DetectStack(d); s.Framework != "react" || s.Describe() != "React + TypeScript with Tailwind CSS" || s.Build != "build" {
		t.Fatal(s)
	}
	site := t.TempDir()
	_ = os.WriteFile(filepath.Join(site, "index.html"), []byte("<html><body>x</body></html>"), 0o644)
	_ = os.MkdirAll(filepath.Join(site, "node_modules", "x"), 0o755)
	_ = os.WriteFile(filepath.Join(site, "node_modules", "x", "a.js"), []byte("x"), 0o644)
	_ = os.WriteFile(filepath.Join(site, "main.go"), []byte("x"), 0o644)
	_ = os.WriteFile(filepath.Join(site, "style.css"), []byte("x"), 0o644)
	dest := filepath.Join(t.TempDir(), "out")
	n, err := Stage(context.Background(), site, dest, Stack{Framework: "html"}, nil)
	if err != nil || n != 2 {
		t.Fatalf("%d %v", n, err)
	}
	if err := InjectComments(dest, "https://w.test", "abc"); err != nil {
		t.Fatal(err)
	}
	b, _ := os.ReadFile(filepath.Join(dest, "index.html"))
	if !strings.Contains(string(b), `https://w.test/v1/comments.js" data-site="abc"`) {
		t.Fatal(string(b))
	}
	// A build project runs its build through the runner.
	var ran []string
	run := func(ctx context.Context, dir, name string, args ...string) (string, error) {
		ran = append(ran, name+" "+strings.Join(args, " "))
		if strings.Join(args, " ") == "run build" {
			_ = os.MkdirAll(filepath.Join(dir, "dist"), 0o755)
			_ = os.WriteFile(filepath.Join(dir, "dist", "index.html"), []byte("<html></html>"), 0o644)
		}
		return "", nil
	}
	_ = os.MkdirAll(filepath.Join(d, "node_modules"), 0o755)
	if _, err := Stage(context.Background(), d, filepath.Join(t.TempDir(), "o"), DetectStack(d), run); err != nil || len(ran) != 1 {
		t.Fatalf("%v %v", ran, err)
	}
}

func TestShipHelpers(t *testing.T) {
	if Slug("My Cool Site!!") != "my-cool-site" {
		t.Fatal(Slug("My Cool Site!!"))
	}
	for _, r := range []string{"git@github.com:ann/site.git", "https://github.com/ann/site", "https://github.com/ann/site.git\n"} {
		if o, n, ok := GitHubRepo(r); !ok || o != "ann" || n != "site" {
			t.Fatal(r, o, n)
		}
	}
	if PagesURL("Ann", "ann.github.io") != "https://ann.github.io/" || PagesURL("ann", "site") != "https://ann.github.io/site/" {
		t.Fatal("pages url")
	}
}

func TestDiff(t *testing.T) {
	d := Diff("a.html", "1\n2\n3\n4\n5\n6\n7\n8", "1\n2\n3\n4\nfive\n6\n7\n8")
	if !strings.Contains(d, "-5\n+five\n") || !strings.Contains(d, "@@ -2,7 +2,7 @@") {
		t.Fatal(d)
	}
	if a, r := DiffStat(d); a != 1 || r != 1 {
		t.Fatal(a, r)
	}
}
