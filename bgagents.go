package main

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"time"

	wr "github.com/wailsapp/wails/v2/pkg/runtime"

	"github.com/lacksonkapapahue/blaze-desktop/internal/agents"
	"github.com/lacksonkapapahue/blaze-desktop/internal/config"
	"github.com/lacksonkapapahue/blaze-desktop/internal/llm"
	"github.com/lacksonkapapahue/blaze-desktop/internal/tools"
)

// Background agents (v0.4.7): the main chat hands long work to sub-agents and keeps
// chatting. The engine lives in internal/agents; this file wires it to the app: the
// model router, the tools and approval gate, the UI events and the main turn queue.

func agentsDir() string { return filepath.Join(config.Dir(), "desktop", "agents") }

// agentCap is how many sub-agents may run at once (Settings › Behaviour).
func (a *App) agentCap() int {
	if a.prefs.MaxAgents > 0 {
		return a.prefs.MaxAgents
	}
	n := agents.DefaultCap
	if a.info.Cores > 0 && a.info.Cores <= 2 {
		n = 1 // a small machine: one agent's builds and installs at a time
	}
	return n
}

func (a *App) startAgents() {
	a.envs = map[string]*tools.Env{}
	a.questions = map[string]chan string{}
	steps := a.cfg.MaxSteps
	if steps <= 0 {
		steps = 40
	}
	a.agents = agents.New(agents.Runtime{
		Complete: func(ctx context.Context, msgs []llm.Message, ts []llm.Tool) (*llm.Result, error) {
			return llm.CompleteWith(ctx, a.cfg, msgs, ts, llm.Opts{})
		},
		Tools:    a.agentTools,
		Known:    func() []string { return append(append(tools.Names(), a.conn.Known()...), "ask_user") },
		Exec:     a.agentExec,
		System:   func(ag *agents.Agent) string { return a.system() + agents.SubSystem(ag.Handle) },
		Describe: friendlyTool,
		MaxSteps: steps,
	}, agentsDir(), a.agentCap())
	a.agents.OnChange = func(v agents.View) {
		if agents.Active(v.Status) {
			v.Steps = nil // steps stream as agent_step; the whole log comes with the final view
		}
		a.emit("agent", v)
	}
	a.agents.OnStep = func(h string, s agents.Step) {
		if len(s.Result) > 2000 {
			s.Result = s.Result[:2000] + "\n…"
		}
		a.emit("agent_step", map[string]any{"handle": h, "step": s})
	}
	a.agents.OnRemove = func(h string) { a.emit("agent_removed", h) }
	a.agents.OnResult = func(v agents.View) {
		a.mu.Lock()
		delete(a.envs, v.Handle)
		a.mu.Unlock()
		a.main.Submit(agents.Input{Kind: "agent", Text: agents.ResultMessage(v), Handle: v.Handle, Conv: v.Conv})
	}
	a.agents.Load()
	a.agents.Prune(7 * 24 * time.Hour)
	a.resumeAfterUpdate()
}

func (a *App) emit(ev string, d any) {
	if a.ctx != nil {
		wr.EventsEmit(a.ctx, ev, d)
	}
}

// agentTools is a sub-agent's tool list: everything the main agent has except the
// agent-control tools, plus ask_user, optionally narrowed to the dispatch's scope.
func (a *App) agentTools(scope []string) []llm.Tool {
	all := append(tools.All(), a.conn.Tools()...)
	if len(scope) > 0 {
		want := map[string]bool{}
		for _, s := range scope {
			want[strings.TrimSpace(s)] = true
		}
		var out []llm.Tool
		for _, t := range all {
			if want[t.Function.Name] {
				out = append(out, t)
			}
		}
		if len(out) > 0 {
			all = out
		}
	}
	return append(all, agents.AskTool())
}

// agentEnv is a sub-agent's own tool environment: its own shell (and working
// folder), the shared jobs, and an approval gate that shows on its card.
func (a *App) agentEnv(ag *agents.Agent) *tools.Env {
	a.mu.Lock()
	defer a.mu.Unlock()
	if e := a.envs[ag.Handle]; e != nil {
		e.Yolo = a.env.Yolo
		return e
	}
	root := ag.Folder
	if st, err := os.Stat(root); root == "" || err != nil || !st.IsDir() {
		root = a.prefs.Folder
	}
	h := ag.Handle
	e := &tools.Env{Info: &a.info, Root: root, Yolo: a.env.Yolo, Shell: tools.NewShell(a.info.Shell, a.info.ShellPath, root), Jobs: a.env.Jobs}
	e.Confirm = func(title, detail string) bool { return a.agentGate(h, title, detail) }
	e.Status = func(s string) { a.agents.Status(h, s) }
	a.envs[h] = e
	return e
}

func (a *App) agentExec(ctx context.Context, ag *agents.Agent, name, args string) string {
	if name == "ask_user" {
		return a.agentQuestion(ctx, ag.Handle, args)
	}
	if agents.IsMainTool(name) {
		return "Error: background agents can't start or steer other agents. Do the work yourself."
	}
	if a.conn.Handles(name) {
		return a.conn.Run(ctx, name, args)
	}
	return tools.Run(a.agentEnv(ag), name, args)
}

// agentGate is a sub-agent's approval: Autopilot approves (catastrophic commands stay
// blocked) like the main chat's gate in modes.go; Auto asks on the agent's card.
func (a *App) agentGate(handle, title, detail string) bool {
	if a.approval() == "autopilot" {
		if why := Catastrophic(title, detail); why != "" {
			a.agents.Status(handle, "Blocked: "+why)
			return false
		}
		return true
	}
	return a.askAgent(handle, title, detail)
}

