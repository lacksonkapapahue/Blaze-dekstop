package main

// In-app updates from the project's GitHub releases.
//
// CI publishes every release as vX.Y.Z with one asset per platform. The app compares
// its own version (stamped at build time) with the latest release, and installs the
// asset that matches how it was installed: setup.exe or the portable exe on Windows,
// the .dmg on macOS, and the .deb, Arch package or tar.gz on Linux.
//
// The releases must be readable. While the repo is private, set a GitHub token in
// BLAZE_UPDATE_TOKEN (or GITHUB_TOKEN), or point updateRepo at a public repo.

import (
	"archive/tar"
	"compress/gzip"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"

	wr "github.com/wailsapp/wails/v2/pkg/runtime"
)

// updateRepo is owner/name on GitHub. Override at build time with
// -ldflags "-X main.updateRepo=owner/repo".
var updateRepo = "lacksonkapapahue/Blaze-dekstop"

type UpdateInfo struct {
	Current   string `json:"current"`
	Latest    string `json:"latest"`
	Available bool   `json:"available"`
	Skipped   bool   `json:"skipped"`  // the user chose to skip this version
	Notes     string `json:"notes"`    // release notes
	Page      string `json:"page"`     // release page on GitHub
	Asset     string `json:"asset"`    // file that will be installed
	Size      int64  `json:"size"`     // bytes
	Method    string `json:"method"`   // what Install will do, in words
	CanAuto   bool   `json:"can_auto"` // false: the user has to download it from Page
	Error     string `json:"error"`
}

type ghAsset struct {
	Name     string `json:"name"`
	APIURL   string `json:"url"`
	Download string `json:"browser_download_url"`
	Size     int64  `json:"size"`
}

type ghRelease struct {
	Tag     string    `json:"tag_name"`
	Body    string    `json:"body"`
	HTMLURL string    `json:"html_url"`
	Draft   bool      `json:"draft"`
	Pre     bool      `json:"prerelease"`
	Assets  []ghAsset `json:"assets"`
}

var (
	updMu      sync.Mutex
	updLast    *ghRelease
	installing bool
)

func updateToken() string {
	for _, k := range []string{"BLAZE_UPDATE_TOKEN", "GITHUB_TOKEN"} {
		if v := strings.TrimSpace(os.Getenv(k)); v != "" {
			return v
		}
	}
	return ""
}

func (a *App) updateToken() string {
	if t := updateToken(); t != "" {
		return t
	}
	if a.cfg != nil {
		return a.cfg.Key("github") // keychain entry "github" under blaze-cli, if the user saved one
	}
	return ""
}

// CheckUpdate asks GitHub for the latest release.
func (a *App) CheckUpdate() UpdateInfo {
	a.waitReady()
	info := UpdateInfo{Current: version}
	req, _ := http.NewRequest("GET", "https://api.github.com/repos/"+updateRepo+"/releases/latest", nil)
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("User-Agent", "Blaze-Desktop/"+version)
	if t := a.updateToken(); t != "" {
		req.Header.Set("Authorization", "Bearer "+t)
	}
	res, err := (&http.Client{Timeout: 20 * time.Second}).Do(req)
	if err != nil {
		info.Error = "Couldn't reach GitHub. Check your connection."
		return info
	}
	defer res.Body.Close()
	switch {
	case res.StatusCode == 404:
		info.Error = "No public release found. The releases repo is private, so updates need a token (BLAZE_UPDATE_TOKEN)."
		return info
	case res.StatusCode == 403 || res.StatusCode == 429:
		info.Error = "GitHub is rate-limiting update checks. Try again in a while."
		return info
	case res.StatusCode != 200:
		info.Error = fmt.Sprintf("GitHub answered %d.", res.StatusCode)
		return info
	}
	var rel ghRelease
	if err := json.NewDecoder(res.Body).Decode(&rel); err != nil {
		info.Error = "GitHub sent something unexpected."
		return info
	}
	updMu.Lock()
	updLast = &rel
	updMu.Unlock()

	info.Latest, info.Notes, info.Page = rel.Tag, strings.TrimSpace(rel.Body), rel.HTMLURL
	info.Available = newer(rel.Tag, version)
	info.Skipped = info.Available && a.prefs.SkipUpdate == rel.Tag
	if as, method, ok := pickAsset(rel.Assets); ok {
		info.Asset, info.Size, info.Method, info.CanAuto = as.Name, as.Size, method, true
	} else {
		info.Method = "Download it from the release page."
	}
	if version == "dev" {
		info.Available, info.CanAuto = false, false
		info.Error = "This is a development build, so it doesn't update itself."
	}
	return info
}

