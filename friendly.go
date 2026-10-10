package main

import (
	"encoding/json"
	"net/url"
	"path/filepath"
	"regexp"
	"strings"
	"unicode/utf8"
)

var installRe = regexp.MustCompile(`(?i)\b(npm|pnpm|yarn|bun) (i|install|add)\b|\bpip3? install\b|\b(apt|apt-get|dnf|yum|pacman|brew|winget|choco|scoop|cargo|go) (install|-S|get)\b`)

// friendlyTool says what a tool call is doing in plain English (the tray status line;
// app.js has the same phrases for the chat's status line).
func friendlyTool(name, rawArgs string) string {
	var a map[string]any
	_ = json.Unmarshal([]byte(rawArgs), &a)
	v := func(k string) string {
		s, _ := a[k].(string)
		return strings.TrimSpace(strings.SplitN(s, "\n", 2)[0])
	}
	file := func() string {
		p := v("path")
		if p == "" {
			return "a file"
		}
		return filepath.Base(filepath.FromSlash(p))
	}
	var s string
	switch name {
	case "file_read":
		s = "Reading " + file()
	case "file_edit":
		s = "Editing " + file()
	case "file_write":
		s = "Writing " + file()
	case "file_delete":
		s = "Deleting " + file()
	case "file_list":
		s = "Looking through your files"
	case "file_search":
		s = `Searching your files for "` + orStr(v("pattern"), v("query")) + `"`
	case "web_search":
		s = `Searching the web for "` + v("query") + `"`
	case "fetch_page":
		s = "Reading " + orStr(hostOf(v("url")), "a web page")
	case "run_shell":
		s = "Running a command"
		if installRe.MatchString(v("command")) {
			s = "Installing packages"
		}
	case "git":
		s = "Checking the project history"
	case "run_code":
		s = "Running " + orStr(v("language"), "some") + " code"
	case "install_tool":
		s = "Installing " + orStr(v("name"), "a tool")
	case "remember":
		s = "Saving that to memory"
	case "schedule":
		s = "Setting up a schedule"
	case "use_skill":
		s = "Following a saved skill"
	case "system_info":
		s = "Checking your computer"
	case "forget":
		s = "Updating memory"
	case "write_skill":
		s = "Saving a skill"
	case "http_request":
		s = "Calling " + orStr(hostOf(v("url")), "a web service")
	case "download_file":
		s = "Downloading " + orStr(hostOf(v("url")), "a file")
	case "open_url":
		s = "Opening " + orStr(hostOf(orStr(v("target"), v("url"))), "a page")
	case "job_log", "job_input":
		s = "Checking a background job"
	case "job_stop":
		s = "Stopping a background job"
	default:
		s = "Working on it"
	}
	if utf8.RuneCountInString(s) > 60 {
		r := []rune(s)
		s = string(r[:59]) + "…"
	}
	return s
}

func hostOf(s string) string {
	if u, err := url.Parse(s); err == nil && u.Host != "" {
		return strings.TrimPrefix(u.Host, "www.")
	}
	return s
}
