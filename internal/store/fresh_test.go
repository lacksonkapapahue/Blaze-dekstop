package store

import (
	"path/filepath"
	"testing"
)

func TestFreshDir(t *testing.T) {
	t.Setenv("BLAZE_HOME", filepath.Join(t.TempDir(), "new", "dir"))
	t.Cleanup(CloseDefault) // Windows can't remove the temp dir while blaze.db is open
	d, err := Default()
	if err != nil {
		t.Fatal(err)
	}
	if d.CountMemories() != 0 {
		t.Fatal()
	}
}