// SetUpdateCheck turns the check on launch on or off.
func (a *App) SetUpdateCheck(on bool) { a.prefs.NoUpdateCheck = !on; a.savePrefs() }

// SkipUpdate hides the update card for this version until a newer one comes out.
func (a *App) SkipUpdate(tag string) { a.prefs.SkipUpdate = tag; a.savePrefs() }

// InstallUpdate downloads the latest release and installs it, then restarts Blaze.
// Progress goes to the UI as "update" events: {stage, pct, text}.
// It returns "" when Blaze is about to restart, or a message saying what went wrong.
func (a *App) InstallUpdate() string {
	a.waitReady()
	updMu.Lock()
	if installing {
		updMu.Unlock()
		return "An update is already installing."
	}
	installing = true
	rel := updLast
	updMu.Unlock()
	defer func() { updMu.Lock(); installing = false; updMu.Unlock() }()

	if rel == nil {
		if i := a.CheckUpdate(); i.Error != "" {
			return i.Error
		}
		updMu.Lock()
		rel = updLast
		updMu.Unlock()
	}
	if rel == nil || !newer(rel.Tag, version) {
		return "You're already on the latest version."
	}
	as, _, ok := pickAsset(rel.Assets)
	if !ok {
		return "There's no download for this computer in " + rel.Tag + ". Get it from the release page."
	}
	file, err := a.download(as)
	if err != nil {
		a.progress("error", 0, err.Error())
		return err.Error()
	}
	a.progress("install", 100, "Installing "+rel.Tag+"…")
	restart, err := installFile(file)
	if err != nil {
		a.progress("error", 0, err.Error())
		return err.Error()
	}
	a.progress("restart", 100, "Restarting Blaze…")
	go func() {
		time.Sleep(600 * time.Millisecond)
		if restart != nil {
			_ = restart()
		}
		a.quit()
	}()
	return ""
}

func (a *App) progress(stage string, pct int, text string) {
	if a.ctx != nil {
		wr.EventsEmit(a.ctx, "update", map[string]any{"stage": stage, "pct": pct, "text": text})
	}
}

func (a *App) download(as ghAsset) (string, error) {
	dir := filepath.Join(os.TempDir(), "blaze-update")
	_ = os.MkdirAll(dir, 0o755)
	dst := filepath.Join(dir, filepath.Base(as.Name))

	url := as.Download
	tok := a.updateToken()
	if tok != "" {
		url = as.APIURL // private repos only serve assets through the API
	}
	req, _ := http.NewRequest("GET", url, nil)
	req.Header.Set("Accept", "application/octet-stream")
	req.Header.Set("User-Agent", "Blaze-Desktop/"+version)
	if tok != "" {
		req.Header.Set("Authorization", "Bearer "+tok)
	}
	res, err := (&http.Client{Timeout: 30 * time.Minute}).Do(req)
	if err != nil {
		return "", errors.New("The download failed. Check your connection and try again.")
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		return "", fmt.Errorf("The download failed (GitHub answered %d).", res.StatusCode)
	}
	f, err := os.Create(dst + ".part")
	if err != nil {
		return "", errors.New("Couldn't save the download: " + err.Error())
	}
	total := as.Size
	if total <= 0 {
		total = res.ContentLength
	}
	var done int64
	last := -1
	buf := make([]byte, 64*1024)
	for {
		n, rerr := res.Body.Read(buf)
		if n > 0 {
			if _, werr := f.Write(buf[:n]); werr != nil {
				f.Close()
				return "", errors.New("Couldn't save the download: " + werr.Error())
			}
			done += int64(n)
			if total > 0 {
				if pct := int(done * 100 / total); pct != last {
					last = pct
					a.progress("download", pct, fmt.Sprintf("Downloading… %d%% of %.1f MB", pct, float64(total)/1e6))
				}
			}
		}
		if rerr == io.EOF {
			break
		}
		if rerr != nil {
			f.Close()
			return "", errors.New("The download was interrupted. Try again.")
		}
	}
	f.Close()
	if as.Size > 0 && done != as.Size {
		return "", errors.New("The download was incomplete. Try again.")
	}
	_ = os.Remove(dst)
	if err := os.Rename(dst+".part", dst); err != nil {
		return "", err
	}
	return dst, nil
}

// ---------------- choosing and installing the right file ----------------

func selfPath() string {
	p, err := os.Executable()
	if err != nil {
		return ""
	}
	if r, err := filepath.EvalSymlinks(p); err == nil {
		p = r
	}
	return p
}

