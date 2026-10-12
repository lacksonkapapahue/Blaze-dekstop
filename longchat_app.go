package main

// The long-chat engine in the app (plan part B): each turn sends the system prompt,
// the project brief, a rolling summary of older turns and only the last ~12 messages.
// Everything is indexed for search_chat/read_turn; big tool outputs become artifacts.

import (
	"context"
	"fmt"
	"strings"

	"github.com/lacksonkapapahue/blaze-desktop/internal/llm"
	"github.com/lacksonkapapahue/blaze-desktop/internal/longchat"
	"github.com/lacksonkapapahue/blaze-desktop/internal/tools"
)

const longChatLine = "\nLONG CHATS\n- Older turns of this chat may be folded into a summary. If you need something older than the summary, call search_chat (then read_turn for the full message). Never ask the user to repeat something they already said.\n- A tool result that ends with artifact:<id> was set aside because it was long: read_artifact reads the lines you need.\n- update_brief keeps this project's pinned brief (purpose, rules, key files, in progress; under ~600 tokens). Update it when something lasting changes.\n"

// keepWhole are tools whose output the model needs whole (never set aside).
var keepWhole = map[string]bool{"load_skill": true, "read_artifact": true, "read_turn": true, "search_chat": true, "use_skill": true}

// asideResult is what goes into the history for a tool result.
func asideResult(name, res string) string {
	if keepWhole[name] {
		return res
	}
	return longchat.Aside(res)
}

// contextWindow is the current model's context window (0 when unknown).
func (a *App) contextWindow() int {
	if a.cfg == nil || a.cfg.Default == nil {
		return 0
	}
	return llm.Info(a.cfg.Default.Provider, a.cfg.Default.Model).Context
}

// longContext indexes the chat, folds older turns into its summary when it's over
// budget, and returns the messages to send plus the system text to add (brief +
// summary). Any failure falls back to the old 60-message window.
func (a *App) longContext(ctx context.Context, s *session, hist []llm.Message) ([]llm.Message, string) {
	d, err := longchat.Default()
	if err != nil || s.id == "" {
		return trim(hist), ""
	}
	n := d.Indexed(s.id)
	if n > len(hist) { // the chat got shorter (cleared or retried): index it again
		d.Forget(s.id)
		n = 0
	}
	if n < len(hist) {
		var ms []longchat.Msg
		for i := n; i < len(hist); i++ {
			c := hist[i].Content
			if len(c) > 6000 {
				c = c[:6000]
			}
			ms = append(ms, longchat.Msg{Turn: i, Role: hist[i].Role, Content: c})
		}
		_ = d.Index(s.id, len(hist), ms)
	}
	extra := ""
	if b := d.Brief(s.project); b != "" && s.project != "" {
		extra = "\nPROJECT BRIEF (pinned; update_brief edits it)\n" + b + "\n"
	}
	st := d.State(s.id)
	sum := func(prev string, chunk []llm.Message) (string, error) {
		a.temit(s, "status", "Summarising older turns")
		msgs := []llm.Message{{Role: "system", Content: longchat.SummarisePrompt},
			{Role: "user", Content: "CURRENT NOTE:\n" + firstNonEmpty(prev, "(none yet)") + "\n\nNEW TURNS:\n" + longchat.Transcript(chunk, st.Upto)}}
		r, err := llm.CompleteWith(ctx, a.cfg, msgs, nil, llm.Opts{})
		if err != nil {
			return "", err
		}
		if strings.TrimSpace(r.Text) == "" {
			return "", fmt.Errorf("empty summary")
		}
		return r.Text, nil
	}
	out, sumText, changed, err := longchat.Context(hist, &st, longchat.Budget(a.contextWindow()), sum)
	if err != nil {
		return trim(hist), extra
	}
	if changed {
		_ = d.SetState(s.id, st)
	}
	if st.Summary == "" {
		out = trim(out)
	}
	return out, extra + sumText
}

func firstNonEmpty(a, b string) string {
	if strings.TrimSpace(a) != "" {
		return a
	}
	return b
}

// emitTokens feeds the live card's token meter, and past 80% of the context window
// offers a fresh chat that starts from a summary.
func (a *App) emitTokens(s *session, r *llm.Result, sent []llm.Message) {
	in, out := longchat.Tokens(sent), 0
	if r != nil && r.Usage != nil {
		if r.Usage.Prompt > 0 {
			in = r.Usage.Prompt
		}
		out = r.Usage.Completion
	} else if r != nil {
		out = len(r.Text) / 4
	}
	limit := a.contextWindow()
	if limit <= 0 {
		limit = 32768
	}
	a.temit(s, "tokens", map[string]any{"in": in, "out": out, "limit": limit, "high": in*10 >= limit*8, "bytes": callBytes(sent, r)})
}

