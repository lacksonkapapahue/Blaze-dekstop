package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"sync"
	"time"

	wr "github.com/wailsapp/wails/v2/pkg/runtime"

	"github.com/lacksonkapapahue/blaze-desktop/internal/config"
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
}

type App struct {
	ctx   context.Context
	cfg   *config.Config
	info  sysinfo.Info
	prefs Prefs
	env   *tools.Env

	mu       sync.Mutex
	cancel   context.CancelFunc
	busy     bool
	pending  map[string]chan bool
	convID   string
	history  []llm.Message
}

func NewApp() *App { return &App{pending: map[string]chan bool{}} }

func prefsFile() string { return filepath.Join(config.Dir(), "desktop.json") }

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	a.cfg = config.Load()
	a.info = sysinfo.Detect()
	b, _ := os.ReadFile(prefsFile())
	_ = json.Unmarshal(b, &a.prefs)
	if a.prefs.Theme == "" {
		a.prefs.Theme = "system"
	}
	if st, err := os.Stat(a.prefs.Folder); err != nil || !st.IsDir() {
		a.prefs.Folder = a.info.Home
	}
	a.newEnv()
}

func (a *App) shutdown(ctx context.Context) {
	if a.env != nil {
		a.env.Jobs.StopAll()
	}
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
		Yolo:  a.cfg.AutoApprove,
		Shell: tools.NewShell(a.info.Shell, a.info.ShellPath, a.prefs.Folder),
		Jobs:  jobs,
	}
	a.env.Confirm = a.confirm
	a.env.Status = func(s string) { wr.EventsEmit(a.ctx, "status", s) }
}

// confirm shows the in-app confirm card and blocks the agent until the user answers.
func (a *App) confirm(title, detail string) bool {
	id := newID()
	ch := make(chan bool, 1)
	a.mu.Lock()
	a.pending[id] = ch
	a.mu.Unlock()
	wr.EventsEmit(a.ctx, "confirm", map[string]string{"id": id, "title": title, "detail": detail})
	defer func() { a.mu.Lock(); delete(a.pending, id); a.mu.Unlock() }()
	select {
	case v := <-ch:
		return v
	case <-a.ctx.Done():
		return false
	}
}

// Answer is called by a confirm card's Yes / No.
func (a *App) Answer(id string, yes bool) {
	a.mu.Lock()
	ch := a.pending[id]
	a.mu.Unlock()
	if ch != nil {
		ch <- yes
	}
}

func newID() string {
	b := make([]byte, 6)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

// ---------------- state for the UI ----------------

type ProviderView struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	KeyHint string `json:"key_hint"`
	KeyPage string `json:"key_page"`
	Free    bool   `json:"free"`
	HasKey  bool   `json:"has_key"`
	Keyless bool   `json:"keyless"`
}

type State struct {
	Version   string          `json:"version"`
	SetupDone bool            `json:"setup_done"`
	Info      sysinfo.Info    `json:"info"`
	Missing   []string        `json:"missing"`
	Installs  map[string]string `json:"installs"`
	Providers []ProviderView  `json:"providers"`
	Chain     []config.Entry  `json:"chain"`
	Prefs     Prefs           `json:"prefs"`
	Yolo      bool            `json:"yolo"`
	Persona   string          `json:"persona"`
	Keyless   bool            `json:"keyless"`
	Skills    []string        `json:"skills"`
	Memory    string          `json:"memory"`
}

func (a *App) State() State {
	s := State{Version: version, SetupDone: a.cfg.SetupDone, Info: a.info, Chain: a.cfg.Chain, Prefs: a.prefs,
		Yolo: a.env.Yolo, Persona: a.cfg.Persona, Keyless: !a.cfg.NoKeyless, Missing: a.info.Missing(),
		Installs: map[string]string{}, Memory: tools.Memory()}
	for _, m := range s.Missing {
		s.Installs[m] = a.info.InstallCommand(m)
	}
	for _, p := range config.Providers {
		s.Providers = append(s.Providers, ProviderView{p.ID, p.Name, p.KeyHint, p.KeyPage, p.Free, a.cfg.Key(p.ID) != "", config.Keyless(p.ID)})
	}
	for _, sk := range tools.Skills() {
		s.Skills = append(s.Skills, sk.Name+": "+sk.Desc)
	}
	return s
}

