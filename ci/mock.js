// Fake backend so CI can screenshot the UI in a normal browser.
(() => {
  const os = window.__os || "linux";
  const info = { os, os_name: "Arch Linux (Omarchy)", arch: "amd64", cpu: "AMD Ryzen 7 7840U", cores: 16, ram_gb: 32, gpu: ["AMD Radeon 780M"], shell: "bash", shell_path: "/usr/bin/bash", pkg_managers: ["pacman"], tools: { git: "2.51", python: "3.13", node: "v24.1", go: "1.25", docker: "28.1" }, home: "/home/luke", disk_free_gb: 312 };
  const state = { version: "v0.4.1", setup_done: true, info, missing: [], installs: { node: "sudo pacman -S --noconfirm nodejs npm" }, providers: [
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
    prefs: { theme: window.__theme || "light", folder: "/home/luke/code/homeglow", design_mode: "ask", project: "p1", show_steps: false, fold_cards: true, autostart: false, hotkey: "" },
    desktop: { os, tray: true, tray_note: "In the system tray", background: true, autostart: false, autostart_ok: false, hotkey: "ctrl+shift+space", hotkey_label: "Ctrl+Shift+Space", hotkey_ok: true,
      hotkey_note: "Press Ctrl+Shift+Space anywhere for quick ask", needs_access: false, wayland: false, frameless: os === "windows", orb: false,
      presets: [{ id: "ctrl+shift+space", label: "Ctrl+Shift+Space" }, { id: "alt+space", label: "Alt+Space" }, { id: "ctrl+alt+space", label: "Ctrl+Alt+Space" }, { id: "ctrl+shift+b", label: "Ctrl+Shift+B" }] }, model: "Auto · Google Gemini · gemini-3.8-flash",
    project: { id: "p1", name: "HomeGlow", folder: "/home/luke/code/homeglow", instructions: "Shopify theme. Use pnpm. Keep it fast on phones." }, yolo: false, persona: "", keyless: true, skills: ["deploy-site: build and push the HomeGlow theme"], memory: "- Uses pnpm, not npm (2026-10-09)" };
  const conv = { id: "c1", title: "Fix the failing test", folder: "/home/luke/code/homeglow", messages: [
    { role: "user", content: "Run the tests and fix whatever fails." },
    { role: "assistant", content: "", tool_calls: [{ id: "t1", function: { name: "run_shell", arguments: "{\"command\":\"pnpm test\"}" } }] },
    { role: "tool", tool_call_id: "t1", content: "exit 1 · cwd /home/luke/code/homeglow\nFAIL src/price.test.ts\n  expected 19.99, got 19.989999" },
    { role: "assistant", content: "", tool_calls: [{ id: "t2", function: { name: "file_edit", arguments: "{\"path\":\"src/price.ts\"}" } }, { id: "t3", function: { name: "run_shell", arguments: "{\"command\":\"pnpm test\"}" } }] },
    { role: "tool", tool_call_id: "t2", content: "Edited /home/luke/code/homeglow/src/price.ts (1 replacement)." },
    { role: "tool", tool_call_id: "t3", content: "exit 0 · cwd /home/luke/code/homeglow\n42 passed" },
    { role: "assistant", content: "All **42 tests pass** now.\n\n1. `price.ts` added floats directly, so `19.99` came out as `19.989999`.\n2. I round to cents with `Math.round(x * 100) / 100` before returning.\n\n```ts\nexport const total = (items: Item[]) =>\n  Math.round(items.reduce((s, i) => s + i.price * i.qty, 0) * 100) / 100;\n```\n\nWant me to commit it?" }] };
  // v0.4.1: a long answer the model put in a card (the 1.0 roadmap table).
  const roadmap = ["| Phase | Done | Already built | Still missing |", "| --- | --- | --- | --- |",
    "| 0 Foundation | ~70% | Wails app, Blaze look, setup wizard, model router, installers for every OS, in-app updates | Tray/background mode, global hotkey, orb overlay |",
    "| 1 Hands | ~30% | Files, shell, run_code, git, web search, fetch, HTTP, jobs | Screen reading, mouse/keyboard, browser driving, verify loop |",
    "| 2 Memory | ~25% | remember/forget, write_skill/use_skill, projects | Structured memory, Show me once |",
    "| 3 Blaze Link | ~50% | QR pairing, pinned HTTPS, ask_pc and phone_ask (phone side shipped) | Merging PR #3, an always-on phone inbox, a relay beyond Wi-Fi/Tailscale, OTP/WhatsApp tools |",
    "| 4 Autonomy | ~20% | OS-level schedules, background jobs | Event triggers, multi-hour missions, Ember report |",
    "| 5 Trust | ~30% | Confirm cards, auto-approve toggle, daily spend cap | Per-app tiers, undo timeline, kill switch |",
    "| 6 Ship | ~50% | CI for win/mac/linux/arch, releases, screenshots | Code signing (SmartScreen warning), crash reports, real-PC testing, benchmark |"].join("\n");
  window.__roadmap = roadmap;
  window.__cardReply = "Blaze Desktop is roughly **a third of the way to 1.0**. The biggest gap is Phase 1: without screen reading and mouse control, Blaze can't drive your other apps yet.\n\n:::card Blaze Desktop v0.4.0 vs the 1.0 roadmap\n" + roadmap + "\n:::\n\nWant me to start on Phase 1?";
  window.__cardConv = { id: "c5", title: "Where are we on the roadmap?", folder: "/home/luke/code/blaze-desktop", messages: [
    { role: "user", content: "How far is Blaze Desktop from 1.0? Give me the roadmap table." },
    { role: "assistant", content: window.__cardReply }] };
  // The fallback: a long reply without card markers still folds (the steps into "Details").
  window.__autoReply = "Docker is installed and running. Postgres 17 is up on **localhost:5432**.\n\n## How I set it up\n\n" +
    ["Pulled `postgres:17-alpine` (82 MB).", "Created the volume `pgdata` so data survives restarts.", "Started the container `blaze-pg` with `POSTGRES_PASSWORD` from your `.env`.", "Mapped port 5432 to localhost only, not your whole network.", "Waited for `pg_isready` to answer (2.1s).", "Created the database `homeglow` and the user `app`.", "Ran your migrations in `db/migrations` (14 files).", "Seeded 40 test products from `db/seed.sql`.", "Added `DATABASE_URL` to `.env.local`.", "Checked a query: `select count(*) from products` → 40."].map((x, i) => `${i + 1}. ${x}`).join("\n") +
    "\n\n```bash\ndocker run -d --name blaze-pg -p 127.0.0.1:5432:5432 \\\n  -v pgdata:/var/lib/postgresql/data \\\n  -e POSTGRES_PASSWORD=$POSTGRES_PASSWORD postgres:17-alpine\n```\n\nWant me to add it to `docker-compose.yml` too?";
  const A = {
    State: async () => state, Conversations: async () => [{ id: "c1", title: "Float Rounding In Price Tests", updated: "Oct 9", source: "auto" }, { id: "c2", title: "Set up a Postgres container", updated: "Oct 8" }, { id: "c3", title: "Why is my fan so loud?", updated: "Oct 7" }, { id: "c6", title: "HomeGlow launch checklist", updated: "Oct 6", source: "manual" }],
    DefaultPersonality: async () => "PERSONALITY\nYou are Blaze. Be warm, sharp, and one step ahead: an expert who happens to be easy to talk to.\n- Answer first. Lead with the result.\n- Take a side.\n- Be specific.",
    SetPersonality: async () => "",
    RenameConversation: async (id, t) => t || "Set up a Postgres container",
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
    UseFreeStack: async () => state.chain, CheckUpdate: async () => ({ current: "v0.4.1", latest: "v0.4.1", available: false }),
    Files: async () => ["assets/theme.css", "design/option-a.html", "design/option-b.html", "layout/theme.liquid", "package.json", "sections/hero.liquid"],
    Design: async () => ({ base: window.__sample, target: { kind: "file", path: "index.html" }, files: ["index.html", "design/option-a.html"], versions: [{ n: 1, summary: "First pass at the landing page", when: "21:02" }, { n: 2, summary: "Warmer palette and rounded cards", when: "21:10" }, { n: 3, summary: "Bigger hero headline", when: "21:18" }] }),
    SetHotkey: async id => ({ ...state.desktop, hotkey: id }), RetryHotkey: async () => state.desktop, SetAutostart: async () => "",
    Doctor: async () => [{ name: "Internet", ok: true, detail: "Online" }, { name: "Google Gemini", ok: true, detail: "gemini-3.8-flash answered in 0.9s" }, { name: "Groq", ok: false, detail: "openai/gpt-oss-120b: Groq hit its free limit for now. Blaze will use another model." }, { name: "Shell", ok: true, detail: "bash · /usr/bin/bash" }, { name: "Tray", ok: true, detail: "In the system tray" }, { name: "Shortcut", ok: true, detail: "Press Ctrl+Shift+Space anywhere for quick ask" }, { name: "Start at login", ok: true, detail: "Off (Settings › Behaviour)" }],
  };
  window.go = { main: { App: new Proxy(A, { get: (t, k) => t[k] || (async () => "") }) } };
  // Events are captured so the screenshot script can play a turn: fire("tool", {...}).
  window.__ev = {};
  window.runtime = { EventsOn(ev, fn) { (window.__ev[ev] = window.__ev[ev] || []).push(fn); } };
  window.fire = (ev, data) => (window.__ev[ev] || []).forEach(f => f(data));
  window.__conv = conv;
})();
