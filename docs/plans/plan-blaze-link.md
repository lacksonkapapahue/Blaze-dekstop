# Blaze Link: the PC side of phone pairing (v0.14.0)

Blaze for Android (`app/src/main/java/com/blaze/assistant/link/DesktopLink.kt` in lacksonkapapahue/Blaze-agent)
already ships the phone side. This release adds the PC side to Blaze Desktop: `pair.go`, ported from closed PR #3
(branch `feature/phone-pairing`) onto the current app. Nothing in the wire protocol changed, so phones running
today's Blaze Android pair as they are.

## Protocol (matches DesktopLink.kt)

Transport: HTTPS on TCP **7377** with a self-signed ECDSA P-256 certificate (`~/.blaze/pair/cert.pem`, `key.pem`,
20-year validity). The phone pins the leaf certificate's SHA-256 (DER, lowercase hex); host names are not checked.

**Pairing link / QR**: `blaze://pair?v=1&h=<IPv4 list, LAN first then Tailscale 100.64/10>&p=7377&fp=<64 hex>&c=<one-time code>&n=<PC host name>`.
The code is 24 hex chars, works once, lasts 5 minutes, and dies after 5 wrong tries.

| Method | Path | Body / query | Answer |
|---|---|---|---|
| POST | `/v1/pair` | `{"code","name"}` (no token) | `{"token","device_id","pc_name"}`; 403 `{"error"}` on a bad code |
| GET | `/v1/ping` | — | `{"pc_name","version","os"}` |
| POST | `/v1/task` | `{"text","fresh"}` | `{"id"}` — a Blaze turn runs on the PC, own history per phone |
| GET | `/v1/task/{id}` | `?seen=N&confirm=<id>&wait=≤30` (long-poll) | `{"status":"running|done|error","steps":[…],"text","confirm":{"id","title","detail"}|null}` |
| POST | `/v1/task/{id}/stop` | `{}` | `{"ok":true}` |
| POST | `/v1/confirm` | `{"task","id","yes"}` | `{"ok":true}` — approvals are asked on the phone |
| GET | `/v1/inbox` | `?wait=≤30` (long-poll) | `{"requests":[{"id","text"}]}` — PC → phone (`phone_ask`) |
| POST | `/v1/inbox/{id}/reply` | `{"text"}` | `{"ok":true}` |
| POST | `/v1/unpair` | `{}` | `{"ok":true}` |

Every call but `/v1/pair` sends `Authorization: Bearer <token>`; the PC stores only its SHA-256 in
`~/.blaze/pair/devices.json` (`[{"id","name","token_hash","paired_at"}]`) and answers 401 once a phone is unpaired.
A phone that polled `/v1/inbox` in the last 70 s counts as online.

## Desktop pieces
- `pair.go`: server (starts at launch only when a phone is paired, or when the user shows a QR code), tasks with
  approvals routed to the phone, `phone_ask` inbox, `PairStatus/StartPairing/StopPairing/Unpair` bindings.
- `internal/tools/phone.go`: `phone_ask` (Env.Phone); the system prompt names the paired phone.
- `frontend/dist/link.js` + `link.css`: the Phone view (`/views › Phone`, `/phone`, `open_view phone`).
- `selfknow_app.go`: `linkInBuild = true`; `about_blaze` gives the real steps and live status (devices.json + online phone).
- QR codes are drawn by `qrImage` (rsc.io/qr's `Image()` ignored its own scale; this also fixes the phone-preview QR).

## Tests
`pair_test.go`: full handshake as DesktopLink does it (link fields, pinned cert, wrong/one-time code, ping fields,
devices.json without the token, inbox + reply, online status, unpair → 401), approvals routed to the phone,
about_blaze link section and system prompt with a paired phone, phone_ask without a link, QR drawn at scale.