// ---------------- setup & settings ----------------

type KeyResult struct {
	OK    bool   `json:"ok"`
	Model string `json:"model"`
	Where string `json:"where"`
	Error string `json:"error"`
}

// AddProvider tests a key (empty for keyless/local), saves it in the keychain and adds it to the chain.
func (a *App) AddProvider(id, key string) KeyResult {
	p, ok := config.ProviderByID(id)
	if !ok {
		return KeyResult{Error: "unknown provider"}
	}
	key = strings.TrimSpace(key)
	if key == "" {
		key = a.cfg.Key(id)
	}
	if key == "" && !config.Keyless(id) {
		return KeyResult{Error: "Paste a key first."}
	}
	ctx, cancel := context.WithTimeout(context.Background(), 25*time.Second)
	defer cancel()
	ids, err := llm.Models(ctx, p, key)
	if err != nil {
		if id == "ollama" {
			return KeyResult{Error: "Ollama isn't running. Start it, then try again."}
		}
		if id != "pollinations" {
			return KeyResult{Error: "That key didn't work: " + err.Error()}
		}
	}
	model := p.DefaultModel
	if model == "" || (len(ids) > 0 && !contains(ids, model)) {
		model = llm.PickModel(ids)
	}
	if model == "" {
		return KeyResult{Error: "No usable model found on " + p.Name + "."}
	}
	where := "no key needed"
	if !config.Keyless(id) {
		if where, err = a.cfg.SetKey(id, key); err != nil {
			return KeyResult{Error: "Couldn't save the key: " + err.Error()}
		}
	}
	var chain []config.Entry
	for _, e := range a.cfg.Chain {
		if e.Provider != id {
			chain = append(chain, e)
		}
	}
	a.cfg.Chain = append(chain, config.Entry{Provider: id, Model: model})
	a.cfg.SetupDone = true
	_ = a.cfg.Save()
	return KeyResult{OK: true, Model: model, Where: where}
}

func (a *App) RemoveProvider(id string) {
	var chain []config.Entry
	for _, e := range a.cfg.Chain {
		if e.Provider != id {
			chain = append(chain, e)
		}
	}
	a.cfg.Chain = chain
	a.cfg.DeleteKey(id)
	_ = a.cfg.Save()
}

// SetChain reorders models (the first healthy one answers).
func (a *App) SetChain(chain []config.Entry) {
	a.cfg.Chain = chain
	_ = a.cfg.Save()
}

func (a *App) FinishSetup() {
	a.cfg.SetupDone = true
	a.prefs.Welcome = true
	_ = a.cfg.Save()
	a.savePrefs()
}

func (a *App) SetPersona(p string) { a.cfg.Persona = strings.TrimSpace(p); _ = a.cfg.Save() }
func (a *App) SetYolo(v bool)      { a.cfg.AutoApprove = v; a.env.Yolo = v; _ = a.cfg.Save() }
func (a *App) SetKeyless(v bool)   { a.cfg.NoKeyless = !v; _ = a.cfg.Save() }
func (a *App) SetTheme(t string)   { a.prefs.Theme = t; a.savePrefs() }

func (a *App) SetMemory(text string) {
	_ = os.WriteFile(filepath.Join(config.Dir(), "memory.md"), []byte(strings.TrimSpace(text)+"\n"), 0o600)
}

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
}

// ---------------- conversations ----------------

type Conv struct {
	ID       string        `json:"id"`
	Title    string        `json:"title"`
	Folder   string        `json:"folder"`
	Updated  time.Time     `json:"updated"`
	Messages []llm.Message `json:"messages"`
}

type ConvItem struct {
	ID      string `json:"id"`
	Title   string `json:"title"`
	Updated string `json:"updated"`
}

func convDir() string {
	d := filepath.Join(config.Dir(), "desktop", "chats")
	_ = os.MkdirAll(d, 0o700)
	return d
}