// FreshChat starts a new chat that opens with a summary of the current one (offered
// when a chat nears its model's context limit). Returns the new chat's id.
func (a *App) FreshChat() string {
	a.mu.Lock()
	cur := a.cur
	a.mu.Unlock()
	if cur == nil || cur.id == "" {
		return ""
	}
	a.mu.Lock()
	hist := append([]llm.Message(nil), cur.hist...)
	a.mu.Unlock()
	summary := ""
	if d, err := longchat.Default(); err == nil {
		st := d.State(cur.id)
		summary = st.Summary
		if st.Upto < len(hist) {
			msgs := []llm.Message{{Role: "system", Content: longchat.SummarisePrompt},
				{Role: "user", Content: "CURRENT NOTE:\n" + firstNonEmpty(summary, "(none yet)") + "\n\nNEW TURNS:\n" + longchat.Transcript(hist[st.Upto:], st.Upto)}}
			if r, err := llm.CompleteWith(context.Background(), a.cfg, msgs, nil, llm.Opts{}); err == nil && strings.TrimSpace(r.Text) != "" {
				summary = strings.TrimSpace(r.Text)
			}
		}
	}
	if summary == "" {
		summary = longchat.Transcript(hist[max(0, len(hist)-6):], max(0, len(hist)-6))
	}
	ns := &session{hist: []llm.Message{{Role: "assistant", Content: "Picking up from your previous chat. Here's where we are:\n\n" + summary}}}
	a.mu.Lock()
	a.cur = ns
	a.mu.Unlock()
	a.saveConv(ns)
	return ns.id
}

// longChatTools: search_chat, read_turn, read_artifact, update_brief.
func init() {
	chatOf := func(e *tools.Env) string {
		if e == nil || e.Conv == nil {
			return ""
		}
		return strings.TrimPrefix(e.Conv(), "chat:")
	}
	projectOf := func(chat string) string {
		a := theApp
		if a == nil {
			return ""
		}
		a.mu.Lock()
		defer a.mu.Unlock()
		if s := a.live[chat]; s != nil && s.started {
			return s.project
		}
		return a.prefs.Project
	}
	tools.Register("search_chat", "Search this chat's earlier messages (including ones folded into the summary) and get exact snippets with their turn ids. Use it before asking the user to repeat anything.",
		[][3]string{{"query", "string", "Words to look for"}, {"limit", "integer", "Max results (default 5)"}}, []string{"query"},
		func(e *tools.Env, args map[string]any) string {
			d, err := longchat.Default()
			if err != nil {
				return "Error: chat search isn't available: " + err.Error()
			}
			hits := d.Search(chatOf(e), tools.ArgS(args, "query"), tools.ArgI(args, "limit", 5))
			if len(hits) == 0 {
				return "No earlier message matches. Try other words."
			}
			var b strings.Builder
			for _, h := range hits {
				fmt.Fprintf(&b, "turn %d (%s): %s\n", h.Turn, h.Role, h.Snippet)
			}
			b.WriteString("read_turn {id} returns a whole message.")
			return b.String()
		})
	tools.Register("read_turn", "Read one earlier message of this chat in full, by the turn id search_chat gave.",
		[][3]string{{"id", "integer", "Turn id"}}, []string{"id"},
		func(e *tools.Env, args map[string]any) string {
			d, err := longchat.Default()
			if err != nil {
				return "Error: " + err.Error()
			}
			m, ok := d.Turn(chatOf(e), tools.ArgI(args, "id", -1))
			if !ok {
				return "Error: no message with that turn id in this chat."
			}
			return fmt.Sprintf("turn %d (%s):\n%s", m.Turn, m.Role, m.Content)
		})
	tools.Register("read_artifact", "Read part of a long tool output that was set aside (artifact:<id>), with line numbers.",
		[][3]string{{"id", "string", "The artifact id"}, {"from", "integer", "First line, 1-based (default 1)"}, {"lines", "integer", "How many lines (default 200, max 400)"}}, []string{"id"},
		func(e *tools.Env, args map[string]any) string {
			out, err := longchat.ReadArtifact(tools.ArgS(args, "id"), tools.ArgI(args, "from", 1), tools.ArgI(args, "lines", 200))
			if err != nil {
				return "Error: " + err.Error()
			}
			return out
		})
	tools.Register("update_brief", "Replace this project's pinned brief, sent with every turn: purpose, rules, key files, what's in progress. Under ~600 tokens; write the whole brief each time.",
		[][3]string{{"brief", "string", "The full new brief"}}, []string{"brief"},
		func(e *tools.Env, args map[string]any) string {
			p := projectOf(chatOf(e))
			if p == "" {
				return "This chat isn't in a project, so there's no brief to keep. Use remember for lasting facts."
			}
			d, err := longchat.Default()
			if err != nil {
				return "Error: " + err.Error()
			}
			saved, err := d.SetBrief(p, tools.ArgS(args, "brief"))
			if err != nil {
				return "Error: " + err.Error()
			}
			return fmt.Sprintf("Brief saved (%d characters).", len(saved))
		})
}

// ProjectBrief and SetProjectBrief let the project page show and edit the brief.
func (a *App) ProjectBrief(project string) string {
	d, err := longchat.Default()
	if err != nil {
		return ""
	}
	return d.Brief(project)
}

func (a *App) SetProjectBrief(project, brief string) string {
	d, err := longchat.Default()
	if err != nil {
		return err.Error()
	}
	_, err = d.SetBrief(project, brief)
	if err != nil {
		return err.Error()
	}
	return ""
}
