package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	wr "github.com/wailsapp/wails/v2/pkg/runtime"

	"github.com/lacksonkapapahue/blaze-desktop/internal/agents"
	"github.com/lacksonkapapahue/blaze-desktop/internal/config"
	"github.com/lacksonkapapahue/blaze-desktop/internal/connect"
	"github.com/lacksonkapapahue/blaze-desktop/internal/llm"
	"github.com/lacksonkapapahue/blaze-desktop/internal/sched"
	"github.com/lacksonkapapahue/blaze-desktop/internal/sysinfo"
	"github.com/lacksonkapapahue/blaze-desktop/internal/tools"
)

// Prefs are desktop-only settings; models and keys are shared with the CLI in ~/.blaze.
type Prefs struct {
	Theme   string   `json:"theme"`  // system, light, dark
	Folder  string   `json:"folder"` // current project folder
	Recent  []string `json:"recent"`
	Welcome bool     `json:"welcome_done"`
	Project string   `json:"project"`     // current project id ("" = General)
	Design  string   `json:"design_mode"` // ask, always, never

	NoUpdateCheck bool   `json:"no_update_check"` // don't look for updates on launch
	SkipUpdate    string `json:"skip_update"`     // a release the user chose to skip, e.g. v0.3.0

	Background *bool  `json:"background,omitempty"` // closing the window keeps Blaze in the tray (default on)
	Autostart  bool   `json:"autostart"`            // start Blaze (hidden) when the user signs in
	Hotkey     string `json:"hotkey"`               // global shortcut preset; "" = default, "off"
	ShowSteps  bool   `json:"show_steps"`           // show every tool step instead of one status line
	FoldCards  *bool  `json:"fold_cards,omitempty"` // fold long answers into expandable cards (default on)

	AutoTitles *bool `json:"auto_titles,omitempty"` // AI chat titles from the chat's dominant theme (default on, titles.go)

	Personality       string `json:"personality"`        // "" / default, plain (no block), custom
	PersonalityCustom string `json:"personality_custom"` // the user's own personality text (custom)

	OnboardStep    int  `json:"onboard_step"`    // first-run onboarding: the step to resume at
	OnboardSkipped bool `json:"onboard_skipped"` // onboarding was skipped or finished; don't open it by itself

	MemoryAISort *bool `json:"memory_ai_sort,omitempty"` // let a model sort new memories into categories (default on)

	Composer  ComposerPrefs `json:"composer"`             // work mode, approval mode, voice (modes.go)
	Notify    NotifyPrefs   `json:"notify"`               // notifications and proactive suggestions (notify_app.go)
	Vision    VisionPrefs   `json:"vision"`               // screen reading (vision_app.go)
	MaxAgents int           `json:"max_agents,omitempty"` // background agents at once (0 = default, bgagents.go)
	Learn     LearnPrefs    `json:"learn"`                // learn automatically + chat marks (learn_app.go)
	Studio    StudioPrefs   `json:"studio"`               // Design studio: critic, taste, shared comments (studio_app.go)
}

type App struct {
	conv  atomic.Value // the current chat id, for convKey (read without a.mu)
	ctx   context.Context
	cfg   *config.Config
	info  sysinfo.Info
	prefs Prefs
	env   *tools.Env

	mu      sync.Mutex
	cancel  context.CancelFunc
	busy    bool
	pending map[string]chan int // confirm cards: 0 no, 1 yes, 2 always
	conn    *connect.Manager
	cloud   *cloudState // Blaze account + one-click connectors (account.go)
	convID  string
	history []llm.Message
	pv      *preview
	ready   chan struct{} // closed when startup has finished
	tab     string        // work or design

	sh       shellState // window, orb and tray state (shell.go)
	quitting bool       // a real quit is under way; don't hide on close
	flags    startFlags // command-line flags (--background, --orb, --relaunch)

	// Background agents (bgagents.go).
	agents    *agents.Manager
	main      *agents.Mainline      // main turns, one at a time; inputs that arrive mid-turn wait
	envs      map[string]*tools.Env // each sub-agent's own shell and approval gate
	questions map[string]chan string
}

func NewApp() *App {
	a := &App{pending: map[string]chan int{}, ready: make(chan struct{})}
	a.main = &agents.Mainline{Run: a.turn}
	return a
}

// waitReady blocks until startup is done. Wails runs OnStartup in a goroutine while
// the page loads, so the UI's first calls can arrive before cfg/env exist.
func (a *App) waitReady() {
	select {
	case <-a.ready:
	case <-time.After(30 * time.Second):
	}
}

func prefsFile() string { return filepath.Join(config.Dir(), "desktop.json") }

