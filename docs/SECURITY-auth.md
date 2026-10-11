# Security: Blaze sign-in and one-click connectors (`blaze-auth`)

This describes the `blaze-auth` Cloudflare Worker (`cloud/`, live at
`https://blaze-auth.blaze-app.workers.dev`) and the desktop code that talks to it
(`internal/cloud/cloud.go`, `account.go`, `internal/connect/`). Everything here is taken
from the code in this repo; file references are given so it can be checked.

## What it is

The Worker does two jobs:

1. **One-click connectors** (Google, GitHub, Spotify, Notion, Slack). It holds each
   provider's OAuth client secret (Worker secrets `<NAME>_CLIENT_ID` /
   `<NAME>_CLIENT_SECRET`, never in the repo or the desktop binary), swaps the provider's
   authorization code for tokens, and hands the tokens to the desktop once.
2. **Blaze accounts**: email + password, or "Sign in with Google / GitHub".

Storage is one Workers KV namespace (`KV` in `cloud/wrangler.toml`). There is no other
database.

## The flow, and the checks on it

1. The desktop listens on `http://127.0.0.1:<random port>/cb`, makes a random `state`
   (24 bytes) and a PKCE verifier (32 bytes) with its S256 challenge, and opens the
   browser at `/oauth/<provider>/start` (or `/v1/auth/<provider>/start` for sign-in)
   (`internal/cloud/cloud.go`, `authorize`).
2. `start` (`cloud/src/index.ts`) refuses the request unless:
   - `state` matches `^[A-Za-z0-9_-]{16,128}$`;
   - `code_challenge` is 43 base64url chars and the method is `S256` (plain is refused);
   - `redirect` is `http://127.0.0.1:<1024-65535>/…` or `http://[::1]:<port>/…` with no
     user info, query or fragment (`loopbackRedirect` in `cloud/src/util.ts`). `localhost`
     and every non-loopback host are refused;
   - every requested scope is on that provider's allow-list (`cloud/src/providers.ts`).
   It then stores a state record under a fresh Worker-side state (24 random bytes) and
   redirects to the provider.
3. The provider returns to `/oauth/<provider>/callback`. The Worker looks up the state
   record (must exist, match the provider and be unexpired), **deletes it (single use)**,
   and exchanges the code with the client secret.
4. The Worker stores the result under `oauthcode:<sha256(K)>` for a new random one-time
   code `K` (32 bytes) and redirects the browser to the loopback with `code=K` and the
   desktop's own `state`. Tokens never appear in that URL.
5. The desktop checks `state` matches what it started with, then `POST /oauth/redeem`
   with `K` and the PKCE verifier. The Worker checks `sha256(verifier)` against the stored
   challenge with a constant-time compare, **deletes the code record**, and returns the
   tokens (connect) or a new Blaze session (sign-in).

## What the Worker receives

| Endpoint | Receives |
| --- | --- |
| every request | the caller's IP (`CF-Connecting-IP`), used for rate limiting |
| `POST /v1/auth/signup` | email, password, optional name, client label |
| `POST /v1/auth/login` | email, password, client label |
| `GET /oauth/<p>/start`, `GET /v1/auth/<p>/start` | desktop `state`, PKCE challenge, loopback redirect URL, requested scopes |
| `GET /oauth/<p>/callback` | the provider's authorization code (or error) and the Worker's state |
| from the provider (server side) | access token, refresh token, token type, granted scopes, expiry; Slack team name; Notion workspace name |
| sign-in only (server side) | Google: `sub`, email, `email_verified`, name, picture (`openidconnect.googleapis.com/v1/userinfo`). GitHub: user id, login, name, avatar URL, and verified emails (`api.github.com/user`, `/user/emails`) |
| `POST /oauth/redeem` | one-time code, PKCE verifier, client label |
| `POST /oauth/<p>/refresh` | a provider refresh token (passed to the provider; the response is returned, nothing is stored) |
| `GET /v1/me`, `POST /v1/logout`, `POST /v1/account/delete` | the Blaze session token (`Authorization: Bearer bz_…`) |

Passwords are hashed with PBKDF2-SHA256 (100,000 iterations by default, 16-byte random
salt) and only the hash is kept. For sign-in with Google/GitHub, the provider access token
is used once to read the profile and is then dropped; it is not stored.

## What it stores in KV

| Key | Value | TTL |
| --- | --- | --- |
| `user:<id>` | email, name, avatar URL, PBKDF2 password hash (if any), `email_verified`, linked identities (provider, subject, email), session hashes (max 20), created/updated times | none (until account deletion) |
| `email:<lower-case email>` | user id | none |
| `ident:<provider>:<subject>` | user id | none |
| `sess:<sha256(session token)>` | user id, created, expiry, client label | 90 days |
| `oauthstate:<worker state>` | flow (login/connect), provider, loopback redirect, desktop state, PKCE challenge, scopes, expiry | 10 minutes; deleted on first callback |
| `oauthcode:<sha256(one-time code)>` | **connect:** the provider tokens (access + refresh, plaintext) and scopes. **sign-in:** the user id. Plus provider, PKCE challenge, expiry | **2 minutes** (5 before Worker 0.5.1); deleted on a successful redeem |
| `rl:signup:<ip>` | count of sign-ups refused as `email_taken` from that IP | 1 hour window |
| `rl:login:ip:<ip>`, `rl:login:email:<sha256(email)>` | count of failed sign-ins | 15 minute window |

Session tokens and one-time codes are stored only as SHA-256 hashes. Provider tokens exist
in KV only inside an `oauthcode:` record, for the redeem window. The Worker also keeps a
per-isolate, in-memory rate-limit map keyed by IP; it is not persisted.

