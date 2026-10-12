# Quality backlog and release log

Short notes for the next agent: what shipped, what is known-broken, what to watch.

## Releases
- v0.12.0 — self-knowledge (PR #49, e586e3c). Release published with 6 assets (Oct 12 2026).
- v0.13.0 — long-chat engine (PR #48, merged eabc153).
- v0.14.0 — Blaze Link PC side (PR #50, merged 5b9f86d).
- v0.15.0 — student pack (branch student-pack).

## Known quirks
- `go vet .` at the repo root fails on Linux over hotkey.Mod1; vet ./internal/... instead.
- `git push -q` can falsely report failure; use plain `git push`.
- CI errors: read GET /repos/lacksonkapapahue/Blaze-dekstop/check-runs/{id}/annotations.
- frontend/dist is the source (vanilla JS); never gitignore it.
- PR #23 (signed-updates) is parked; leave it alone.
- ci/shots.py takes ~2 min for both themes; `SHOTS_THEMES=light` runs one (local sandboxes time out at 120 s).
- rsc.io/qr Code.Image() ignores Scale in At(); use qrImage (studio_app.go).