// installKind says how this copy of Blaze was installed.
func installKind() string {
	exe := selfPath()
	switch runtime.GOOS {
	case "windows":
		dir := filepath.Dir(exe)
		if _, err := os.Stat(filepath.Join(dir, "uninstall.exe")); err == nil {
			return "setup"
		}
		if pf := os.Getenv("ProgramFiles"); pf != "" && strings.HasPrefix(strings.ToLower(exe), strings.ToLower(pf)) {
			return "setup"
		}
		return "portable"
	case "darwin":
		return "dmg"
	default:
		if strings.HasPrefix(exe, "/usr/") {
			if _, err := exec.LookPath("pacman"); err == nil {
				return "arch"
			}
			if _, err := exec.LookPath("dpkg"); err == nil {
				return "deb"
			}
		}
		return "tarball"
	}
}

func pickAsset(assets []ghAsset) (ghAsset, string, bool) {
	if runtime.GOOS != "darwin" && runtime.GOARCH != "amd64" {
		return ghAsset{}, "", false // releases are amd64-only for Windows and Linux
	}
	var want func(string) bool
	var method string
	switch installKind() {
	case "setup":
		want = func(n string) bool { return strings.HasSuffix(n, "-windows-amd64-setup.exe") }
		method = "Runs the new installer, then reopens Blaze."
	case "portable":
		want = func(n string) bool { return strings.HasSuffix(n, "-windows-amd64-portable.exe") }
		method = "Replaces this Blaze.exe, then reopens Blaze."
	case "dmg":
		want = func(n string) bool { return strings.HasSuffix(n, "-macos-universal.dmg") }
		method = "Replaces Blaze.app, then reopens Blaze."
	case "arch":
		want = func(n string) bool { return strings.HasSuffix(n, ".pkg.tar.zst") }
		method = "Installs the Arch package with pacman (asks for your password), then reopens Blaze."
	case "deb":
		want = func(n string) bool { return strings.HasSuffix(n, "_amd64.deb") }
		method = "Installs the .deb with apt (asks for your password), then reopens Blaze."
	default:
		want = func(n string) bool { return strings.HasSuffix(n, "-linux-amd64.tar.gz") }
		method = "Replaces this blaze-desktop binary, then reopens Blaze."
	}
	for _, as := range assets {
		if want(as.Name) {
			return as, method, true
		}
	}
	return ghAsset{}, "", false
}

// installFile puts the downloaded file in place and returns how to start the new copy.
func installFile(file string) (func() error, error) {
	exe := selfPath()
	switch kind := installKind(); kind {
	case "setup":
		// The running exe can't be overwritten, so a hidden helper waits for Blaze to
		// quit, runs the installer silently and starts the new Blaze.
		script := fmt.Sprintf(`ping -n 3 127.0.0.1 >nul & "%s" /S & start "" "%s" --relaunch`, file, exe)
		return func() error { return detached("cmd", "/C", script).Start() }, nil

	case "portable":
		// Windows lets a running exe be renamed, just not overwritten.
		old := exe + ".old"
		_ = os.Remove(old)
		if err := os.Rename(exe, old); err != nil {
			return nil, errors.New("Couldn't replace Blaze.exe: " + err.Error())
		}
		if err := copyFile(file, exe, 0o755); err != nil {
			_ = os.Rename(old, exe)
			return nil, errors.New("Couldn't write the new Blaze.exe: " + err.Error())
		}
		return func() error { return detached(exe, "--relaunch").Start() }, nil

	case "dmg":
		return installDMG(file, exe)

	case "arch", "deb":
		var args []string
		if kind == "arch" {
			args = []string{"pacman", "-U", "--noconfirm", file}
		} else {
			args = []string{"apt-get", "install", "-y", "--allow-downgrades", file}
		}
		if _, err := exec.LookPath("pkexec"); err != nil {
			return nil, errors.New("Couldn't ask for admin rights (pkexec is missing). Install " + filepath.Base(file) + " from " + filepath.Dir(file) + " yourself.")
		}
		out, err := exec.Command("pkexec", args...).CombinedOutput()
		if err != nil {
			if ee, ok := err.(*exec.ExitError); ok && (ee.ExitCode() == 126 || ee.ExitCode() == 127) {
				return nil, errors.New("The update was cancelled at the password prompt.")
			}
			return nil, errors.New("The package install failed: " + lastLine(string(out)))
		}
		return relaunchUnix(exe), nil

	default: // tarball
		if err := replaceFromTarball(file, exe); err != nil {
			return nil, err
		}
		return relaunchUnix(exe), nil
	}
}

