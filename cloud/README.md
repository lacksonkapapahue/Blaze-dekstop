# blaze-auth

Blaze accounts and the one-click OAuth connector broker for Blaze Desktop, on
Cloudflare's **free** tier: one Worker and one KV namespace. No D1, no paid add-ons.

- Live: `https://blaze-auth.blaze-app.workers.dev` (`GET /health` → `{"ok":true}`)
- Account: `ef895b6795ee39066c863c39a42ec8b6`, KV namespace `KV` = `03a2047f64234d28946816100f97e46a`

Provider client secrets live only as Worker secrets. The desktop binary and this
repo hold no secrets, and the Worker never stores provider access tokens: they sit
under a one-time code in KV for at most 2 minutes until the desktop redeems them
(5 minutes before Worker 0.5.1). Full write-up: [`../docs/SECURITY-auth.md`](../docs/SECURITY-auth.md).

## How a one-click Connect works

```
Blaze Desktop                       blaze-auth Worker                    Provider
-------------                       -----------------                    --------
listen on 127.0.0.1:<random>/cb
PKCE verifier + S256 challenge
open browser ─ GET /oauth/google/start?state=S&code_challenge=C
                    &redirect=http://127.0.0.1:PORT/cb&scope=...
                                    validate (loopback only, allowed scopes)
                                    KV oauthstate:<X> {flow:"connect", S, C, redirect} 10 min
                                    302 ───────────────────────────────▶ consent
                                    /oauth/google/callback?code&state=X ◀─┘
                                    exchange code + CLIENT_SECRET (server side)
                                    KV oauthcode:<sha256(K)> {tokens, C} 2 min
loopback ◀── 302 http://127.0.0.1:PORT/cb?code=K&state=S&flow=connect
check S; POST /oauth/redeem {code:K, code_verifier}
                                    sha256(verifier) == C ? return tokens, delete code
store tokens in the OS keychain
later: POST /oauth/google/refresh {refresh_token}   (the Worker adds the secret)
```

Blaze-account sign-in with Google or GitHub is the same dance through
`/v1/auth/<provider>/start`; the state record says `flow:"login"`, so the **same
callback URL** serves both. Redeeming a login code returns a Blaze session instead
of provider tokens.

## Endpoints

| Method | Path | What |
| --- | --- | --- |
| GET | `/health` | `{"ok":true,"service":"blaze-auth","version":"0.5.1"}` |
| GET | `/v1/providers` | which sign-ins and connectors are configured |
| POST | `/v1/auth/signup` | `{email, password, name?}` → `201 {token, user}` (`409 email_taken`) |
| POST | `/v1/auth/login` | `{email, password}` → `{token, user}` (`401 invalid_credentials`, `429 rate_limited`) |
| GET | `/v1/auth/{google,github}/start` | `?state&code_challenge&redirect` → provider sign-in |
| POST | `/v1/auth/redeem` (= `/oauth/redeem`) | `{code, code_verifier}` → `{kind:"session", token, user}` |
| GET | `/v1/me` | `Authorization: Bearer bz_…` → `{user}` |
| POST | `/v1/logout` | ends this session |
| POST | `/v1/account/delete` | `{"confirm":"delete"}` → deletes the account, identities and sessions |
| GET | `/oauth/{provider}/start` | `?state&code_challenge&redirect&scope?` → provider consent |
| GET | `/oauth/{provider}/callback` | the provider comes back here (register this URL) |
| POST | `/oauth/redeem` | `{code, code_verifier}` → `{kind:"tokens", provider, tokens, scopes}` |
| POST | `/oauth/{provider}/refresh` | `{refresh_token}` → `{kind:"tokens", tokens}` |

`provider` is `google`, `github`, `spotify`, `notion` or `slack`. A provider whose
`<NAME>_CLIENT_ID` / `<NAME>_CLIENT_SECRET` aren't set answers
`503 {"error":"not_configured"}`, and the desktop offers manual API-key setup instead.

Rules the Worker enforces: `redirect` must be `http://127.0.0.1:<1024-65535>/…` or
`http://[::1]:<port>/…` (no query, fragment or user info); `code_challenge` is S256
(43 chars); scopes must be on the provider's allow-list (`src/providers.ts`); states
and codes are single use; browser origins not in `ALLOWED_ORIGINS` can't POST.

