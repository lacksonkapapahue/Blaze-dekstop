package tools

import (
	"testing"

	"github.com/lacksonkapapahue/blaze-desktop/internal/store"
)

// testHome points BLAZE_HOME at dir for this test and closes the shared blaze.db
// before the test's temp folders are removed (Windows can't delete an open file).
func testHome(t *testing.T, dir string) {
	t.Helper()
	t.Setenv("BLAZE_HOME", dir)
	t.Cleanup(store.CloseDefault)
}
