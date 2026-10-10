//go:build linux

package main

import "testing"

func TestBottomRight(t *testing.T) {
	x, y := bottomRight(0, 0, 1920, 1080, []int{0, 30, 0, 0}, 400, 560)
	if x != 1920-400-24 || y != 1080-560-24 {
		t.Fatalf("got %d,%d", x, y)
	}
	x, y = bottomRight(1920, 0, 1280, 720, []int{0, 0, 0, 40}, 400, 560)
	if x != 1920+1280-424 || y != 720-560-24-40 {
		t.Fatalf("second monitor: got %d,%d", x, y)
	}
}