## Storage (KV only)

| Key | Value | TTL |
| --- | --- | --- |
| `user:<id>` | account JSON (PBKDF2 hash, identities, session hashes) | none |
| `email:<lower-email>` | user id | none |
| `ident:<provider>:<subject>` | user id | none |
| `sess:<sha256(token)>` | session | 90 days |
| `oauthstate:<state>` | the flow (login/connect), desktop state, PKCE challenge, loopback | 10 min |
| `oauthcode:<sha256(code)>` | tokens or the signed-in user id, bound to the challenge | 2 min |
| `rl:<kind>:<key>` | failed sign-in / sign-up counters | the window |

Passwords: PBKDF2-SHA256, 100,000 iterations (the Workers maximum), 16-byte salt,
stored as `pbkdf2$sha256$<iter>$<salt>$<hash>`. A verified Google/GitHub email that
matches an account made with an unverified email + password takes it over (password
and sessions dropped), so nobody can pre-register your address.

Free-tier budget: KV allows 1,000 writes and 1,000 deletes a day. A connect costs
2 writes + 2 deletes, a sign-in about 2 writes, a failed sign-in 2 writes. That's
hundreds of sign-ins/connects a day; past it, move counters to the Workers Rate
Limiting binding or add D1.

## Deploy (exact steps)

```bash
cd cloud
npm install
export CLOUDFLARE_API_TOKEN=…            # token with Workers Scripts:Edit + Workers KV Storage:Edit
export CLOUDFLARE_ACCOUNT_ID=ef895b6795ee39066c863c39a42ec8b6
npx tsc --noEmit && npx vitest run       # type check + tests

# First time only (already done; the id is in wrangler.toml):
npx wrangler kv namespace create KV      # put the printed id in wrangler.toml

npx wrangler deploy
curl https://blaze-auth.blaze-app.workers.dev/health
```

### Turn on a provider

1. Make the developer app and register **exactly** this callback:

| Provider | Callback URL | Where |
| --- | --- | --- |
| Google | `https://blaze-auth.blaze-app.workers.dev/oauth/google/callback` | Google Cloud Console › Credentials › OAuth client ID › **Web application** › Authorized redirect URIs. Enable Gmail, Calendar, Drive and People APIs; add the scopes on the consent screen. |
| GitHub | `https://blaze-auth.blaze-app.workers.dev/oauth/github/callback` | github.com › Settings › Developer settings › OAuth Apps › Authorization callback URL |
| Spotify | `https://blaze-auth.blaze-app.workers.dev/oauth/spotify/callback` | developer.spotify.com › Dashboard › your app › Redirect URIs (Web API) |
| Notion | `https://blaze-auth.blaze-app.workers.dev/oauth/notion/callback` | notion.so/my-integrations › **Public** integration › Redirect URIs |
| Slack | `https://blaze-auth.blaze-app.workers.dev/oauth/slack/callback` | api.slack.com/apps › OAuth & Permissions › Redirect URLs; add the **User Token Scopes** in `src/providers.ts` |

2. Save its ID and secret as Worker secrets (prompts for the value; nothing is written to disk):

```bash
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler secret put GITHUB_CLIENT_ID
npx wrangler secret put GITHUB_CLIENT_SECRET
npx wrangler secret put SPOTIFY_CLIENT_ID
npx wrangler secret put SPOTIFY_CLIENT_SECRET
npx wrangler secret put NOTION_CLIENT_ID
npx wrangler secret put NOTION_CLIENT_SECRET
npx wrangler secret put SLACK_CLIENT_ID
npx wrangler secret put SLACK_CLIENT_SECRET
```

Secrets apply immediately (no redeploy). `GET /v1/providers` then shows the provider
as `true` and Blaze Desktop switches its row to one-click **Connect**.

Google and GitHub client credentials also power "Sign in with Google/GitHub" for Blaze
accounts, through the same callback.

## Local development

```bash
npx wrangler dev            # http://127.0.0.1:8787, local KV
# put test secrets in cloud/.dev.vars (git-ignored), e.g. GOOGLE_CLIENT_ID=…
```

Point the desktop at it with `"cloud_url": "http://127.0.0.1:8787"` in
`~/.blaze/desktop/cloud.json`, or `BLAZE_CLOUD_URL=http://127.0.0.1:8787`.
