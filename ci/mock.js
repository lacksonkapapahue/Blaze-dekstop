// Fake backend so CI can screenshot the UI in a normal browser.
(() => {
  const info = { os: "linux", os_name: "Arch Linux (Omarchy)", arch: "amd64", cpu: "AMD Ryzen 7 7840U", cores: 16, ram_gb: 32, gpu: ["AMD Radeon 780M"], shell: "bash", shell_path: "/usr/bin/bash", pkg_managers: ["pacman"], tools: { git: "2.51", python: "3.13", node: "v24.1", go: "1.25", docker: "28.1" }, home: "/home/luke", disk_free_gb: 312 };
  const state = { version: "v0.1.0", setup_done: true, info, missing: [], installs: { node: "sudo pacman -S --noconfirm nodejs npm" }, providers: [
    { id: "gemini", name: "Google Gemini", key_hint: "AIza…", free: true, has_key: true },
    { id: "groq", name: "Groq", key_hint: "gsk_…", free: true },
    { id: "openrouter", name: "OpenRouter", key_hint: "sk-or-…", free: true },
    { id: "ollama", name: "Ollama (local)", free: true, keyless: true }],
    chain: [{ provider: "gemini", model: "gemini-3.8-flash" }, { provider: "groq", model: "openai/gpt-oss-120b" }],
    prefs: { theme: window.__theme || "light", folder: "/home/luke/code/homeglow" }, yolo: false, persona: "", keyless: true, skills: ["deploy-site: build and push the HomeGlow theme"], memory: "- Uses pnpm, not npm (2026-10-09)" };
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
    Doctor: async () => [{ name: "Internet", ok: true, detail: "Online" }, { name: "Google Gemini", ok: true, detail: "gemini-3.8-flash answered in 0.9s" }, { name: "Groq", ok: false, detail: "HTTP 429: rate limited" }, { name: "Shell", ok: true, detail: "bash · /usr/bin/bash" }],
  };
  window.go = { main: { App: new Proxy(A, { get: (t, k) => t[k] || (async () => "") }) } };
  window.runtime = { EventsOn() {} };
  window.__conv = conv;
})();
