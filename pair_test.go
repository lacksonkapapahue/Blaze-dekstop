package main

import (
	"bytes"
	"crypto/sha256"
	"crypto/tls"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"
)

func TestPairFlow(t *testing.T) {
	os.Setenv("BLAZE_HOME", t.TempDir())
	a := NewApp()
	a.pair = newPairHub(a)
	info := a.StartPairing()
	if info.Error != "" {
		t.Skip(info.Error)
	}
	u, _ := url.Parse(info.Link)
	q := u.Query()
	fp := q.Get("fp")
	cl := &http.Client{Timeout: 40 * time.Second, Transport: &http.Transport{TLSClientConfig: &tls.Config{InsecureSkipVerify: true,
		VerifyConnection: func(cs tls.ConnectionState) error {
			s := sha256.Sum256(cs.PeerCertificates[0].Raw)
			if hex.EncodeToString(s[:]) != fp {
				t.Fatal("fingerprint mismatch")
			}
			return nil
		}}}}
	base := "https://127.0.0.1:7377"
	// wrong code
	r, _ := cl.Post(base+"/v1/pair", "application/json", strings.NewReader(`{"code":"nope","name":"x"}`))
	if r.StatusCode != 403 {
		t.Fatal("wrong code accepted", r.StatusCode)
	}
	body, _ := json.Marshal(map[string]string{"code": q.Get("c"), "name": "Galaxy A12"})
	r, err := cl.Post(base+"/v1/pair", "application/json", bytes.NewReader(body))
	if err != nil || r.StatusCode != 200 {
		t.Fatal(err, r)
	}
	var pr map[string]string
	json.NewDecoder(r.Body).Decode(&pr)
	tok := pr["token"]
	// code is single-use
	r, _ = cl.Post(base+"/v1/pair", "application/json", bytes.NewReader(body))
	if r.StatusCode != 403 {
		t.Fatal("code reused")
	}
	get := func(path string) *http.Response {
		req, _ := http.NewRequest("GET", base+path, nil)
		req.Header.Set("Authorization", "Bearer "+tok)
		r, err := cl.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		return r
	}
	if get("/v1/ping").StatusCode != 200 {
		t.Fatal("ping")
	}
	// phone polls inbox; PC asks
	if s := a.pair.askPhone("x"); !strings.Contains(s, "isn't reachable") {
		t.Fatal("should be unreachable before any poll:", s)
	}
	get("/v1/inbox?wait=1") // registers the poll
	done := make(chan string)
	go func() {
		time.Sleep(300 * time.Millisecond)
		done <- a.pair.askPhone("what's my battery?")
	}()
	r = get("/v1/inbox?wait=5")
	var ib struct{ Requests []phoneReq }
	json.NewDecoder(r.Body).Decode(&ib)
	if len(ib.Requests) != 1 {
		t.Fatal("inbox", ib)
	}
	req, _ := http.NewRequest("POST", base+"/v1/inbox/"+ib.Requests[0].ID+"/reply", strings.NewReader(`{"text":"81%"}`))
	req.Header.Set("Authorization", "Bearer "+tok)
	cl.Do(req)
	if ans := <-done; ans != "The phone answered: 81%" {
		t.Fatal(ans)
	}
	a.Unpair(a.PairStatus().Devices[0].ID)
	if get("/v1/ping").StatusCode != 401 {
		t.Fatal("unpaired token still works")
	}
	a.pair.close()
}