func (a *App) Conversations() []ConvItem {
	ents, _ := os.ReadDir(convDir())
	var out []ConvItem
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
	for _, c := range convs {
		out = append(out, ConvItem{c.ID, c.Title, c.Updated.Format("Jan 2")})
	}
	return out
}

func (a *App) OpenConversation(id string) Conv {
	var c Conv
	b, err := os.ReadFile(filepath.Join(convDir(), id+".json"))
	if err == nil {
		_ = json.Unmarshal(b, &c)
	}
	a.mu.Lock()
	a.convID = c.ID
	a.history = c.Messages
	a.mu.Unlock()
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
}

func (a *App) DeleteConversation(id string) {
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
	title := "New chat"
	for _, m := range a.history {
		if m.Role == "user" {
			title = strings.TrimSpace(strings.SplitN(m.Content, "\n", 2)[0])
			if len(title) > 60 {
				title = title[:60] + "…"
			}
			break
		}
	}
	c := Conv{ID: a.convID, Title: title, Folder: a.prefs.Folder, Updated: time.Now(), Messages: a.history}
	b, _ := json.Marshal(c)
	_ = os.WriteFile(filepath.Join(convDir(), a.convID+".json"), b, 0o600)
}

// ---------------- chat ----------------

// Send starts a turn. Progress arrives as events: delta, tool, tool_done, status, confirm, done, error.
func (a *App) Send(text string) string {
	a.mu.Lock()
	if a.busy {
		a.mu.Unlock()
		return "busy"
	}
	ctx, cancel := context.WithCancel(a.ctx)
	a.cancel = cancel
	a.busy = true
	a.history = append(a.history, llm.Message{Role: "user", Content: text})
	a.mu.Unlock()
	go a.run(ctx)
	return "ok"
}

func (a *App) Stop() {
	a.mu.Lock()
	if a.cancel != nil {
		a.cancel()
	}
	pend := a.pending
	a.mu.Unlock()
	for _, ch := range pend {
		select {
		case ch <- false:
		default:
		}
	}
}

