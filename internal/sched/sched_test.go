package sched

import (
	"testing"
	"time"
)

func TestParse(t *testing.T) {
	Now = func() time.Time { return time.Date(2026, 10, 12, 9, 0, 0, 0, time.Local) }
	defer func() { Now = time.Now }()
	cases := map[string]string{
		"daily 07:00":           "0 7 * * *",
		"weekly mon 09:30":      "30 9 * * 1",
		"once 2026-11-15 18:00": "0 18 15 11 *",
		"hourly":                "0 * * * *",
	}
	for in, want := range cases {
		c, _, err := parse(in)
		if err != nil || c != want {
			t.Errorf("%s: %q %v", in, c, err)
		}
	}
	_, win, _ := parse("once 2026-11-15 18:00")
	if len(win) != 6 || win[1] != "ONCE" || win[3] != "11/15/2026" || win[5] != "18:00" {
		t.Errorf("schtasks args %v", win)
	}
	if _, _, err := parse("once 2026-10-01 08:00"); err == nil {
		t.Error("a past date should be refused")
	}
	if !(Job{When: "once 2026-11-15 18:00"}).Once() || (Job{When: "daily 07:00"}).Once() {
		t.Error("Once")
	}
}
