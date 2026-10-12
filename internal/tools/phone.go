package tools

import "strings"

func init() {
	register("phone_ask", "Ask the user's paired phone (Blaze for Android) to do something or find something out, in plain words: send or read texts, call someone, check notifications, set an alarm, find a contact, get its location, anything on the phone. The phone's Blaze does it (asking the user there when it needs approval) and returns its answer.",
		[]prop{p("task", "string", "What the phone should do, as a complete request, e.g. \"Text Mum: running 10 minutes late\"")}, []string{"task"},
		func(e *Env, a args) string {
			t := strings.TrimSpace(a.s("task"))
			if t == "" {
				return "Error: say what the phone should do in task."
			}
			if e.Phone == nil {
				return "No phone is paired with this PC. The user can pair one in Blaze Desktop › Phone (scan the QR code from Blaze on Android › Settings › Blaze Desktop)."
			}
			e.status("Asking your phone: " + firstLineOf(t, 60))
			return e.Phone(t)
		})
}

func firstLineOf(s string, n int) string {
	if i := strings.IndexByte(s, '\n'); i >= 0 {
		s = s[:i]
	}
	if len(s) > n {
		s = s[:n] + "…"
	}
	return s
}