func (a *App) startup(ctx context.Context) {
	defer close(a.ready)
	a.ctx = ctx
	cleanupOldBinary()
	a.cfg = config.Load()
	a.info = sysinfo.Detect()
	b, _ := os.ReadFile(prefsFile())
	_ = json.Unmarshal(b, &a.prefs)
	if a.prefs.Theme == "" {
		a.prefs.Theme = "system"
	}
	if a.prefs.Design == "" {
		a.prefs.Design = "ask"
	}
	if st, err := os.Stat(a.prefs.Folder); err != nil || !st.IsDir() {
		a.prefs.Folder = a.info.Home
	}
	a.migrateComposer()
	a.pv = &preview{}
	a.pv.start()
	a.pv.load(a.prefs.Folder)
	a.startStudio()
	a.newEnv()
	a.startConnectors()
	a.startCloud()
	a.startComposer()
	a.startAgents()
	a.startShell()
	a.startNotify()
	a.startLearning()    // bundled skills + proactive memory (learn_app.go)
	go tools.SyncIndex() // every tool is registered by now (init); index them for find_tools
}

func (a *App) shutdown(ctx context.Context) {
	if a.agents != nil {
		a.agents.StopAll() // saved as running, so the next launch offers Resume
	}
	if a.env != nil {
		a.env.Jobs.StopAll()
	}
	if a.conn != nil {
		a.conn.Close()
	}
	stopTray()
}

func (a *App) savePrefs() {
	_ = os.MkdirAll(config.Dir(), 0o700)
	b, _ := json.MarshalIndent(a.prefs, "", "  ")
	_ = os.WriteFile(prefsFile(), b, 0o600)
}

func (a *App) newEnv() {
	var jobs *tools.Jobs
	if a.env != nil {
		jobs = a.env.Jobs
	} else {
		jobs = &tools.Jobs{}
	}
	a.env = &tools.Env{
		Info:  &a.info,
		Root:  a.prefs.Folder,
		Yolo:  false, // the desktop's Approval mode decides (gate in modes.go); auto_approve stays a CLI setting
		Shell: tools.NewShell(a.info.Shell, a.info.ShellPath, a.prefs.Folder),
		Jobs:  jobs,
	}
	a.env.Conv = a.convKey
	a.env.Confirm = a.gate
	a.env.Status = func(s string) { wr.EventsEmit(a.ctx, "status", s) }
}

// confirm shows the in-app confirm card and blocks the agent until the user answers.
func (a *App) confirm(title, detail string) bool { return a.ask(title, detail, false) > 0 }

// Answer is called by a confirm card's Yes / No.
func (a *App) Answer(id string, yes bool) {
	if yes {
		a.AnswerChoice(id, "once")
	} else {
		a.AnswerChoice(id, "no")
	}
}