## What it logs

The Worker has exactly two log calls (`cloud/src/index.ts`):

- `console.error("unhandled", e)`: any exception in a route that is not one of the Worker's
  own `HttpError`s.
- `console.error("callback", e)`: any such exception while the callback exchanges the code,
  reads the profile or links the account.

No code path passes a password, client secret, token, authorization code, one-time code,
verifier or session token to either call. Provider and network failures during the token
exchange are turned into `HttpError`s and are not logged. What can reach these logs is an
exception from KV, `fetch`, crypto or JSON parsing; a JSON parse failure on a profile
response may quote part of that response in its message (profile fields, not tokens).

`cloud/wrangler.toml` has no `[observability]` block, so this config does not turn on
persisted Workers Logs. Cloudflare's live log stream (`wrangler tail` / dashboard) shows
each request's URL: the `start` URL (desktop state, PKCE challenge, loopback port,
scopes) and the `callback` URL (the provider's authorization code and the Worker state).
By the time anyone could read it, that provider code has been exchanged and is single-use.

## What it never sees

- Your model API keys, MCP server tokens, or anything else in your keychain.
- The data your connectors read or write (mail, calendar, files, repos, playlists, pages,
  messages). After redeem, the desktop calls provider APIs directly with its tokens; the
  only desktop code that talks to the Worker is `internal/cloud/cloud.go`.
- Your Google/GitHub/Spotify/Notion/Slack password. You type it on the provider's page.
- Connectors set up with your own developer app ("Use your own key/developer app" under
  *Advanced*): that OAuth runs on the desktop and never touches the Worker.
- Access tokens after the redeem, except that refresh tokens pass through it on each
  `POST /oauth/<p>/refresh` (not stored).

## Where your tokens end up

On your computer, in the OS keychain (Windows Credential Manager, macOS Keychain, Linux
Secret Service) through `github.com/zalando/go-keyring`, under service `blaze-cli`
(`internal/connect/store.go`, `account.go`):

- connector tokens: key `connector:<provider>` (JSON: access, refresh, type, scope, expiry);
- Blaze session token: key `blaze-account:session`.

If the keychain can't be written, saving fails with an error; these tokens have no
plain-file fallback. Non-secret state is in files readable only by you (mode `0600`):
`~/.blaze/desktop/connectors.json` (enabled flags, granted scopes, account label, per-tool
approval) and `~/.blaze/desktop/account.json` (your Blaze profile: id, email, name, avatar).

## How to revoke access

**A connector, from Blaze:** **Disconnect** on the connector's page deletes the tokens from the
keychain. For Google, Blaze also calls `https://oauth2.googleapis.com/revoke` (best effort).
For the others, also revoke at the provider:

- Google: <https://myaccount.google.com/permissions>
- GitHub: <https://github.com/settings/applications> (Authorized OAuth Apps)
- Spotify: <https://www.spotify.com/account/apps/>
- Notion: Settings › Connections in Notion
- Slack: your workspace's app management page

**Your Blaze account:** Sign out calls `POST /v1/logout`, which deletes that session from
KV, and removes it from the keychain. Delete account (`POST /v1/account/delete`) deletes
the user record, the email and identity links, and every session. Connector tokens and
keys on your computer stay until you disconnect them.

**For the operator (all users at once):** `wrangler secret delete <NAME>_CLIENT_SECRET`
switches a provider off (`503 not_configured`); rotating the client secret at the
provider's console and `wrangler secret put` stops refreshes with the old one.

## Known risks (not changed)

- **`/oauth/<p>/refresh` is unauthenticated.** It adds Blaze's client secret to any refresh
  token it's given, so a leaked Blaze-issued refresh token can be turned into access tokens
  through the Worker without knowing the secret. Requiring a Blaze session here would break
  one-click connectors for people without a Blaze account, so it is left as is.
- **Provider tokens sit in KV in plaintext for the redeem window** (now at most 2 minutes,
  deleted as soon as they're redeemed). Anyone with read access to this KV namespace on the
  Cloudflare account could read them in that window. Encrypting the record with a key
  derived from the one-time code would close this.
- **KV is eventually consistent.** Single-use deletes of `oauthstate:` / `oauthcode:` can take
  time to reach other Cloudflare locations. A replay elsewhere still needs a fresh,
  unused provider code (callback) or the PKCE verifier (redeem).
- **The Worker tests (`cloud/test/`) are not run in CI.** Run `npm test` in `cloud/`
  before deploying.

## Checked and fine

- State: random Worker state, single use, 10-minute expiry, bound to the provider; the
  desktop rejects a loopback hit whose `state` isn't its own.
- PKCE: S256 only, verifier checked in constant time before tokens are released.
- Redirects: loopback only (`127.0.0.1` / `[::1]`, port ≥ 1024).
- CORS: no wildcard. Only origins listed in `ALLOWED_ORIGINS` (empty in `wrangler.toml`)
  get CORS headers; a browser request with any other `Origin` can't POST (403).
- Responses carry `Cache-Control: no-store`, `nosniff`, `Referrer-Policy: no-referrer`,
  `X-Frame-Options: DENY`; the HTML error page has a `default-src 'none'` CSP and escapes
  its text.

## Changelog

- **2026-10-11, Worker 0.5.1:** the one-time code record (which holds the provider tokens for
  connects) now expires after 2 minutes instead of 5 (`CODE_TTL` in `cloud/src/index.ts`);
  a test checks it. **Needs a redeploy:** run `npx wrangler deploy` in `cloud/`. Until then the
  live Worker (`/health` reports `0.5.0`) keeps the 5-minute window. After deploying,
  `GET /health` should report `"version":"0.5.1"`. Nothing in the desktop app depends on it.