// askAgent is the approval card for a sub-agent: it shows on the agent's card and
// blocks only that agent, never the main chat.
func (a *App) askAgent(handle, title, detail string) bool {
	id := newID()
	ch := make(chan int, 1)
	a.mu.Lock()
	a.pending[id] = ch
	a.mu.Unlock()
	defer func() { a.mu.Lock(); delete(a.pending, id); a.mu.Unlock() }()
	a.agents.SetWaiting(handle, true, "Waiting for your approval")
	defer a.agents.SetWaiting(handle, false, "Working on it")
	a.emit("confirm", map[string]any{"id": id, "title": title, "detail": detail, "agent": handle})
	select {
	case v := <-ch:
		return v > 0
	case <-a.ctx.Done():
		return false
	}
}

// agentAway is the Autopilot hook: in Autopilot (modes.go) the user is away, so a
// sub-agent's question gets the same away-reply as the main agent's.
var agentAway = func(a *App) (string, bool) {
	if a.approval() == "autopilot" {
		return AutoReply, true
	}
	return "", false
}

// agentQuestion is ask_user for a sub-agent: a question on its card.
func (a *App) agentQuestion(ctx context.Context, handle, raw string) string {
	var q struct {
		Question string   `json:"question"`
		Choices  []string `json:"choices"`
	}
	_ = json.Unmarshal([]byte(raw), &q)
	if strings.TrimSpace(q.Question) == "" {
		return "Error in ask_user: write the question."
	}
	if reply, ok := agentAway(a); ok {
		return reply
	}
	id := newID()
	ch := make(chan string, 1)
	a.mu.Lock()
	a.questions[id] = ch
	a.mu.Unlock()
	defer func() { a.mu.Lock(); delete(a.questions, id); a.mu.Unlock() }()
	a.agents.SetWaiting(handle, true, "Waiting for your answer")
	defer a.agents.SetWaiting(handle, false, "Working on it")
	a.emit("agent_question", map[string]any{"id": id, "agent": handle, "question": q.Question, "choices": q.Choices})
	select {
	case ans := <-ch:
		return "The user answered: " + ans
	case <-ctx.Done():
		return "The agent was stopped before the user answered."
	case <-a.ctx.Done():
		return "Blaze closed before the user answered."
	}
}

// ---------------- bound methods for the UI ----------------

// Agents lists background agents for a chat ("" = all chats).
func (a *App) Agents(conv string) []agents.View {
	a.waitReady()
	return a.agents.List(conv)
}

// AgentStop is the Stop button on an agent card.
func (a *App) AgentStop(handle string) string { return errText(a.agents.Cancel(handle)) }

// AgentResume restarts an interrupted (or stopped) agent.
func (a *App) AgentResume(handle string) string { return errText(a.agents.Resume(handle)) }

// AgentDiscard forgets an agent that isn't running.
func (a *App) AgentDiscard(handle string) string { return errText(a.agents.Discard(handle)) }

// AnswerAgent answers a sub-agent's question.
func (a *App) AnswerAgent(id, text string) {
	a.mu.Lock()
	ch := a.questions[id]
	a.mu.Unlock()
	if ch != nil {
		select {
		case ch <- strings.TrimSpace(text):
		default:
		}
	}
}

// SetMaxAgents sets how many background agents run at once (1-6).
func (a *App) SetMaxAgents(n int) int {
	if n < 1 {
		n = 1
	}
	if n > agents.MaxCap {
		n = agents.MaxCap
	}
	a.prefs.MaxAgents = n
	a.savePrefs()
	a.agents.SetCap(n)
	return n
}

// ---------------- the main turn queue ----------------

// turn runs one main-agent turn for an input from the Mainline: a user message, a
// background agent's result, or a retry. Inputs that arrive mid-turn wait their turn.
func (a *App) turn(in agents.Input) {
	a.mu.Lock()
	switch in.Kind {
	case "agent":
		if in.Conv != "" && in.Conv != a.convID {
			// The user moved to another chat: file the result there; the agent's
			// card in that chat carries the report.
			a.mu.Unlock()
			appendToConv(in.Conv, llm.Message{Role: "user", Content: in.Text})
			a.emit("toast", map[string]string{"text": "Background agent " + in.Handle + " finished in another chat", "kind": "ok"})
			a.agentElsewhere(in.Handle, in.Conv) // native notification when Blaze is hidden (notify_app.go)
			return
		}
		a.history = append(a.history, llm.Message{Role: "user", Content: in.Text})
	case "retry":
		last := -1
		for i, m := range a.history {
			if m.Role == "user" {
				last = i
			}
		}
		if last < 0 {
			a.mu.Unlock()
			return
		}
		a.history = a.history[:last+1]
	default:
		a.history = append(a.history, llm.Message{Role: "user", Content: in.Text, Attach: in.Attach})
	}
	ctx, cancel := context.WithCancel(a.ctx)
	a.cancel = cancel
	a.busy = true
	a.tagMemoryTurn()
	conv := a.convID
	a.mu.Unlock()
	a.emit("turn", map[string]any{"kind": in.Kind, "handle": in.Handle, "conv": conv})
	a.run(ctx)
}

// appendToConv adds a message to a saved chat that isn't open.
func appendToConv(id string, m llm.Message) {
	convWriteMu.Lock()
	defer convWriteMu.Unlock()
	p := filepath.Join(convDir(), id+".json")
	b, err := os.ReadFile(p)
	if err != nil {
		return
	}
	var c Conv
	if json.Unmarshal(b, &c) != nil {
		return
	}
	c.Messages = append(c.Messages, m)
	c.Updated = time.Now()
	out, _ := json.Marshal(c)
	_ = os.WriteFile(p, out, 0o600)
}

func isAgentResult(m llm.Message) bool {
	return m.Role == "user" && strings.HasPrefix(m.Content, agents.ResultPrefix)
}
