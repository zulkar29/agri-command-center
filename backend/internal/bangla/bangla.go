// Package bangla renders numbers with Bengali digits for the server-written
// text (log lines, alert details), matching the clients' bn() helper.
package bangla

import "fmt"

var digits = []rune("০১২৩৪৫৬৭৮৯")

// Num formats any value with fmt's %v and converts its ASCII digits.
func Num(v any) string {
	out := []rune(fmt.Sprintf("%v", v))
	for i, r := range out {
		if r >= '0' && r <= '9' {
			out[i] = digits[r-'0']
		}
	}
	return string(out)
}
