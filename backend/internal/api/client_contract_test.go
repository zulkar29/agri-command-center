package api

import (
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"testing"
)

// The dashboard and the mobile app both call this API through their
// services/*.ts files. A path typo, a forgotten version prefix or a renamed
// route only shows up at run time, in a client, so this test reads those
// files and checks every call they make against the real route table. It needs
// no database; it skips when the client sources are not next to the backend
// (e.g. inside the backend-only docker build context).

var (
	// http.get<T>('/path') · http.post(`/tasks/${id}`, …) · http.delete(…)
	httpCall = regexp.MustCompile("http\\.(get|post|put|patch|delete)(?:<[^()]*>)?\\(\\s*[`'\"]([^`'\"]+)[`'\"]")
	// useList<T>('key', '/path', …) — a GET
	listCall = regexp.MustCompile("useList(?:<[^()]*>)?\\(\\s*'[^']*'\\s*,\\s*'([^']+)'")
	// sendOrQueue({ …, method: 'POST', path: '/tasks', … }) — the offline outbox
	queuedCall = regexp.MustCompile("method:\\s*'(POST|PATCH)',\\s*path:\\s*[`'\"]([^`'\"]+)[`'\"]")
	// apiFetch('/health', undefined, 10_000, '/api') — the one unversioned probe
	probeCall = regexp.MustCompile("apiFetch(?:<[^()]*>)?\\(\\s*'([^']+)'[^)]*'(/api)'\\s*\\)")

	interp = regexp.MustCompile(`\$\{[^}]*\}`)
	qsTail = regexp.MustCompile(`\$\{buildQS\(.*?\)\}|\?.*$`) // buildQS(...) may hold an object literal, braces and all
)

type clientCall struct{ method, path, where string }

// normalize turns a client path literal into a gin-style route path.
func normalize(prefix, p string) string {
	p = qsTail.ReplaceAllString(p, "")
	p = interp.ReplaceAllString(p, ":id")
	return prefix + p
}

func TestClientsOnlyCallRoutesThatExist(t *testing.T) {
	var files []string
	for _, dir := range []string{"../../../dashboard/src/services", "../../../mobile/src/services"} {
		got, _ := filepath.Glob(filepath.Join(dir, "*.ts"))
		files = append(files, got...)
	}
	if len(files) == 0 {
		t.Skip("client sources not found next to the backend")
	}

	var calls []clientCall
	for _, f := range files {
		b, err := os.ReadFile(f)
		if err != nil {
			t.Fatal(err)
		}
		src := string(b)
		where := filepath.Base(filepath.Dir(filepath.Dir(filepath.Dir(f)))) + "/" + filepath.Base(f)
		for _, m := range httpCall.FindAllStringSubmatch(src, -1) {
			calls = append(calls, clientCall{strings.ToUpper(m[1]), normalize(APIBase, m[2]), where})
		}
		for _, m := range listCall.FindAllStringSubmatch(src, -1) {
			calls = append(calls, clientCall{"GET", normalize(APIBase, m[1]), where})
		}
		for _, m := range queuedCall.FindAllStringSubmatch(src, -1) {
			calls = append(calls, clientCall{m[1], normalize(APIBase, m[2]), where})
		}
		for _, m := range probeCall.FindAllStringSubmatch(src, -1) {
			calls = append(calls, clientCall{"GET", normalize(m[2], m[1]), where})
		}
	}
	if len(calls) < 40 {
		t.Fatalf("found only %d client calls — the patterns above no longer match the clients' style", len(calls))
	}

	routes := map[string]bool{}
	for _, rt := range routerNoDB().Routes() {
		routes[rt.Method+" "+rt.Path] = true
	}
	var bad []string
	for _, c := range calls {
		if !routes[c.method+" "+c.path] {
			bad = append(bad, c.where+": "+c.method+" "+c.path)
		}
	}
	sort.Strings(bad)
	for _, b := range bad {
		t.Errorf("client calls a route the server does not have: %s", b)
	}
}

func TestNormalizeClientPaths(t *testing.T) {
	for in, want := range map[string]string{
		"/market-prices${buildQS({ limit: 30, ...params })}": APIBase + "/market-prices",
		"/farm":                              APIBase + "/farm",
		"/tasks/${t.id}":                     APIBase + "/tasks/:id",
		"/stock/${id}/usages":                APIBase + "/stock/:id/usages",
		"/harvests${buildQS(params)}":        APIBase + "/harvests",
		"/telemetry?hours=${hours}&x=1":      APIBase + "/telemetry",
		"/fields/${fieldId}/recommendations": APIBase + "/fields/:id/recommendations",
	} {
		if got := normalize(APIBase, in); got != want {
			t.Errorf("normalize(%q) = %q, want %q", in, got, want)
		}
	}
}