func installDMG(dmg, exe string) (func() error, error) {
	// exe is …/Blaze.app/Contents/MacOS/Blaze
	app := filepath.Dir(filepath.Dir(filepath.Dir(exe)))
	if !strings.HasSuffix(app, ".app") {
		return nil, errors.New("Couldn't find Blaze.app. Open the downloaded .dmg in " + filepath.Dir(dmg) + " and drag Blaze to Applications.")
	}
	mnt, err := os.MkdirTemp("", "blaze-dmg")
	if err != nil {
		return nil, err
	}
	if out, err := exec.Command("hdiutil", "attach", "-nobrowse", "-readonly", "-mountpoint", mnt, dmg).CombinedOutput(); err != nil {
		return nil, errors.New("Couldn't open the .dmg: " + lastLine(string(out)))
	}
	defer exec.Command("hdiutil", "detach", "-quiet", mnt).Run()

	src := filepath.Join(mnt, "Blaze.app")
	next, old := app+".new", app+".old"
	_ = os.RemoveAll(next)
	_ = os.RemoveAll(old)
	if out, err := exec.Command("ditto", src, next).CombinedOutput(); err != nil {
		_ = exec.Command("open", dmg).Start()
		return nil, errors.New("Couldn't copy the new Blaze.app (" + lastLine(string(out)) + "). The .dmg is open: drag Blaze to Applications.")
	}
	_ = exec.Command("xattr", "-dr", "com.apple.quarantine", next).Run()
	if err := os.Rename(app, old); err != nil {
		_ = os.RemoveAll(next)
		return nil, errors.New("Couldn't replace Blaze.app: " + err.Error())
	}
	if err := os.Rename(next, app); err != nil {
		_ = os.Rename(old, app)
		return nil, errors.New("Couldn't replace Blaze.app: " + err.Error())
	}
	_ = os.RemoveAll(old)
	return func() error { return detached("sh", "-c", `sleep 1; open -n "$0" --args --relaunch`, app).Start() }, nil
}

func replaceFromTarball(tgz, exe string) error {
	f, err := os.Open(tgz)
	if err != nil {
		return err
	}
	defer f.Close()
	gz, err := gzip.NewReader(f)
	if err != nil {
		return errors.New("The download is damaged. Try again.")
	}
	tr := tar.NewReader(gz)
	next := exe + ".new"
	for {
		h, err := tr.Next()
		if err == io.EOF {
			return errors.New("The download has no blaze-desktop binary.")
		}
		if err != nil {
			return errors.New("The download is damaged. Try again.")
		}
		if filepath.Base(h.Name) != "blaze-desktop" {
			continue
		}
		out, err := os.OpenFile(next, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o755)
		if err != nil {
			return errors.New("Couldn't write next to " + exe + ": " + err.Error())
		}
		if _, err := io.Copy(out, tr); err != nil {
			out.Close()
			_ = os.Remove(next)
			return err
		}
		out.Close()
		break
	}
	// Renaming over a running binary is fine on Linux and macOS.
	if err := os.Rename(next, exe); err != nil {
		_ = os.Remove(next)
		return errors.New("Couldn't replace " + exe + ": " + err.Error())
	}
	return nil
}

func relaunchUnix(exe string) func() error {
	return func() error { return detached("sh", "-c", `sleep 1; exec "$0" --relaunch`, exe).Start() }
}

// cleanupOldBinary removes what a portable Windows update left behind.
func cleanupOldBinary() {
	if exe := selfPath(); exe != "" {
		_ = os.Remove(exe + ".old")
	}
}

func copyFile(src, dst string, mode os.FileMode) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.OpenFile(dst, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, mode)
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, in); err != nil {
		out.Close()
		return err
	}
	return out.Close()
}

func lastLine(s string) string {
	lines := strings.Split(strings.TrimSpace(s), "\n")
	return strings.TrimSpace(lines[len(lines)-1])
}

// newer reports whether tag a (v1.2.3) is a higher version than b.
func newer(a, b string) bool {
	pa, okA := parseVer(a)
	pb, okB := parseVer(b)
	if !okA {
		return false
	}
	if !okB {
		return false // dev builds never update
	}
	for i := 0; i < 3; i++ {
		if pa[i] != pb[i] {
			return pa[i] > pb[i]
		}
	}
	return false
}

func parseVer(s string) ([3]int, bool) {
	var v [3]int
	s = strings.TrimPrefix(strings.TrimSpace(s), "v")
	if i := strings.IndexAny(s, "-+"); i >= 0 {
		s = s[:i]
	}
	parts := strings.Split(s, ".")
	if len(parts) == 0 || len(parts) > 3 {
		return v, false
	}
	for i, p := range parts {
		n, err := strconv.Atoi(p)
		if err != nil {
			return v, false
		}
		v[i] = n
	}
	return v, true
}
