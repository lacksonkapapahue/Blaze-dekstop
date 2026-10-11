package tools

import (
	"context"
	"os"
	"os/exec"
	"runtime"
	"strings"
	"testing"
	"time"
)

// Stop must end a running command at once, including what the shell started.
func TestRunCtxStopKillsTheCommand(t *testing.T) {
	kind, name := "sh", "sh"
	if runtime.GOOS == "windows" {
		kind, name = "powershell", "powershell"
	}
	path, err := exec.LookPath(name)
	if err != nil {
		t.Skip("no shell")
	}
	sh := NewShell(kind, path, os.TempDir())
	cmd := "sleep 30 & sleep 30; wait"
	if sh.IsPowerShell() {
		cmd = "Start-Process -NoNewWindow ping -ArgumentList '-n','30','127.0.0.1'; Start-Sleep 30"
	}
	ctx, cancel := context.WithCancel(context.Background())
	go func() { time.Sleep(700 * time.Millisecond); cancel() }()
	start := time.Now()
	out := sh.RunCtx(ctx, cmd, time.Minute)
	if d := time.Since(start); d > 8*time.Second {
		t.Fatalf("Stop took %s (want a few seconds at most): %q", d, out)
	}
	if !strings.Contains(out, "stopped by the user") {
		t.Fatalf("out = %q", out)
	}
}

func TestRunCtxPassesEnvCtx(t *testing.T) {
	e := &Env{}
	if e.ctx() == nil {
		t.Fatal("nil ctx")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	ec := *e
	ec.Ctx = ctx
	if ec.ctx().Err() == nil {
		t.Fatal("Env.Ctx not used")
	}
}
