package bangla

import "testing"

func TestNum(t *testing.T) {
	for in, want := range map[any]string{0: "০", 2026: "২০২৬", 12.5: "১২.৫", "a1": "a১"} {
		if got := Num(in); got != want {
			t.Errorf("Num(%v) = %q, want %q", in, got, want)
		}
	}
}
