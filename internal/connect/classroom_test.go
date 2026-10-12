package connect

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"
)

func TestClassroomTools(t *testing.T) {
	due := time.Now().UTC().AddDate(0, 0, 5)
	api := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/v1/courses":
			if r.URL.Query().Get("studentId") != "me" {
				w.WriteHeader(400)
				return
			}
			io.WriteString(w, `{"courses":[{"id":"c1","name":"NET103","section":"S2","alternateLink":"https://classroom.google.com/c/c1"}]}`)
		case r.URL.Path == "/v1/courses/c1/courseWork":
			io.WriteString(w, `{"courseWork":[
			 {"id":"w1","title":"Subnetting lab","maxPoints":20,"dueDate":{"year":`+strconv.Itoa(due.Year())+`,"month":`+strconv.Itoa(int(due.Month()))+`,"day":`+strconv.Itoa(due.Day())+`},"dueTime":{"hours":21,"minutes":59}},
			 {"id":"w0","title":"Old quiz","dueDate":{"year":2020,"month":1,"day":1}},
			 {"id":"w2","title":"Reading, no due date"}]}`)
		case r.URL.Path == "/v1/courses/c1/courseWork/-/studentSubmissions":
			io.WriteString(w, `{"studentSubmissions":[{"courseWorkId":"w1","state":"TURNED_IN"}]}`)
		default:
			w.WriteHeader(404)
		}
	}))
	defer api.Close()
	old := classroomAPI
	classroomAPI = api.URL + "/v1"
	defer func() { classroomAPI = old }()

	rec := &recorder{}
	m := NewWith(t.TempDir(), &MemSecrets{}, rec.host(), Catalog, BuiltinTools())
	// Classroom scopes are on demand: a plain Google sign-in doesn't ask for them.
	for _, s := range m.wantScopes(byID("google"), ConnState{}, nil) {
		if strings.Contains(s, "classroom") {
			t.Fatal("first sign-in should not ask for Classroom:", s)
		}
	}
	_ = m.Store().SetToken("google", &Token{AccessToken: "x"})
	_ = m.Store().Update("google", func(s *ConnState) { s.Connected = true; s.Scopes = []string{gScope + "gmail.readonly"} })
	if out := m.Run(context.Background(), "classroom_courses", `{}`); !strings.Contains(out, "permission") || !rec.has("connector_consent") {
		t.Fatalf("missing scope should ask for consent: %q", out)
	}
	_ = m.Store().Update("google", func(s *ConnState) { s.Scopes = append(s.Scopes, scopeCourses, scopeCoursework) })
	if out := m.Run(context.Background(), "classroom_courses", `{}`); !strings.Contains(out, "NET103 · S2 [c1]") {
		t.Fatal(out)
	}
	out := m.Run(context.Background(), "classroom_coursework", `{}`)
	if !strings.Contains(out, "Subnetting lab") || !strings.Contains(out, "20 pts") || !strings.Contains(out, "turned in") || strings.Contains(out, "Old quiz") || strings.Contains(out, "no due date") {
		t.Fatal(out)
	}
	if out := m.Run(context.Background(), "classroom_coursework", `{"course_id":"c1","include_past":true,"days":10}`); !strings.Contains(out, "Old quiz") {
		t.Fatal("include_past:", out)
	}
}
