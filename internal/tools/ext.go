package tools

// Register adds a tool that lives outside this package (the desktop app's screen
// and notification tools). props are name -> [type, description]; h gets the raw
// arguments.
func Register(name, desc string, props [][3]string, required []string, h func(e *Env, a map[string]any) string) {
	ps := make([]prop, 0, len(props))
	for _, x := range props {
		ps = append(ps, p(x[0], x[1], x[2]))
	}
	register(name, desc, ps, required, func(e *Env, a args) string { return h(e, map[string]any(a)) })
}

// Arg helpers for registered tools.
func ArgS(a map[string]any, k string) string       { return args(a).s(k) }
func ArgI(a map[string]any, k string, def int) int { return args(a).i(k, def) }
func ArgB(a map[string]any, k string) bool         { return args(a).b(k) }

// OnJobDone, when set, is told when a background job ends (for a notification).
var OnJobDone func(id int, cmd string, code int, took float64)