func (a *App) run(ctx context.Context) {
	started := time.Now()
	defer func() {
		if r := recover(); r != nil {
			wr.EventsEmit(a.ctx, "error", fmt.Sprint("Blaze hit an internal error: ", r))
		}
		a.mu.Lock()
		a.busy, a.cancel = false, nil
		a.mu.Unlock()
		a.saveConv()
	}()
	all := tools.All()
	steps := a.cfg.MaxSteps
	if steps <= 0 {
		steps = 40
	}
	for step := 0; step < steps; step++ {
		a.mu.Lock()
		hist := trim(a.history)
		a.mu.Unlock()
		msgs := append([]llm.Message{{Role: "system", Content: a.system()}}, hist...)
		wr.EventsEmit(a.ctx, "thinking", step)
		r, err := llm.Complete(ctx, a.cfg, msgs, all, func(s string) { wr.EventsEmit(a.ctx, "delta", s) })
		if err != nil {
			if ctx.Err() != nil {
				wr.EventsEmit(a.ctx, "stopped", nil)
			} else {
				wr.EventsEmit(a.ctx, "error", err.Error())
			}
			return
		}
		a.mu.Lock()
		a.history = append(a.history, llm.Message{Role: "assistant", Content: r.Text, ToolCalls: r.ToolCalls})
		a.mu.Unlock()
		if len(r.ToolCalls) == 0 {
			wr.EventsEmit(a.ctx, "done", map[string]any{"route": r.Route, "seconds": time.Since(started).Seconds()})
			return
		}
		for _, tc := range r.ToolCalls {
			if ctx.Err() != nil {
				wr.EventsEmit(a.ctx, "stopped", nil)
				return
			}
			wr.EventsEmit(a.ctx, "tool", map[string]string{"id": tc.ID, "name": tc.Function.Name, "args": tc.Function.Arguments})
			res := tools.Run(a.env, tc.Function.Name, tc.Function.Arguments)
			wr.EventsEmit(a.ctx, "tool_done", map[string]string{"id": tc.ID, "result": res})
			a.mu.Lock()
			a.history = append(a.history, llm.Message{Role: "tool", ToolCallID: tc.ID, Name: tc.Function.Name, Content: res})
			a.mu.Unlock()
		}
	}
	wr.EventsEmit(a.ctx, "error", fmt.Sprintf("Stopped after %d steps without finishing. Say \"continue\" to keep going.", steps))
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

func (a *App) system() string {
	var b strings.Builder
	b.WriteString(`You are Blaze, a capable assistant in a desktop app on the user's own computer. You act, not just advise: use your tools to run commands, read and edit files, write and run code, use git, search the web and install what's missing.

RULES
- Know before you ask: the PC profile below tells you the OS, shell, package managers and installed tools. Never ask what OS or shell they use.
- Write commands for THIS shell (PowerShell syntax on Windows, POSIX elsewhere).
- Look before you change: file_list / file_read / git status first. Make the smallest correct change, then run it or its tests to check.
- Servers, watchers and long builds go in run_shell background=true; then job_log. open_url shows a local server or file to the user.
- Missing program? install_tool (the user approves it). Never use sudo or admin rights without asking.
- Be honest about failures. Never claim something worked without checking.
- Answers: short, direct, Markdown. Lead with the result.
`)
	if a.cfg.Persona != "" {
		b.WriteString("\nSTYLE\n" + a.cfg.Persona + "\n")
	}
	b.WriteString("\nPC PROFILE\n" + a.info.Summary() + "\n")
	b.WriteString("\nProject folder: " + a.env.Root + "\nCurrent folder: " + a.env.Shell.Cwd() + "\n")
	if _, err := os.Stat(filepath.Join(a.env.Root, ".git")); err == nil {
		b.WriteString("The project folder is a git repository.\n")
	}
	if m := tools.Memory(); m != "" {
		b.WriteString("\nWHAT YOU KNOW ABOUT THE USER\n" + m + "\n")
	}
	if sk := tools.Skills(); len(sk) > 0 {
		b.WriteString("\nSKILLS (load with use_skill first)\n")
		for _, s := range sk {
			b.WriteString("- " + s.Name + ": " + s.Desc + "\n")
		}
	}
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

func (a *App) Jobs() string             { return tools.Run(a.env, "job_log", "{}") }
func (a *App) JobLog(id int) string     { return tools.Run(a.env, "job_log", fmt.Sprintf(`{"id":%d,"lines":300}`, id)) }
func (a *App) JobStop(id int) string    { return tools.Run(a.env, "job_stop", fmt.Sprintf(`{"id":%d}`, id)) }
func (a *App) Schedules() []sched.Job   { return sched.Load() }
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
}

func (a *App) Doctor() []Check {
	var out []Check
	add := func(n string, ok bool, d string) { out = append(out, Check{n, ok, d}) }
	c := &http.Client{Timeout: 8 * time.Second}
	resp, err := c.Get("https://www.google.com/generate_204")
	online := err == nil && resp.StatusCode < 400
	if resp != nil {
		resp.Body.Close()
	}
	add("Internet", online, map[bool]string{true: "Online", false: "Can't reach the internet"}[online])
	for _, e := range a.cfg.RouteChain() {
		p, ok := config.ProviderByID(e.Provider)
		if !ok {
			continue
		}
		key := a.cfg.Key(p.ID)
		if key == "" && !config.Keyless(p.ID) {
			add(p.Name, false, "No key saved")
			continue
		}
		m := e.Model
		if m == "" {
			m = p.DefaultModel
		}
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		t0 := time.Now()
		_, err := llm.Chat(ctx, p, key, m, []llm.Message{{Role: "user", Content: "Reply with OK."}}, nil, nil)
		cancel()
		if err != nil {
			msg := err.Error()
			if len(msg) > 120 {
				msg = msg[:120] + "…"
			}
			add(p.Name, false, m+": "+msg)
		} else {
			add(p.Name, true, fmt.Sprintf("%s answered in %.1fs", m, time.Since(t0).Seconds()))
		}
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
	return out
}

func contains(s []string, v string) bool {
	for _, x := range s {
		if x == v {
			return true
		}
	}
	return false
}
