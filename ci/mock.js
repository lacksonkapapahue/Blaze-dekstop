// Fake backend so CI can screenshot the UI in a normal browser.
(() => {
  const info = { os: "linux", os_name: "Arch Linux (Omarchy)", arch: "amd64", cpu: "AMD Ryzen 7 7840U", cores: 16, ram_gb: 32, gpu: ["AMD Radeon 780M"], shell: "bash", shell_path: "/usr/bin/bash", pkg_managers: ["pacman"], tools: { git: "2.51", python: "3.13", node: "v24.1", go: "1.25", docker: "28.1" }, home: "/home/luke", disk_free_gb: 312 };
  const state = { version: "v0.3.0", setup_done: true, info, missing: [], installs: { node: "sudo pacman -S --noconfirm nodejs npm" }, providers: [
    { id: "gemini", name: "Google Gemini", short: "Google Gemini", key_hint: "AIza…", key_page: "https://aistudio.google.com/apikey", quota_page: "https://aistudio.google.com/", free: true, has_key: true, keys: 2, ready: true, in_chain: true, model: "gemini-3.8-flash" },
    { id: "groq", name: "Groq", short: "Groq", key_hint: "gsk_…", key_page: "https://console.groq.com/keys", free: true, has_key: true, keys: 1, ready: true, in_chain: true, model: "openai/gpt-oss-120b" },
    { id: "cerebras", name: "Cerebras", short: "Cerebras", key_hint: "csk-…", free: true, model: "gpt-oss-120b" },
    { id: "openrouter", name: "OpenRouter", short: "OpenRouter", key_hint: "sk-or-…", free: true },
    { id: "deepseek", name: "DeepSeek", short: "DeepSeek", key_hint: "sk-…", free: false, model: "deepseek-chat" },
    { id: "ollama", name: "Ollama (local)", short: "Ollama", free: true, keyless: true },
    { id: "custom", name: "Custom (OpenAI-compatible)", short: "Custom", key_hint: "Your key" },
    { id: "pollinations", name: "Pollinations (keyless)", short: "Pollinations", free: true, keyless: true, model: "openai-fast" }],
    chain: [{ provider: "gemini", model: "gemini-3.8-flash" }, { provider: "groq", model: "openai/gpt-oss-120b" }],
    selection: { auto: true, provider: "auto", label: "Auto (free routing)" },
    routing: { fallback: true, fastest_first: true, keyless: false, daily_cap: 0, today_cost: 0 },
    prefs: { theme: window.__theme || "light", folder: "/home/luke/code/homeglow", design_mode: "ask", project: "p1" }, model: "Auto · Google Gemini · gemini-3.8-flash",
    project: { id: "p1", name: "HomeGlow", folder: "/home/luke/code/homeglow", instructions: "Shopify theme. Use pnpm. Keep it fast on phones." }, yolo: false, persona: "", keyless: true, skills: ["deploy-site: build and push the HomeGlow theme"], memory: "- Uses pnpm, not npm (2026-10-09)" };

  // Connectors (v0.3.2)
  const T = (name, group, risk, desc, mode, grant) => ({ name, group, risk, desc, mode: mode || (risk === "read" ? "always" : "ask"), default: risk === "read" ? "always" : "ask", needs_grant: !!grant });
  const gfields = (set) => [{ key: "client_id", label: "Client ID", hint: "…apps.googleusercontent.com", value: set ? "1234-abcd.apps.googleusercontent.com" : "", set }, { key: "client_secret", label: "Client secret", hint: "GOCSPX-…", secret: true, set }];
  const connView = { loopback: "http://127.0.0.1:43117/callback", scheme: "blaze://connector/oauth_callback", connectors: [
    { id: "google", name: "Google", blurb: "Gmail, Calendar, Drive and Contacts", auth: "oauth", status: "connected", account: "kapapaluckson75@gmail.com", enabled: true, since: "10 Oct 2026",
      granted: ["read your email", "send email as you", "see your calendar events", "see and download your Drive files", "see your contacts"], groups: ["gmail", "calendar", "drive", "contacts"],
      fields: gfields(true), steps: ["Open Google Cloud Console and create a project (any name).", "APIs & Services › Library: enable Gmail API, Google Calendar API, Google Drive API and People API.", "OAuth consent screen: External, then add your own Google address as a test user.", "Credentials › Create credentials › OAuth client ID › Application type: Desktop app.", "Paste the client ID and client secret here, then Connect."],
      console: "https://console.cloud.google.com/apis/credentials", console_name: "Google Cloud Console", redirect_uri: "http://127.0.0.1:43117/callback", custom_scheme: false,
      tools: [T("gmail_search", "gmail", "read", "Search the user's Gmail with Gmail search syntax."), T("gmail_read", "gmail", "read", "Read one Gmail message by id."), T("gmail_draft", "gmail", "action", "Save an email as a draft in Gmail (not sent).", "ask", true), T("gmail_send", "gmail", "write", "Send an email from the user's Gmail. The user approves it first."),
        T("gcal_events", "calendar", "read", "List events on the primary Google Calendar."), T("gcal_create", "calendar", "write", "Create an event on the primary Google Calendar.", "always", true), T("drive_search", "drive", "read", "Search Google Drive by name or contents."), T("drive_read", "drive", "read", "Read a Drive file's text by id."), T("gcontacts_search", "contacts", "read", "Search Google Contacts.")] },
    { id: "github", name: "GitHub", blurb: "Repos, issues, pull requests and notifications", auth: "device", status: "expired", account: "@lacksonkapapahue", enabled: true, since: "2 Oct 2026", groups: ["github"],
      fields: [{ key: "client_id", label: "Client ID", hint: "Ov23li…", value: "Ov23liAbCdEf", set: true }], steps: ["github.com › Settings › Developer settings › OAuth Apps › New OAuth App.", "Tick Enable Device Flow and save.", "Paste the Client ID here, then Connect and type the code Blaze shows."], console: "https://github.com/settings/developers", console_name: "GitHub Developer settings",
      tools: [T("github_my_repos", "github", "read", "List the user's own repositories."), T("github_issues", "github", "read", "List issues in a repository."), T("github_read", "github", "read", "Read an issue or pull request."), T("github_create_issue", "github", "write", "Open an issue. The user approves it first."), T("github_comment", "github", "write", "Comment on an issue or PR.")] },
    { id: "spotify", name: "Spotify", blurb: "Now playing, play, pause, skip and search", auth: "oauth", status: "needs_setup", enabled: true, groups: ["spotify"], custom_scheme: true, redirect: "", redirect_uri: "http://127.0.0.1:43117/callback",
      fields: [{ key: "client_id", label: "Client ID", hint: "32 hex characters", value: "", set: false }], steps: ["developer.spotify.com › Dashboard › Create app. Tick Web API.", "Redirect URIs: add http://127.0.0.1:43117/callback.", "Save, then paste the Client ID here and Connect."], console: "https://developer.spotify.com/dashboard", console_name: "Spotify Developer Dashboard",
      tools: [T("spotify_now_playing", "spotify", "read", "What's playing right now."), T("spotify_play", "spotify", "action", "Play the top result or resume."), T("spotify_control", "spotify", "action", "Pause, next or previous.")] },
    { id: "notion", name: "Notion", blurb: "Search, read and add to your pages", auth: "token", status: "connected", account: "Blaze · Luke's workspace", enabled: false, groups: ["notion"], fields: [{ key: "token", label: "Internal integration secret", hint: "ntn_…", secret: true, set: true }], steps: ["notion.so/my-integrations › New integration."], console: "https://www.notion.so/my-integrations", console_name: "Notion integrations",
      tools: [T("notion_search", "notion", "read", "Search shared pages."), T("notion_read", "notion", "read", "Read a page."), T("notion_append", "notion", "write", "Add text to a page.")] },
    { id: "slack", name: "Slack", blurb: "Read channels and post messages", auth: "token", status: "not_connected", enabled: true, groups: ["slack"], fields: [{ key: "token", label: "User OAuth token", hint: "xoxp-…", secret: true, set: false }], steps: ["api.slack.com/apps › Create New App › From scratch.", "Add user token scopes and install.", "Paste the User OAuth Token here."], console: "https://api.slack.com/apps", console_name: "Slack apps",
      tools: [T("slack_channels", "slack", "read", "List channels."), T("slack_read", "slack", "read", "Read a channel."), T("slack_post", "slack", "write", "Post a message.")] }],
    mcp: [{ id: "linear", name: "Linear", transport: "http", url: "https://mcp.linear.app/mcp", has_token: true, enabled: true, status: "ready", checked: "10 Oct 13:02",
        tools: [T("list_issues", "mcp:linear", "read", "List issues assigned to you."), T("create_issue", "mcp:linear", "action", "Create an issue."), T("delete_comment", "mcp:linear", "write", "Delete a comment.")] },
      { id: "files", name: "Files", transport: "stdio", command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem", "~/Documents"], enabled: true, status: "error", error: "couldn't start npx: executable file not found in $PATH", tools: [] }] };
  state.connected = 2;
  const conv = { id: "c1", title: "Fix the failing test", folder: "/home/luke/code/homeglow", messages: [
    { role: "user", content: "Run the tests and fix whatever fails." },
    { role: "assistant", content: "", tool_calls: [{ id: "t1", function: { name: "run_shell", arguments: "{\"command\":\"pnpm test\"}" } }] },
    { role: "tool", tool_call_id: "t1", content: "exit 1 · cwd /home/luke/code/homeglow\nFAIL src/price.test.ts\n  expected 19.99, got 19.989999" },
    { role: "assistant", content: "", tool_calls: [{ id: "t2", function: { name: "file_edit", arguments: "{\"path\":\"src/price.ts\"}" } }, { id: "t3", function: { name: "run_shell", arguments: "{\"command\":\"pnpm test\"}" } }] },
    { role: "tool", tool_call_id: "t2", content: "Edited /home/luke/code/homeglow/src/price.ts (1 replacement)." },
    { role: "tool", tool_call_id: "t3", content: "exit 0 · cwd /home/luke/code/homeglow\n42 passed" },
    { role: "assistant", content: "All **42 tests pass** now.\n\n1. `price.ts` added floats directly, so `19.99` came out as `19.989999`.\n2. I round to cents with `Math.round(x * 100) / 100` before returning.\n\n```ts\nexport const total = (items: Item[]) =>\n  Math.round(items.reduce((s, i) => s + i.price * i.qty, 0) * 100) / 100;\n```\n\nWant me to commit it?" }] };
  const A = {
    State: async () => state, Conversations: async () => [{ id: "c1", title: "Fix the failing test", updated: "Oct 9" }, { id: "c2", title: "Set up a Postgres container", updated: "Oct 8" }, { id: "c3", title: "Why is my fan so loud?", updated: "Oct 7" }],
    OpenConversation: async () => conv, Jobs: async () => "Job 1 [running 4m12s] pnpm dev\n   ready on http://localhost:5173", JobLog: async () => "", Schedules: async () => [{ name: "backup-notes", when: "daily 07:00", command: "rsync -a ~/notes /mnt/backup/" }],
    Projects: async () => [{ id: "p1", name: "HomeGlow", folder: "/home/luke/code/homeglow" }, { id: "p2", name: "Blaze.ai", folder: "/home/luke/code/blaze-ai" }],
    ProjectDetails: async () => ({ project: state.project, branch: "main", status: " M sections/hero.liquid\n?? design/option-b.html", recent: [{ path: "design/option-b.html", when: "Oct 9 21:20" }, { path: "sections/hero.liquid", when: "Oct 9 21:02" }, { path: "assets/theme.css", when: "Oct 9 20:40" }], chats: [{ id: "c1", title: "Fix the failing test", updated: "Oct 9" }, { id: "c4", title: "New hero section", updated: "Oct 9" }] }),
    Models: async () => [{ provider: "auto", name: "Auto (free routing)", model: "fastest healthy model in your chain", tools: true, current: true, ready: true }, { provider: "gemini", name: "Google Gemini", model: "gemini-3.8-flash", tools: true, ready: true }, { provider: "groq", name: "Groq", model: "openai/gpt-oss-120b", tools: true, ready: true }],
    ModelOptions: async p => ({ provider: p, fetched: "Oct 10 11:20", models: p === "groq"
      ? [{ id: "llama-3.3-70b-versatile", name: "Llama 3.3 70B", tools: "yes", context: 131072, free: true, known: true }, { id: "openai/gpt-oss-120b", name: "GPT-OSS 120B", tools: "yes", context: 131072, free: true, known: true, live: true }, { id: "qwen/qwen3-32b", name: "Qwen3 32B", tools: "yes", context: 131072, free: true, known: true }]
      : [{ id: "gemini-3.8-flash", name: "Gemini 3.8 Flash", tools: "yes", vision: true, context: 1048576, free: true, known: true, live: true, note: "Blaze's default" }, { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro", tools: "yes", vision: true, context: 1048576, free: true, known: true, live: true }, { id: "gemini-2.5-flash-lite", name: "Gemini 2.5 Flash-Lite", tools: "yes", vision: true, context: 1048576, free: true, known: true }, { id: "gemma-3-27b-it", name: "Gemma 3 27B", tools: "no", context: 131072, free: true, live: true }] }),
    DetectModels: async p => ({ provider: p, plan: "Free tier", models: [{ id: "gemini-3.8-flash", tools: "yes", vision: true, context: 1048576, free: true }] }),
    SelectModel: async (p, m) => p === "auto" ? "Auto · Google Gemini · gemini-3.8-flash" : `${p} · ${m}`,
    RouterStatus: async () => [{ provider: "gemini", model: "gemini-3.8-flash", name: "Google Gemini", ok: 14, avg_ms: 1840, can_tools: true, keys: 2 }, { provider: "groq", model: "openai/gpt-oss-120b", name: "Groq", ok: 3, fails: 1, cooling: 42, resting: "rate limit", avg_ms: 920, can_tools: true, keys: 1, last_error: "HTTP 429: rate limit reached" }],
    Keys: async () => [{ masked: "AIza…x9Q2", main: true, source: "saved" }, { masked: "AIza…7LmP", main: false, source: "saved" }],
    Usage: async () => ({ today: { in: 182000, out: 9400, cost: 0, calls: 41, priced: true }, month: { in: 2400000, out: 130000, cost: 0.42, calls: 512, priced: true },
      models: [{ provider: "gemini", model: "gemini-3.8-flash", in: 2100000, out: 110000, cost: 0, calls: 430, priced: true }, { provider: "groq", model: "openai/gpt-oss-120b", in: 300000, out: 20000, cost: 0, calls: 82, priced: true }],
      days: Array.from({ length: 14 }, (_, i) => ({ day: "2026-10-" + String(i + 1).padStart(2, "0"), tokens: [0, 12e3, 40e3, 8e3, 0, 90e3, 120e3, 60e3, 30e3, 0, 150e3, 80e3, 140e3, 191e3][i], calls: i * 3, cost: 0 })) }),
    Quota: async () => ({ rows: [{ label: "Status", value: "Working · gemini-3.8-flash" }], note: "Google shows exact per-model limits only in AI Studio.", page: "https://aistudio.google.com/" }),
    TestModel: async p => ({ name: p, ok: true, detail: "answered in 0.9s" }),
    AddProvider: async () => ({ ok: true, model: "llama-3.3-70b-versatile", where: "your system keychain" }),
    ConnectOpenRouter: async () => ({ ok: false, error: "Sign-in didn't finish." }),
    UseFreeStack: async () => state.chain, CheckUpdate: async () => ({ current: "v0.3.0", latest: "v0.3.0", available: false }),
    Files: async () => ["assets/theme.css", "design/option-a.html", "design/option-b.html", "layout/theme.liquid", "package.json", "sections/hero.liquid"],
    Design: async () => ({ base: window.__sample, target: { kind: "file", path: "index.html" }, files: ["index.html", "design/option-a.html"], versions: [{ n: 1, summary: "First pass at the landing page", when: "21:02" }, { n: 2, summary: "Warmer palette and rounded cards", when: "21:10" }, { n: 3, summary: "Bigger hero headline", when: "21:18" }] }),
    Connectors: async () => connView,
    ConnectorConnect: async id => id === "spotify" ? { status: "error", error: "Paste your Spotify client ID first (see the steps)." } : { status: "waiting", url: "https://accounts.google.com/o/oauth2/v2/auth" },
    ConnectorGrant: async () => ({ status: "waiting" }),
    MCPAdd: async () => ({ server: connView.mcp[0] }), MCPRefresh: async () => ({ server: connView.mcp[0] }),
    Doctor: async () => [{ name: "Internet", ok: true, detail: "Online" }, { name: "Google Gemini", ok: true, detail: "gemini-3.8-flash answered in 0.9s" }, { name: "Groq", ok: false, detail: "openai/gpt-oss-120b: Groq hit its free limit for now. Blaze will use another model." }, { name: "Shell", ok: true, detail: "bash · /usr/bin/bash" }],
  };
  window.go = { main: { App: new Proxy(A, { get: (t, k) => t[k] || (async () => "") }) } };
  // Events are captured so the screenshot script can play a turn: fire("tool", {...}).
  window.__ev = {};
  window.runtime = { EventsOn(ev, fn) { (window.__ev[ev] = window.__ev[ev] || []).push(fn); } };
  window.fire = (ev, data) => (window.__ev[ev] || []).forEach(f => f(data));
  window.__conv = conv;
})();
