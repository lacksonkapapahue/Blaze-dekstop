# Desktop v0.3.2 plan: Connectors

Builds on v0.3.1 (PR #5, particles). Ports the phone app's connectors (Connectors.kt, Mcp.kt) and shapes them after how the ChatGPT desktop app does connectors, with one deliberate difference: Blaze has no backend, so the OAuth code exchange happens on the user's computer and tokens live in the OS keychain.

01 · Catalog

Each connector has an auth type: OAUTH (browser sign-in with PKCE), DEVICE (GitHub's code flow) or TOKEN (paste a token). A connector's page shows its setup fields, numbered steps, a button to the provider's developer console, the redirect URI to copy, and every tool with what it does and its approval mode.
Google: Gmail, Calendar, Drive, Contacts (OAuth, Desktop-app client ID + secret, loopback on any 127.0.0.1 port).
GitHub: device flow (client ID only, "Enable Device Flow" ticked).
Spotify: OAuth with PKCE (client ID only; redirect http://127.0.0.1:43117/callback, or blaze://connector/oauth_callback).
Notion: internal integration secret. Slack: user OAuth token (xoxp-).
Status per connector: Not connected, Needs setup, Connecting…, Connected as <account>, Expired.

02 · OAuth on the desktop

The system browser, never an embedded webview. Primary redirect: http://127.0.0.1:43117/callback, served by a tiny local server that only lives while a sign-in is pending (Google desktop clients may fall back to any free port). Providers that allow custom schemes can use blaze://connector/oauth_callback instead: wails.json registers the blaze protocol (Windows NSIS and the macOS Info.plist), the Linux .desktop file gets MimeType=x-scheme-handler/blaze, Blaze runs single-instance so a second launch with the link is handed to the running window (os.Args on cold start, SingleInstanceLock on Windows/Linux, OnUrlOpen on macOS), and the URL is routed to connector/oauth_callback.
Pending attempts are keyed by the OAuth state (anti-CSRF value and storage key at once). Named rejections: superseded (a newer attempt for the same connector wins), state_mismatch (unknown or replayed state), expired (10 minutes), missing_redirect_url, missing_code, and the provider's own error= (access_denied gets a plain sentence). Every attempt is single-use. Toasts: "Finishing {connector} setup", then "{name} is now connected".
If the browser can't reach Blaze, the waiting card lets the user paste the redirect URL from the address bar.

03 · Tokens, refresh and reauth

Tokens, client secrets and MCP keys go to the keychain via go-keyring (service "blaze-cli", keys connector:<id>, connector:<id>#client_secret, mcp:<id>). connectors.json in ~/.blaze/desktop holds only client IDs, accounts, granted scopes, enabled flags and per-tool modes.
Access tokens refresh a minute before expiry, and once more on a 401. If refreshing fails the connector is marked Expired, the tool result tells the model, and the chat shows "Your {connector} connection has expired. Reconnect it before Blaze can use it for this request." with Reconnect.

04 · Incremental consent

Google asks only for what the read tools need at first (plus what was granted before). A tool whose scope is missing (drafts, send, calendar writes) doesn't fail: the chat shows "Grant access", which re-runs the sign-in with the extra scopes added (include_granted_scopes). Blaze never re-grants silently. A 403 "insufficient scopes" from the API takes the same path.

05 · One proxy and one approval gate

Every connector and MCP call goes through connect.Manager.Run, after the existing gatekeeper (llm.NormalizeCalls) has repaired or dropped malformed calls. Tools are Read (runs), Action (asks unless auto-approve is on or Always allow) or Write (always asks unless Always allow). The card is Blaze's confirm card with Allow once / Always allow / Don't allow; Always allow is saved per connector + tool. Each tool can also be set to Ask, Always allow or Off on its connector page; Off removes it from the model's list.
MCP tools use the server's annotations: readOnlyHint → Read, destructiveHint → Write, otherwise Action.

06 · Small tool list

Nothing is added to the model's tools until an account is connected and turned on. Then one meta tool, connector_tools(group), lists the ready groups (gmail, calendar, drive, contacts, github, spotify, notion, slack, mcp:<server>); a group's tools join the list only after it is loaded, and stay loaded for that chat (restored when a chat is reopened). suggest_connector shows a Connect / Turn on card when a request needs an account that isn't ready (the tool_suggestion install/enable idea).

07 · My MCPs

Add a server by URL (Streamable HTTP, JSON or SSE replies, Mcp-Session-Id, re-initialize on 404; or the older HTTP+SSE transport) with an optional token and header name, or a local stdio server by command and arguments. Blaze initializes, lists tools (with pagination), caches them, and calls them as mcp_<server>_<tool>. Enable/disable, refresh and remove per server. Plain http is only allowed for localhost.

08 · UI

Connectors page in the v0.3 language: a two-column grid of connector cards (monochrome inline marks, no third-party logos loaded), the My MCPs list with an add-server form, and per-connector and per-server pages. Settings › Connectors shows the same. /connect in the command menu. Chat cards: Connect, Reconnect, Grant access, and the Always-allow approval. Toasts bottom right. Light and dark both styled.

09 · Tests

internal/connect: PKCE (RFC 7636 vector), the attempt state machine (superseded, state mismatch, replay, expiry, missing redirect, missing code, provider error), the full loopback flow against a fake provider, blaze:// routing, refresh before expiry, refresh after a 401, failed refresh → Expired → no API call, incremental consent, approval persistence (decline, allow once, auto-approve never skips Write, always allow survives a restart, off hides the tool), lazy groups, pasted tokens, MCP over Streamable HTTP (JSON and SSE replies, session expiry), legacy SSE and stdio against in-process fake servers, and Gmail send through the gate against a fake API.

10 · Left out

Scheduled jobs don't get connector tools (nobody is there to approve). MCP servers that need their own OAuth (the MCP authorization spec) aren't signed in for you; paste a token instead. No Microsoft/Outlook connector yet. The phone's share_to_app has no desktop equivalent.
