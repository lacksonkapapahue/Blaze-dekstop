# v0.5.0: Blaze accounts + one-click connectors

Blaze gets a tiny backend on Cloudflare's free tier (`cloud/`, the `blaze-auth` Worker,
Workers + one KV namespace) so connectors no longer need a developer app per user.

## What changes for the user
- **Connect in one click** for Google (Gmail, Calendar, Drive), GitHub, Spotify, Notion and
  Slack: the browser signs in, Blaze is connected. "Use your own key/developer app instead"
  stays under *Advanced* on each connector page.
- Providers whose secrets aren't set on the Worker show "One-click Connect is coming soon"
  and keep the manual setup open.
- **Blaze account** (optional): Settings › Account and `/account`. Sign in with Google,
  GitHub or email + password; sign out; delete account. A card at the top of Accounts.

## How it works
- Desktop: `internal/cloud` (loopback on 127.0.0.1:<random>/cb, PKCE S256, opens the system
  browser, redeems a one-time code). `connect.Broker` plugs it into the connector manager;
  one-click connections are marked `via: "broker"` and refresh through the Worker.
- Worker: client secrets are Worker secrets only; provider tokens are never stored beyond a
  5-minute one-time code in KV. One callback per provider (`/oauth/<provider>/callback`)
  serves both account sign-in and connector linking; the KV state record says which.
- Base URL: `https://blaze-auth.blaze-app.workers.dev`, overridable with `BLAZE_CLOUD_URL` or
  `{"cloud_url": "..."}` in `~/.blaze/desktop/cloud.json`.

See `cloud/README.md` for endpoints, storage and deploy steps.