func newID() string {
	b := make([]byte, 6)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

// ---------------- state for the UI ----------------

type State struct {
	Version     string            `json:"version"`
	SetupDone   bool              `json:"setup_done"`
	Info        sysinfo.Info      `json:"info"`
	Missing     []string          `json:"missing"`
	Installs    map[string]string `json:"installs"`
	Providers   []ProviderView    `json:"providers"`
	Chain       []config.Entry    `json:"chain"`
	Prefs       Prefs             `json:"prefs"`
	Yolo        bool              `json:"yolo"`
	Modes       ModeView          `json:"modes"`
	VisionModel string            `json:"vision_model"` // the first model that can see images ("" = none; composer)
	Persona     string            `json:"persona"`
	Keyless     bool              `json:"keyless"`
	Skills      []string          `json:"skills"`
	Memory      string            `json:"memory"`
	Project     *Project          `json:"project"`
	Model       string            `json:"model"`
	Selection   Selection         `json:"selection"`
	Routing     RoutingView       `json:"routing"`
	Desktop     DesktopView       `json:"desktop"`
	Connected   int               `json:"connected"` // connectors + MCP servers ready
	Notify      NotifyView        `json:"notify"`
	Vision      VisionPrefs       `json:"vision"`
}

func (a *App) State() State {
	a.waitReady()
	prefs := a.prefs
	fold := a.foldCards()
	prefs.FoldCards = &fold // always explicit for the UI
	autoT := a.autoTitlesOn()
	prefs.AutoTitles = &autoT
	if prefs.Personality == "" {
		prefs.Personality = "default"
	}
	aiSort := a.memAISort()
	prefs.MemoryAISort = &aiSort
	s := State{Version: version, SetupDone: a.cfg.SetupDone, Info: a.info, Chain: a.cfg.RouteChain(), Prefs: prefs,
		Yolo: a.cfg.AutoApprove, Persona: a.cfg.Persona, Keyless: a.cfg.AllowKeyless(), Missing: a.info.Missing(),
		Installs: map[string]string{}, Memory: tools.Memory(), Project: a.project(), Model: a.modelName(),
		Selection: a.selection(), Routing: a.routing(), Providers: a.providerViews(), Desktop: a.desktopView(), Connected: a.conn.ConnectedCount(),
		Notify: a.notifyView(false), Vision: a.prefs.Vision,
		Modes: a.modeView(), VisionModel: llm.VisionModel(llm.Targets(a.cfg, false))}
	for _, m := range s.Missing {
		s.Installs[m] = a.info.InstallCommand(m)
	}
	for _, sk := range tools.Skills() {
		s.Skills = append(s.Skills, sk.Name+": "+sk.Desc)
	}
	return s
}

// ---------------- setup & settings ----------------

func (a *App) FinishSetup() {
	a.cfg.SetupDone = true
	a.prefs.Welcome = true
	_ = a.cfg.Save()
	a.savePrefs()
}

func (a *App) SetPersona(p string)    { a.cfg.Persona = strings.TrimSpace(p); _ = a.cfg.Save() }
func (a *App) SetYolo(v bool)         { a.cfg.AutoApprove = v; _ = a.cfg.Save() } // the CLI's --yolo default; the desktop uses Approval mode
func (a *App) SetTheme(t string)      { a.prefs.Theme = t; a.savePrefs() }
func (a *App) SetDesignMode(m string) { a.prefs.Design = m; a.savePrefs() }

// SetMemory replaces the saved memories with the lines of the Settings textarea.
func (a *App) SetMemory(text string) { tools.SetMemoryText(text) }

// OpenURL opens a link in the user's browser.
func (a *App) OpenURL(u string) { wr.BrowserOpenURL(a.ctx, u) }

// InstallTool runs the package-manager install for a missing tool (the UI asked first).
func (a *App) InstallTool(name string) string {
	cmd := a.info.InstallCommand(name)
	if cmd == "" {
		return "No package manager can install " + name + " here."
	}
	sh := tools.NewShell(a.info.Shell, a.info.ShellPath, a.info.Home)
	r := sh.Run(cmd, 20*time.Minute)
	a.info = sysinfo.Detect()
	return r
}

func (a *App) RefreshPC() sysinfo.Info { a.info = sysinfo.Detect(); return a.info }

// ---------------- folder ----------------

func (a *App) PickFolder() string {
	d, err := wr.OpenDirectoryDialog(a.ctx, wr.OpenDialogOptions{Title: "Open a project folder", DefaultDirectory: a.prefs.Folder})
	if err != nil || d == "" {
		return a.prefs.Folder
	}
	a.SetFolder(d)
	return d
}

func (a *App) SetFolder(d string) {
	if st, err := os.Stat(d); err != nil || !st.IsDir() {
		return
	}
	a.prefs.Folder = d
	rec := []string{d}
	for _, r := range a.prefs.Recent {
		if r != d && len(rec) < 8 {
			rec = append(rec, r)
		}
	}
	a.prefs.Recent = rec
	a.savePrefs()
	a.newEnv()
	a.pv.load(d)
}

// ---------------- conversations ----------------

type Conv struct {
	ID       string        `json:"id"`
	Project  string        `json:"project"`
	Title    string        `json:"title"`
	Folder   string        `json:"folder"`
	Updated  time.Time     `json:"updated"`
	Messages []llm.Message `json:"messages"`
	Agents   []agents.View `json:"agents,omitempty"` // this chat's background agents (filled when opened)

	TitleSource string `json:"title_source,omitempty"` // auto (AI, titles.go) or manual (renamed); "" = first prompt
	TitleTurns  int    `json:"title_turns,omitempty"`  // user turns when the auto title was last evaluated
}

type ConvItem struct {
	ID      string `json:"id"`
	Title   string `json:"title"`
	Updated string `json:"updated"`
	Source  string `json:"source,omitempty"` // title_source
}

func convDir() string {
	d := filepath.Join(config.Dir(), "desktop", "chats")
	_ = os.MkdirAll(d, 0o700)
	return d
}

// Conversations lists the chats of one project ("" = General).
func (a *App) Conversations(project string) []ConvItem {
	var out []ConvItem
	for _, c := range a.allConvs() {
		if c.Project == project {
			out = append(out, ConvItem{ID: c.ID, Title: c.Title, Updated: c.Updated.Format("Jan 2"), Source: c.TitleSource})
		}
	}
	return out
}

func (a *App) allConvs() []Conv {
	ents, _ := os.ReadDir(convDir())
	var convs []Conv
	for _, e := range ents {
		b, err := os.ReadFile(filepath.Join(convDir(), e.Name()))
		if err != nil {
			continue
		}
		var c Conv
		if json.Unmarshal(b, &c) == nil {
			convs = append(convs, c)
		}
	}
	sort.Slice(convs, func(i, j int) bool { return convs[i].Updated.After(convs[j].Updated) })
	return convs
}

func (a *App) OpenConversation(id string) Conv {
	var c Conv
	b, err := os.ReadFile(filepath.Join(convDir(), id+".json"))
	if err == nil {
		_ = json.Unmarshal(b, &c)
	}
	rememberTitle(c)
	a.mu.Lock()
	a.convID = c.ID
	a.history = c.Messages
	a.mu.Unlock()
	a.noteHistory(c.Messages)
	if a.agents != nil && c.ID != "" {
		c.Agents = a.agents.List(c.ID)
	}
	if c.Project != a.prefs.Project {
		a.prefs.Project = c.Project
		a.savePrefs()
	}
	if c.Folder != "" && c.Folder != a.prefs.Folder {
		a.SetFolder(c.Folder)
	}
	return c
}

func (a *App) NewConversation() {
	a.mu.Lock()
	a.convID = ""
	a.history = nil
	a.mu.Unlock()
	a.conn.ResetLoaded()
}

func (a *App) DeleteConversation(id string) {
	titles.Lock()
	delete(titles.m, id)
	titles.Unlock()
	_ = os.Remove(filepath.Join(convDir(), id+".json"))
	a.mu.Lock()
	if a.convID == id {
		a.convID, a.history = "", nil
	}
	a.mu.Unlock()
}

func (a *App) saveConv() {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.convID == "" {
		a.convID = time.Now().Format("20060102-150405") + "-" + newID()[:4]
	}
	title, src, turns := promptTitle(a.history), "", 0
	if m, ok := getTitle(a.convID); ok && m.Title != "" {
		title, src, turns = m.Title, m.Source, m.Turns
	}
	c := Conv{ID: a.convID, Project: a.prefs.Project, Title: title, Folder: a.prefs.Folder, Updated: time.Now(), Messages: a.history,
		TitleSource: src, TitleTurns: turns}
	convWriteMu.Lock()
	defer convWriteMu.Unlock()
	b, _ := json.Marshal(c)
	_ = os.WriteFile(filepath.Join(convDir(), a.convID+".json"), b, 0o600)
}

// ---------------- chat ----------------

// Send starts a turn. Progress arrives as events: delta, tool, tool_done, status, confirm, done, error.
// files are project-relative paths the user attached with @.
func (a *App) Send(text string, files []string) string { return a.SendWith(text, files, nil) }

// SendWith is Send plus what the composer attached with +, drag-and-drop or paste
// (images, files and folders anywhere on disk; see attach.go).
func (a *App) SendWith(text string, files []string, att []llm.Attach) string {
	var b strings.Builder
	b.WriteString(text)
	for _, f := range files {
		full := filepath.Join(a.prefs.Folder, filepath.FromSlash(f))
		data, err := os.ReadFile(full)
		if err != nil {
			continue
		}
		if len(data) > 120_000 {
			data = append(data[:120_000], []byte("\n…(cut)")...)
		}
		fmt.Fprintf(&b, "\n\n<attached path=\"%s\">\n%s\n</attached>", f, data)
	}
	att = inlineAttach(&b, att)
	// A message sent mid-turn waits its turn instead of being refused (the main
	// agent stays free for chat while background agents work).
	if a.main.Submit(agents.Input{Kind: "user", Text: b.String(), Attach: att}) {
		return "queued"
	}
	return "ok"
}

// Retry drops the last answer and asks again.
func (a *App) Retry() string {
	if a.main.Busy() {
		return "busy"
	}
	a.mu.Lock()
	has := false
	for _, m := range a.history {
		has = has || m.Role == "user"
	}
	a.mu.Unlock()
	if !has {
		return "nothing"
	}
	a.main.Submit(agents.Input{Kind: "retry"})
	return "ok"
}

var attachedRe = regexp.MustCompile(`(?s)\n*<attached path="[^"]*"[^>]*>.*?</attached>`)

func stripAttached(s string) string { return attachedRe.ReplaceAllString(s, "") }

func (a *App) Stop() {
	a.mu.Lock()
	if a.cancel != nil {
		a.cancel()
	}
	pend := a.pending
	a.mu.Unlock()
	for _, ch := range pend {
		select {
		case ch <- 0:
		default:
		}
	}
}

func (a *App) run(ctx context.Context) {
	started := time.Now()
	setTrayStatus("Working…")
	defer setTrayStatus("Idle")
	var changed, urls []string
	prompt := ""
	a.mu.Lock()
	for _, m := range a.history {
		if m.Role == "user" && !isAgentResult(m) {
			prompt = strings.TrimPrefix(firstLine(stripAttached(m.Content)), "[Design edit] ")
		}
	}
	a.mu.Unlock()
	defer func() {
		if ok, st := a.pv.noteTurn(changed, urls, prompt); ok {
			wr.EventsEmit(a.ctx, "design", map[string]any{"target": st.Target, "versions": len(st.Versions)})
		}
	}()
	defer func() {
		if r := recover(); r != nil {
			wr.EventsEmit(a.ctx, "error", fmt.Sprint("Blaze hit an internal error: ", r))
		}
		a.mu.Lock()
		a.busy, a.cancel = false, nil
		a.mu.Unlock()
		a.saveConv()
		a.mu.Lock()
		id, hist := a.convID, append([]llm.Message(nil), a.history...)
		a.mu.Unlock()
		a.maybeRetitle(id, hist) // background, never blocks the turn
		a.maybeReflect(id, hist) // end-of-turn learning check (learn_app.go)
		a.afterTurn(started)
	}()
	steps := a.cfg.MaxSteps
	if steps <= 0 {
		steps = 40
	}
	a.mu.Lock()
	design := a.tab == "design"
	a.mu.Unlock()
	a.mu.Lock()
	for i := len(a.history) - 1; i >= 0; i-- {
		if a.history[i].Role == "user" {
			design = design || strings.HasPrefix(a.history[i].Content, "[Design edit]")
			break
		}
	}
	a.mu.Unlock()
	note, retries := "", 0
	ap, steps := a.startAutopilot(steps)
	for step := 0; step < steps; step++ {
		if why := ap.stop(a.cfg.DailyCap, llm.TodayCost()); why != "" {
			wr.EventsEmit(a.ctx, "error", map[string]any{"message": why, "kind": "steps"})
			return
		}
		a.mu.Lock()
		hist := trim(a.history)
		a.mu.Unlock()
		conv := a.convKey()
		sys := a.system(recentQuery(hist)) + tools.ExtraLine(conv) + agents.Delegation + agents.Orchestration
		if note != "" {
			sys += "\nABOUT YOUR LAST REPLY\n" + note + "\n"
		}
		msgs := append([]llm.Message{{Role: "system", Content: sys}}, hist...)
		// Connector tools join only when connected and enabled, and a group's tools
		// only after the model loads it, so the list stays small.
		// Blaze's own tools: the core set plus what find_tools turned on in this chat.
		all := append(append(append(tools.Select(conv), a.conn.Tools()...), agents.MainTools()...), updateBlazeTool())
		known := append(append(append(tools.Names(), a.conn.Known()...), agents.MainToolNames...), "update_blaze")
		wr.EventsEmit(a.ctx, "thinking", step)
		r, err := llm.CompleteWith(ctx, a.cfg, msgs, a.modeTools(all), llm.Opts{
			OnText:   func(s string) { wr.EventsEmit(a.ctx, "delta", s) },
			OnStatus: func(s string) { wr.EventsEmit(a.ctx, "status", s) },
			// Keyless may answer plain chat in Work when nothing that can use tools is set up.
			// Never in Design: a design turn without tools can't change anything.
			PlainFallback: !design,
		})
		if err != nil {
			if ctx.Err() != nil {
				wr.EventsEmit(a.ctx, "stopped", nil)
			} else {
				wr.EventsEmit(a.ctx, "error", turnError(err))
			}
			return
		}
		wr.EventsEmit(a.ctx, "route", map[string]any{"route": r.Route, "note": r.Note, "keyless": r.Keyless})
		// The gatekeeper: repair what can be repaired; never save a call with no name or
		// unreadable arguments (the provider would refuse every later request with a 400).
		n := llm.NormalizeCalls(r.ToolCalls, known)
		if strings.TrimSpace(r.Text) != "" || len(n.Calls) > 0 {
			a.mu.Lock()
			a.history = append(a.history, llm.Message{Role: "assistant", Content: r.Text, ToolCalls: n.Calls})
			a.mu.Unlock()
		}
		note = ""
		if len(n.Dropped) > 0 {
			note = "Blaze couldn't run " + strings.Join(n.Dropped, "; ") + ". Call the tool again with its exact name and a complete JSON object for the arguments."
			wr.EventsEmit(a.ctx, "repair", map[string]any{"dropped": n.Dropped, "repairs": n.Repairs})
		}
		if len(n.Calls) == 0 {
			if len(n.Dropped) > 0 && retries < 2 {
				retries++
				continue
			}
			if a.autoReply(&ap, r.Text) {
				continue // Autopilot: the user is away, so the agent decides and keeps going
			}
			wr.EventsEmit(a.ctx, "done", map[string]any{"route": r.Route, "note": r.Note, "keyless": r.Keyless, "seconds": time.Since(started).Seconds()})
			return
		}
		dispatched, onlyAgentTools := false, true
		for _, tc := range n.Calls {
			if ctx.Err() != nil {
				wr.EventsEmit(a.ctx, "stopped", nil)
				return
			}
			wr.EventsEmit(a.ctx, "tool", map[string]string{"id": tc.ID, "name": tc.Function.Name, "args": tc.Function.Arguments})
			setTrayStatus("Working · " + friendlyTool(tc.Function.Name, tc.Function.Arguments))
			res := a.modeBlock(tc.Function.Name, tc.Function.Arguments) // Plan mode refuses what can change things
			switch {
			case res != "":
				onlyAgentTools = false
			case agents.IsMainTool(tc.Function.Name):
				a.mu.Lock()
				conv := a.convID
				a.mu.Unlock()
				// Specialists inherit the lead's mode and step budget (never more).
				out := a.agents.HandleLeadTool(tc.Function.Name, tc.Function.Arguments, agents.Lead{Conv: conv, Folder: a.prefs.Folder, Mode: a.workMode(), MaxSteps: steps})
				res = out.Result
				dispatched = dispatched || out.Dispatched != ""
			case tc.Function.Name == "update_blaze":
				onlyAgentTools = false
				res = a.selfUpdate()
			case a.conn.Handles(tc.Function.Name):
				onlyAgentTools = false
				res = a.conn.Run(ctx, tc.Function.Name, tc.Function.Arguments)
			default:
				onlyAgentTools = false
				res = tools.Run(a.env, tc.Function.Name, tc.Function.Arguments)
			}
			changed, urls = a.designTouch(tc.Function.Name, tc.Function.Arguments, res, changed, urls)
			wr.EventsEmit(a.ctx, "tool_done", map[string]string{"id": tc.ID, "result": res})
			a.mu.Lock()
			a.history = append(a.history, llm.Message{Role: "tool", ToolCallID: tc.ID, Name: tc.Function.Name, Content: res})
			a.mu.Unlock()
		}
		// Handing work off ends the turn at once: the user gets a short line and the
		// composer is free while the agent works.
		if dispatched && onlyAgentTools {
			line := strings.TrimSpace(r.Text)
			if line == "" {
				line = "On it. I'll report back when it's done."
				wr.EventsEmit(a.ctx, "delta", line)
				a.mu.Lock()
				a.history = append(a.history, llm.Message{Role: "assistant", Content: line})
				a.mu.Unlock()
			}
			wr.EventsEmit(a.ctx, "done", map[string]any{"route": r.Route, "note": r.Note, "keyless": r.Keyless, "seconds": time.Since(started).Seconds(), "handoff": true})
			return
		}
	}
	wr.EventsEmit(a.ctx, "error", map[string]any{"message": fmt.Sprintf("Stopped after %d steps without finishing. Say \"continue\" to keep going.", steps), "kind": "steps"})
}

// turnError is what the chat's error card shows: a plain sentence, the raw details,
// and whether switching model would help.
func turnError(err error) map[string]any {
	out := map[string]any{"message": llm.Plain(err), "detail": err.Error(), "kind": "model"}
	var re *llm.RouteError
	if errors.As(err, &re) {
		out["failures"] = re.Failures
		out["resting"] = re.Resting
		if re.NoModels || re.NoTools {
			out["kind"] = "setup"
		}
	}
	return out
}

// SetTab tells the backend which tab the chat is in (work or design).
func (a *App) SetTab(t string) {
	a.mu.Lock()
	a.tab = t
	a.mu.Unlock()
}

func trim(h []llm.Message) []llm.Message {
	const max = 60
	if len(h) <= max {
		return append([]llm.Message(nil), h...)
	}
	cut := len(h) - max
	for cut < len(h) && h[cut].Role != "user" {
		cut++
	}
	return append([]llm.Message(nil), h[cut:]...)
}

func (a *App) foldCards() bool { return a.prefs.FoldCards == nil || *a.prefs.FoldCards }

// answerShape tells the model how to shape a reply. With cards on, long material goes
// into :::card blocks that the app folds away under a short answer.
func answerShape(cards bool) string {
	if !cards {
		return ""
	}
	return `
ANSWER SHAPE
- First the short answer: 1-4 plain sentences the user can read at a glance. Never put it inside a card.
- Long material (tables, step lists, long explanations, code over ~15 lines, reports, comparisons) goes in a card the app folds away:
:::card Short title
...Markdown...
:::
- Several cards are fine. Short replies need no card.
`
}

// defaultPersonality is Blaze's voice in chat turns (Settings › Behaviour › Personality).
const defaultPersonality = `PERSONALITY
You are Blaze. Be warm, sharp, and one step ahead: an expert who happens to be easy to talk to.
- Answer first. Lead with the result or the most useful true thing; skip preamble and filler ("Great question", "I'd be happy to").
- Take a side. When there are options, recommend one and say why in a sentence; give one backup only if it earns it.
- Be specific. Real names, numbers, file paths and commands beat adjectives. Never invent facts; say plainly when you're unsure.
- Read the room. Match the user's energy: brief when they're brief, steady and kind when something's gone wrong. Light humour is fine; forced cheer isn't.
- Talk like a person texting a friend who's good at this: contractions, short sentences, plain words.
- Bad news first, with a small cushion, then the way forward. If you made a mistake, fix it first, then own it in a few words.
- Do the work instead of describing it. Finish with the natural next step only when it's theirs to take.
- Be honest about what you are: a capable assistant on their computer, not a person.
`

// personality is the PERSONALITY block for chat turns (scheduled jobs don't use system()).
// Default: Blaze's voice. Plain: none. Custom: the user's text (empty falls back to none).
func (a *App) personality() string {
	switch a.prefs.Personality {
	case "plain":
		return ""
	case "custom":
		if t := strings.TrimSpace(a.prefs.PersonalityCustom); t != "" {
			return "\nPERSONALITY\n" + t + "\n"
		}
		return ""
	}
	return "\n" + defaultPersonality
}

// SetPersonality saves the personality mode (default, plain, custom) and the custom text.
func (a *App) SetPersonality(mode, custom string) {
	if mode != "plain" && mode != "custom" {
		mode = "default"
	}
	a.prefs.Personality, a.prefs.PersonalityCustom = mode, strings.TrimSpace(custom)
	a.savePrefs()
}

// DefaultPersonality is shown in Settings so the user can start a custom one from it.
func (a *App) DefaultPersonality() string { return defaultPersonality }

// recentQuery is what the memory and skill search looks for this turn: the last
// few user messages and the last reply, oldest first (the search favours the newest words).
func recentQuery(h []llm.Message) string {
	var parts []string
	users, replies := 0, 0
	for i := len(h) - 1; i >= 0 && users < 3; i-- {
		m := h[i]
		c := m.Content
		switch {
		case m.Role == "user":
			users++
		case m.Role == "assistant" && replies == 0 && c != "":
			replies++
			if len(c) > 400 {
				c = c[:400]
			}
		default:
			continue
		}
		if len(c) > 800 {
			c = c[len(c)-800:]
		}
		parts = append([]string{c}, parts...)
	}
	return strings.Join(parts, "\n")
}

// system is the system prompt for a turn whose conversation is about query: it
// carries only the memories and skills that match (v0.5.1), not all of them.
func (a *App) system(query string) string {
	var b strings.Builder
	b.WriteString(`You are Blaze, a capable assistant in a desktop app on the user's own computer. You act, not just advise: use your tools to run commands, read and edit files, write and run code, use git, search the web and install what's missing.

RULES
- Know before you ask: the PC profile below tells you the OS, shell, package managers and installed tools. Never ask what OS or shell they use.
- Write commands for THIS shell (PowerShell syntax on Windows, POSIX elsewhere).
- Look before you change: file_list / file_read / git status first. Make the smallest correct change, then run it or its tests to check.
- Servers, watchers and long builds go in run_shell background=true; then job_log. open_url shows a local server or file to the user.
- Missing program? install_tool (the user approves it).
- Only your core tools are loaded each turn. MORE TOOLS below lists the rest by name: call find_tools(query) to turn them on (or call one by its exact name). Memories and skills are also picked per turn: recall(query) and load_skill(name) reach the rest. Never use sudo or admin rights without asking.
- Be honest about failures. Never claim something worked without checking.
- Answers: short, direct, Markdown. Lead with the result.
`)
	b.WriteString(a.personality())
	b.WriteString(answerShape(a.foldCards()))
	b.WriteString(a.modeLine())
	if a.cfg.Persona != "" {
		b.WriteString("\nSTYLE\n" + a.cfg.Persona + "\n")
	}
	if m := a.modelName(); m != "" {
		b.WriteString("\nYOU RUN ON " + m + " through Blaze's model router (it may fall back to another model when one is busy). If asked what model you are, say that. Never claim to be GPT-4 or any model you are not.\n")
	}
	b.WriteString(`
DESIGN TAB
- Build anything visual (pages, screens, components, logos) as real files in the project: plain HTML/CSS/SVG, or the project's own framework. The app previews them live in its Design tab and saves a version after each turn.
- For a framework app, start its dev server with run_shell background=true; the app finds the localhost URL. Don't open_url it.
- A message starting with [Design edit] names one element (CSS selector + its HTML). Change ONLY that element in the source file, keep everything else identical, then say in one line what changed.
- When asked for directions, make 2-3 clearly different options as separate files (e.g. design/option-a.html, option-b.html, option-c.html), each self-contained. (The Directions button runs them as live branches instead.)
`)
	b.WriteString(a.studioPrompt())
	if p := a.project(); p != nil {
		b.WriteString("\nPROJECT: " + p.Name + "\n")
		if p.Instructions != "" {
			b.WriteString("Project instructions (always follow):\n" + p.Instructions + "\n")
		}
	}
	b.WriteString("\nPC PROFILE\n" + a.info.Summary() + "\n")
	b.WriteString("\nProject folder: " + a.env.Root + "\nCurrent folder: " + a.env.Shell.Cwd() + "\n")
	if _, err := os.Stat(filepath.Join(a.env.Root, ".git")); err == nil {
		b.WriteString("The project folder is a git repository.\n")
	}
	b.WriteString(tools.MemoryFor(query))
	b.WriteString(a.conn.PromptBlock())
	b.WriteString(tools.SkillsFor(query))
	b.WriteString(a.learnRules())
	b.WriteString("\nNow: " + time.Now().Format("Mon 2 Jan 2006 15:04 MST") + "\n")
	return b.String()
}

// ---------------- jobs & schedules ----------------

type JobView struct {
	ID    int    `json:"id"`
	Cmd   string `json:"cmd"`
	State string `json:"state"`
	Log   string `json:"log"`
}

func (a *App) Jobs() string { return tools.Run(a.env, "job_log", "{}") }
func (a *App) JobLog(id int) string {
	return tools.Run(a.env, "job_log", fmt.Sprintf(`{"id":%d,"lines":300}`, id))
}
func (a *App) JobStop(id int) string {
	return tools.Run(a.env, "job_stop", fmt.Sprintf(`{"id":%d}`, id))
}
func (a *App) Schedules() []sched.Job         { return sched.Load() }
func (a *App) RemoveSchedule(n string) string { return sched.Remove(n) }

func (a *App) ScheduleLog(name string) string {
	b, err := os.ReadFile(filepath.Join(config.Dir(), "logs", name+".log"))
	if err != nil {
		return "No runs yet."
	}
	s := string(b)
	if len(s) > 20000 {
		s = s[len(s)-20000:]
	}
	return s
}

// ---------------- doctor ----------------

type Check struct {
	Name   string `json:"name"`
	OK     bool   `json:"ok"`
	Detail string `json:"detail"`
	Fix    string `json:"fix,omitempty"` // a link that fixes it (e.g. a macOS privacy pane)
}

func (a *App) Doctor() []Check {
	var out []Check
	add := func(n string, ok bool, d string) { out = append(out, Check{Name: n, OK: ok, Detail: d}) }
	c := &http.Client{Timeout: 8 * time.Second}
	resp, err := c.Get("https://www.google.com/generate_204")
	online := err == nil && resp.StatusCode < 400
	if resp != nil {
		resp.Body.Close()
	}
	add("Internet", online, map[bool]string{true: "Online", false: "Can't reach the internet"}[online])
	targets := llm.Targets(a.cfg, false)
	if len(targets) == 0 {
		add("Models", false, "No model is set up. Add a free Gemini or Groq key in Settings › Models.")
	}
	for _, t := range targets {
		c := a.TestModel(t.Provider, t.Model)
		if t.Fixed {
			c.Detail = "Default · " + c.Detail
		}
		out = append(out, c)
	}
	if len(targets) > 0 && len(llm.Targets(a.cfg, true)) == 0 {
		add("Tools", false, "None of your models can use tools, so Blaze can't act. Add a Gemini, Groq or Cerebras key.")
	}
	sh := tools.NewShell(a.info.Shell, a.info.ShellPath, a.info.Home)
	add("Shell", strings.Contains(sh.Run("echo blaze-ok", 20*time.Second), "blaze-ok"), a.info.Shell+" · "+a.info.ShellPath)
	for _, t := range []string{"git", "python", "node"} {
		v, ok := a.info.Tools[t]
		if t == "python" && !ok {
			v, ok = a.info.Tools["python3"]
		}
		if !ok {
			v = "Not installed"
		}
		add(strings.ToUpper(t[:1])+t[1:], ok, v)
	}
	add("Disk", a.info.DiskFreeGB > 1, fmt.Sprintf("%.0f GB free", a.info.DiskFreeGB))
	add("Package manager", len(a.info.PkgManagers) > 0, strings.Join(a.info.PkgManagers, ", "))
	if runtime.GOOS != "windows" {
		_, err := exec.LookPath("crontab")
		add("Scheduler", err == nil, map[bool]string{true: "cron", false: "crontab missing: scheduled jobs won't run"}[err == nil])
	} else {
		add("Scheduler", true, "Task Scheduler")
	}
	if ok, note := tilingCheck(); note != "" {
		add("Window manager", ok, note)
	}
	d := a.desktopView()
	add("Tray", d.Tray, map[bool]string{true: d.TrayNote, false: "Not running: " + orStr(d.TrayNote, "the tray didn't start") + ". Closing the window quits Blaze."}[d.Tray])
	if d.Hotkey == "off" {
		add("Shortcut", true, "Off (Settings › Behaviour)")
	} else {
		add("Shortcut", d.HotkeyOK, orStr(d.HotkeyNote, d.HotkeyLabel))
	}
	switch {
	case !d.Autostart:
		add("Start at login", true, "Off (Settings › Behaviour)")
	case d.AutostartOK:
		add("Start at login", true, "On · starts hidden in the background")
	default:
		add("Start at login", false, "On, but the login entry is missing. Turn it off and on again.")
	}
	out = append(out, a.notifyCheck())
	out = append(out, a.visionChecks()...)
	return out
}

func orStr(s, alt string) string {
	if strings.TrimSpace(s) == "" {
		return alt
	}
	return s
}

func contains(s []string, v string) bool {
	for _, x := range s {
		if x == v {
			return true
		}
	}
	return false
}

// designTouch notes design files written and local servers seen during a turn.
func (a *App) designTouch(name, rawArgs, res string, changed, urls []string) ([]string, []string) {
	var args map[string]any
	_ = json.Unmarshal([]byte(rawArgs), &args)
	if name == "file_write" || name == "file_edit" {
		if p, _ := args["path"].(string); p != "" && designExt.MatchString(p) && !strings.HasPrefix(res, "Error") {
			full := p
			if !filepath.IsAbs(full) {
				full = filepath.Join(a.env.Shell.Cwd(), p)
			}
			if rel, err := filepath.Rel(a.prefs.Folder, full); err == nil && !strings.HasPrefix(rel, "..") {
				rel = filepath.ToSlash(rel)
				if !containsStr(changed, rel) {
					changed = append(changed, rel)
				}
			}
		}
	}
	if name == "run_shell" || name == "job_log" || name == "open_url" {
		src := res
		if name == "run_shell" && !strings.Contains(res, "[server on") {
			src = ""
		}
		if name == "open_url" {
			src, _ = args["target"].(string)
			if src == "" {
				src, _ = args["url"].(string)
			}
		}
		for _, m := range localURL.FindAllString(src, -1) {
			m = strings.Replace(m, "0.0.0.0", "localhost", 1)
			if m != a.pv.base() && !containsStr(urls, m) {
				urls = append(urls, m)
			}
		}
	}
	return changed, urls
}
