// Blaze Desktop UI. Talks to Go through window.go.main.App and Wails events.
const API = () => window.go.main.App;
const on = (ev, fn) => window.runtime.EventsOn(ev, fn);
const $ = (s, el = document) => el.querySelector(s);
const h = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const esc = s => MD.esc(String(s ?? ""));
const pad = n => String(n).padStart(2, "0");

let S = null;          // State from Go
let view = "chat";
let busy = false;
let current = null;    // { el, text, mdEl, steps, stepsEl }
let convId = "";

// ---------- theme ----------
function applyTheme() {
  const t = S?.prefs?.theme || "system";
  const dark = t === "dark" || (t === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
}
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", applyTheme);

// ---------- boot ----------
async function boot() {
  S = await API().State();
  applyTheme();
  setFolder(S.prefs.folder);
  await refreshChats();
  if (!S.setup_done) show("setup"); else show("chat");
  setInterval(refreshJobCount, 4000);
}

function setFolder(path) {
  const home = S.info.home;
  let p = path || "";
  if (home && p.startsWith(home)) p = "~" + p.slice(home.length);
  $("#folderName").textContent = p || "~";
}

$("#folder").onclick = async () => { const d = await API().PickFolder(); S.prefs.folder = d; setFolder(d); };
$("#newChat").onclick = async () => { if (busy) return; await API().NewConversation(); convId = ""; show("chat"); refreshChats(); };
document.querySelectorAll(".nav").forEach(b => b.onclick = () => show(b.dataset.view));

// Links open in the system browser.
document.addEventListener("click", e => {
  const a = e.target.closest("a[data-href]");
  if (a) { e.preventDefault(); API().OpenURL(a.dataset.href); }
  const c = e.target.closest(".copy");
  if (c) { navigator.clipboard.writeText(c.closest(".code").querySelector("pre").textContent); c.textContent = "Copied"; setTimeout(() => c.textContent = "Copy", 1200); }
  const st = e.target.closest(".step .head");
  if (st) st.parentElement.classList.toggle("open");
});

async function refreshChats() {
  const list = await API().Conversations() || [];
  const nav = $("#chats"); nav.innerHTML = "";
  if (!list.length) nav.append(h("div", "label weak", "&nbsp;No chats yet"));
  list.forEach(c => {
    const b = h("button", "chat" + (c.id === convId && view === "chat" ? " on" : ""), `<span class="t">${esc(c.title)}</span><span class="x" title="Delete">×</span>`);
    b.onclick = async e => {
      if (e.target.classList.contains("x")) { await API().DeleteConversation(c.id); if (c.id === convId) { convId = ""; show("chat"); } refreshChats(); return; }
      if (busy) return;
      const conv = await API().OpenConversation(c.id);
      convId = c.id; S.prefs.folder = conv.folder || S.prefs.folder; setFolder(S.prefs.folder);
      show("chat", conv); refreshChats();
    };
    nav.append(b);
  });
}

async function refreshJobCount() {
  const t = await API().Jobs();
  const n = (t.match(/\[running/g) || []).length;
  $("#jobCount").textContent = n ? pad(n) : "";
}

function show(v, conv) {
  view = v;
  document.querySelectorAll(".nav").forEach(b => b.classList.toggle("on", b.dataset.view === v));
  const el = $("#view"); el.innerHTML = "";
  $("#route").textContent = "";
  ({ chat: chatView, setup: setupView, settings: settingsView, doctor: doctorView, jobs: jobsView, schedule: scheduleView })[v](el, conv);
}

// ---------- chat ----------
function chatView(el, conv) {
  const log = h("div"); log.id = "log";
  const col = h("div", "col"); log.append(col);
  el.append(log, $("#composerTpl").content.cloneNode(true));
  const input = $("#input"), send = $("#send"), yolo = $("#yolo");
  yolo.checked = !!S.yolo;
  yolo.onchange = () => { S.yolo = yolo.checked; API().SetYolo(yolo.checked); };
  input.addEventListener("input", () => { input.style.height = "auto"; input.style.height = Math.min(input.scrollHeight, 220) + "px"; });
  input.addEventListener("keydown", e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } });
  send.onclick = () => busy ? API().Stop() : submit();
  setBusy(busy);

  if (conv && conv.messages && conv.messages.length) replay(col, conv.messages);
  else hero(col);
  input.focus();
}

function hero(col) {
  const os = S.info.os_name || "your computer";
  const box = h("div", "hero");
  box.innerHTML = `<div class="label acc">Blaze · ${esc(os)}</div><div class="big" style="margin-top:10px">What should we <em>get done</em>?</div>
    <p class="lead" style="margin-top:12px">Blaze can run commands, edit files in this folder, write and run code, use git, search the web and install what's missing. Anything risky asks you first.</p>`;
  const sug = h("div", "suggest");
  [["Explore", "What's in this folder? Give me a short tour."],
   ["Fix", "Run the tests here and fix whatever fails."],
   ["Build", "Make a small Python script that renames my screenshots by date."],
   ["System", "How much disk space is left, and what's using the most?"]].forEach(([k, t]) => {
    const b = h("button", "", `<span class="label">${k}</span>${esc(t)}`);
    b.onclick = () => { $("#input").value = t; submit(); };
    sug.append(b);
  });
  box.append(sug); col.append(box);
}

function replay(col, msgs) {
  let turn = null;
  const results = {};
  msgs.forEach(m => { if (m.role === "tool") results[m.tool_call_id] = m.content; });
  msgs.forEach(m => {
    if (m.role === "user") { col.append(userMsg(m.content)); turn = null; }
    else if (m.role === "assistant") {
      if (!turn) { turn = blazeMsg(); col.append(turn.el); }
      (m.tool_calls || []).forEach(tc => { const s = addStep(turn, tc.id, tc.function.name, tc.function.arguments); finishStep(s, results[tc.id] || ""); });
      if (m.content) { turn.text += m.content; turn.mdEl.innerHTML = MD.render(turn.text); }
    }
  });
  scrollDown(true);
}

function userMsg(text) { const m = h("div", "msg user"); m.append(h("div", "bubble", esc(text))); return m; }

function blazeMsg() {
  const el = h("div", "msg blaze");
  el.append(h("div", "who label", "Blaze"));
  const stepsEl = h("div", "steps"); stepsEl.style.display = "none";
  const mdEl = h("div", "md");
  el.append(stepsEl, mdEl);
  return { el, stepsEl, mdEl, text: "", steps: {} };
}

function scrollDown(force) {
  const log = $("#log"); if (!log) return;
  if (force || log.scrollHeight - log.scrollTop - log.clientHeight < 160) log.scrollTop = log.scrollHeight;
}

function setBusy(b) {
  busy = b;
  const send = $("#send"); if (!send) return;
  send.textContent = b ? "Stop" : "Send";
  send.classList.toggle("accent", !b); send.classList.toggle("line", b);
  $("#hint").textContent = b ? "Working… Stop ends the task" : "Enter to send · Shift+Enter for a new line";
}

let thinkingEl = null;
function thinking(onOff, text) {
  if (thinkingEl) { thinkingEl.remove(); thinkingEl = null; }
  if (onOff && current) {
    thinkingEl = h("div", "thinking label", `<span class="sq"></span><span>${esc(text || "Thinking")}</span>`);
    current.el.append(thinkingEl); scrollDown();
  }
}

async function submit() {
  const input = $("#input");
  const text = input.value.trim();
  if (!text || busy) return;
  input.value = ""; input.style.height = "auto";
  const col = $("#log .col");
  const heroEl = $(".hero", col); if (heroEl) heroEl.remove();
  col.append(userMsg(text));
  current = blazeMsg(); col.append(current.el);
  setBusy(true); thinking(true);
  scrollDown(true);
  const r = await API().Send(text);
  if (r === "busy") { setBusy(true); }
}

function describe(name, args) {
  let a = {}; try { a = JSON.parse(args || "{}"); } catch (e) {}
  const v = k => String(a[k] ?? "").split("\n")[0].slice(0, 90);
  switch (name) {
    case "run_shell": return "$ " + v("command");
    case "git": return "git " + v("args");
    case "web_search": return "search  " + v("query");
    case "fetch_page": return "read  " + v("url");
    case "run_code": return "run " + v("language");
    case "file_read": case "file_write": case "file_edit": case "file_delete": case "file_list": case "file_search":
      return name.replace("file_", "") + "  " + (v("path") || v("pattern") || ".");
  }
  return name.replace(/_/g, " ");
}

function addStep(turn, id, name, args) {
  turn.stepsEl.style.display = "";
  const s = h("div", "step run", `<div class="head"><span class="st"></span><span>${esc(describe(name, args))}</span><span class="sum"></span></div><pre></pre>`);
  turn.stepsEl.append(s); turn.steps[id] = s; return s;
}

function finishStep(s, result) {
  if (!s) return;
  const first = (result || "").split("\n")[0];
  const bad = /^Error|^exit [1-9]|did NOT approve|^Refused/.test(result || "");
  s.classList.remove("run"); s.classList.add(bad ? "bad" : "ok");
  s.querySelector(".sum").textContent = first.slice(0, 80);
  s.querySelector("pre").textContent = result;
}

// Events from Go
on("thinking", () => { if (current) thinking(true); });
on("status", t => { if (current) thinking(true, t); });
on("delta", d => {
  if (!current) return;
  thinking(false);
  current.text += d;
  current.mdEl.innerHTML = MD.render(current.text);
  scrollDown();
});
on("tool", t => {
  if (!current) return;
  thinking(false);
  if (current.text) { current.text += "\n\n"; }
  addStep(current, t.id, t.name, t.args);
  thinking(true, describe(t.name, t.args));
  scrollDown();
});
on("tool_done", t => { if (current) finishStep(current.steps[t.id], t.result); });
on("confirm", c => {
  thinking(false);
  const card = h("div", "card confirm", `<div class="label acc title">${esc(c.title)}</div><div class="detail">${esc(c.detail)}</div>
    <div class="actions"><button class="btn accent yes">Yes, do it</button><button class="btn line no">No</button></div>`);
  const done = yes => { API().Answer(c.id, yes); card.classList.add("done"); card.querySelector(".actions").innerHTML = `<span class="label">${yes ? "Approved" : "Declined"}</span>`; thinking(true); };
  card.querySelector(".yes").onclick = () => done(true);
  card.querySelector(".no").onclick = () => done(false);
  (current ? current.el : $("#log .col")).append(card);
  scrollDown(true);
});
on("done", d => {
  thinking(false);
  if (current) {
    current.el.append(h("div", "route label weak", `${esc(d.route)} · ${d.seconds.toFixed(1)}s`));
    $("#route").textContent = d.route;
  }
  current = null; setBusy(false); scrollDown(); refreshChats();
});
on("error", msg => {
  thinking(false);
  const target = current ? current.el : $("#log .col");
  if (target) target.append(h("div", "card err", `<div class="label ink title">Couldn't finish</div><div class="md">${MD.render(msg)}</div>`));
  current = null; setBusy(false); scrollDown(true); refreshChats();
});
on("stopped", () => {
  thinking(false);
  if (current) current.el.append(h("div", "route label weak", "Stopped"));
  current = null; setBusy(false); refreshChats();
});

// ---------- setup wizard ----------
let wizStep = 0;
function setupView(el) {
  const page = h("div", "page"); const col = h("div", "col"); page.append(col); el.append(page);
  const titles = ["Your computer", "Tools", "AI models"];
  const draw = () => {
    col.innerHTML = `<div class="steps-wiz">${titles.map((t, i) => `<span class="label ${i === wizStep ? "on" : ""}">${pad(i + 1)} ${t}</span>`).join("")}</div>`;
    [pcStep, toolsStep, modelsStep][wizStep](col);
  };
  const next = h("div"); next.style.marginTop = "28px";
  function nav(col, last) {
    const row = h("div", "actions"); row.style.cssText = "display:flex;gap:8px;margin-top:28px";
    if (wizStep > 0) { const b = h("button", "btn line", "Back"); b.onclick = () => { wizStep--; draw(); }; row.append(b); }
    const n = h("button", "btn accent", last ? "Start using Blaze" : "Continue");
    n.onclick = async () => { if (last) { await API().FinishSetup(); S = await API().State(); show("chat"); } else { wizStep++; draw(); } };
    row.append(n); col.append(row);
  }
  function pcStep(col) {
    col.append(h("h1", "", "Hi. This is your computer."), h("p", "lead", "Blaze detected all of this itself, so it never has to ask what you're running."));
    col.append(pcTable(S.info));
    nav(col);
  }
  function toolsStep(col) {
    col.append(h("h1", "", "Developer tools"), h("p", "lead", "Blaze works best with these. Install the missing ones with your system's package manager, or skip."));
    const rows = h("div", "rows");
    ["git", "python", "node"].forEach((t, i) => {
      const have = S.info.tools[t] || (t === "python" && S.info.tools.python3);
      const cmd = S.installs[t];
      const r = h("div", "r", `<span class="n">${pad(i + 1)}</span><div class="main"><div class="t">${t}</div><div class="s">${have ? esc(have) : cmd ? esc(cmd) : "Not installed · no package manager found"}</div></div>`);
      if (have) r.append(h("span", "pill acc", "Installed"));
      else if (cmd) {
        const b = h("button", "btn line", "Install");
        b.onclick = async () => { b.disabled = true; b.textContent = "Installing…"; const out = await API().InstallTool(t); S = await API().State(); b.textContent = /^exit 0/.test(out) ? "Installed" : "Failed"; r.querySelector(".s").textContent = out.split("\n").slice(-1)[0] || out.split("\n")[0]; };
        r.append(b);
      } else r.append(h("span", "pill", "Missing"));
      rows.append(r);
    });
    col.append(rows); nav(col);
  }
  function modelsStep(col) {
    col.append(h("h1", "", "Pick a free AI model"), h("p", "lead", "Add one or more free keys. Blaze switches between them when one is busy. Keys go in your system keychain. Skip it, and a slower keyless model answers."));
    col.append(providerRows(() => draw()));
    nav(col, true);
  }
  draw();
}

function pcTable(info) {
  const kv = h("div", "kv");
  const add = (k, v) => kv.append(h("span", "label", k), h("span", "v", esc(v)));
  add("System", `${info.os_name} · ${info.arch}`);
  add("Processor", `${info.cpu || "Unknown"} · ${info.cores} threads`);
  add("Memory", `${Math.round(info.ram_gb)} GB RAM · ${Math.round(info.disk_free_gb)} GB free disk`);
  add("Graphics", (info.gpu || []).join(", ") || "None detected");
  add("Shell", `${info.shell} · ${info.shell_path}`);
  add("Packages", (info.pkg_managers || []).join(", ") || "None found");
  add("Tools", Object.keys(info.tools || {}).sort().join("  ") || "None");
  return kv;
}

function providerRows(redraw) {
  const rows = h("div", "rows");
  const inChain = id => (S.chain || []).some(e => e.provider === id);
  S.providers.filter(p => p.id !== "pollinations").forEach((p, i) => {
    const r = h("div", "r");
    const used = inChain(p.id);
    r.innerHTML = `<span class="n">${pad(i + 1)}</span><div class="main"><div class="t">${esc(p.name)} ${p.free ? '<span class="pill">Free</span>' : ""}</div><div class="s">${used ? "Added · " + esc((S.chain.find(e => e.provider === p.id) || {}).model || "") : p.keyless ? "Runs on this computer, no key" : "Key starts " + esc(p.key_hint)}</div></div>`;
    const btn = h("button", used ? "btn ghost" : "btn line", used ? "Remove" : "Add");
    r.append(btn);
    const form = h("div", "keyform"); form.style.cssText = "grid-column:2/4;display:none";
    form.innerHTML = p.keyless ? "" : `<div class="keyrow"><input class="field" type="password" placeholder="Paste your ${esc(p.name)} key" ${p.has_key ? 'value="••••••••"' : ""}><button class="btn line get">Get a key</button><button class="btn accent save">Test & save</button></div>`;
    const msg = h("div", "s"); msg.style.marginTop = "8px"; form.append(msg);
    r.append(form);
    btn.onclick = async () => {
      if (used) { await API().RemoveProvider(p.id); S = await API().State(); redraw(); return; }
      if (p.keyless) { btn.disabled = true; btn.textContent = "Checking…"; const res = await API().AddProvider(p.id, ""); S = await API().State(); if (res.ok) redraw(); else { btn.disabled = false; btn.textContent = "Add"; form.style.display = ""; msg.textContent = res.error; } return; }
      form.style.display = form.style.display ? "" : "none";
    };
    const get = $(".get", form); if (get) get.onclick = () => API().OpenURL(p.key_page);
    const save = $(".save", form);
    if (save) save.onclick = async () => {
      const f = $("input", form); let key = f.value.trim(); if (key.startsWith("••")) key = "";
      save.disabled = true; save.textContent = "Testing…"; msg.textContent = "";
      const res = await API().AddProvider(p.id, key);
      save.disabled = false; save.textContent = "Test & save";
      if (res.ok) { S = await API().State(); redraw(); } else { msg.innerHTML = `<span class="bad">${esc(res.error)}</span>`; }
    };
    rows.append(r);
  });
  return rows;
}

// ---------- settings ----------
function settingsView(el) {
  const page = h("div", "page"); const col = h("div", "col"); page.append(col); el.append(page);
  const draw = async () => {
    S = await API().State();
    col.innerHTML = "";
    col.append(h("div", "label acc", "Settings"), h("h1", "", "Blaze"), h("p", "lead", `Version ${esc(S.version)} · settings and keys are shared with the Blaze command line.`));

    // Model order
    const g1 = h("div", "group"); g1.append(h("span", "label", "01 · Model order"));
    const chain = h("div", "rows");
    (S.chain || []).forEach((e, i) => {
      const r = h("div", "r", `<span class="n">${pad(i + 1)}</span><div class="main"><div class="t">${esc((S.providers.find(p => p.id === e.provider) || {}).name || e.provider)}</div><div class="s">${esc(e.model)}</div></div>`);
      const btns = h("div"); btns.style.display = "flex";
      const up = h("button", "btn ghost", "↑"); up.disabled = i === 0;
      up.onclick = async () => { const c = [...S.chain]; [c[i - 1], c[i]] = [c[i], c[i - 1]]; await API().SetChain(c); draw(); };
      btns.append(up); r.append(btns); chain.append(r);
    });
    if (!(S.chain || []).length) chain.append(h("div", "empty", "No models yet."));
    g1.append(chain);
    const g1b = h("div", "group"); g1b.append(h("span", "label", "02 · Add or remove models"), providerRows(draw));

    // Behaviour
    const g2 = h("div", "group"); g2.append(h("span", "label", "03 · Behaviour"));
    const t1 = h("label", "toggle", `<input type="checkbox" ${S.yolo ? "checked" : ""}><span>Auto-approve risky commands and installs <span class="label weak">deletes still ask</span></span>`);
    $("input", t1).onchange = e => API().SetYolo(e.target.checked);
    const t2 = h("label", "toggle", `<input type="checkbox" ${S.keyless ? "checked" : ""}><span>Fall back to the keyless model when every key fails</span>`);
    $("input", t2).onchange = e => API().SetKeyless(e.target.checked);
    t2.style.marginTop = "12px"; t2.style.display = "flex";
    const pers = h("textarea", "field"); pers.placeholder = "How Blaze should talk (optional), e.g. short answers, explain like I'm new to coding…"; pers.value = S.persona || "";
    const ps = h("button", "btn line", "Save style"); ps.onclick = async () => { await API().SetPersona(pers.value); ps.textContent = "Saved"; setTimeout(() => ps.textContent = "Save style", 1200); };
    const pw = h("div"); pw.style.marginTop = "14px"; pw.append(pers, ps); ps.style.marginTop = "8px";
    g2.append(t1, t2, pw);

    // Appearance
    const g3 = h("div", "group"); g3.append(h("span", "label", "04 · Appearance"));
    const seg = h("div", "seg");
    ["system", "light", "dark"].forEach(t => { const b = h("button", S.prefs.theme === t ? "on" : "", t); b.onclick = async () => { await API().SetTheme(t); S.prefs.theme = t; applyTheme(); draw(); }; seg.append(b); });
    g3.append(seg);

    // Memory
    const g4 = h("div", "group"); g4.append(h("span", "label", "05 · What Blaze remembers"));
    const mem = h("textarea", "field"); mem.value = S.memory || ""; mem.placeholder = "Nothing yet. Blaze saves lasting facts here as you work, or type your own.";
    const ms = h("button", "btn line", "Save"); ms.style.marginTop = "8px"; ms.onclick = async () => { await API().SetMemory(mem.value); ms.textContent = "Saved"; setTimeout(() => ms.textContent = "Save", 1200); };
    g4.append(mem, ms);

    // Skills
    const g5 = h("div", "group"); g5.append(h("span", "label", "06 · Skills"));
    const sk = h("div", "rows");
    (S.skills || []).forEach((s, i) => sk.append(h("div", "r", `<span class="n">${pad(i + 1)}</span><div class="main"><div class="s">${esc(s)}</div></div><span></span>`)));
    if (!(S.skills || []).length) sk.append(h("div", "empty", "No skills yet. Ask Blaze to save one after a task, the same SKILL.md format as the phone app."));
    g5.append(sk);

    // PC
    const g6 = h("div", "group"); g6.append(h("span", "label", "07 · This computer"), pcTable(S.info));
    const rf = h("button", "btn line", "Detect again"); rf.style.marginTop = "14px";
    rf.onclick = async () => { rf.textContent = "Detecting…"; await API().RefreshPC(); draw(); };
    g6.append(rf);
    col.append(g1, g1b, g2, g3, g4, g5, g6);
  };
  draw();
}

// ---------- doctor ----------
function doctorView(el) {
  const page = h("div", "page"); const col = h("div", "col"); page.append(col); el.append(page);
  col.append(h("div", "label acc", "Doctor"), h("h1", "", "Check everything"), h("p", "lead", "Pings each model and checks the shell, tools, disk and scheduler."));
  const rows = h("div", "rows"); const run = h("button", "btn accent", "Run checks");
  col.append(run, rows); rows.style.marginTop = "20px";
  run.onclick = async () => {
    run.disabled = true; run.textContent = "Checking…"; rows.innerHTML = "";
    const res = await API().Doctor();
    const ok = res.filter(r => r.ok).length;
    run.disabled = false; run.textContent = `${ok} of ${res.length} passed · run again`;
    res.forEach((r, i) => rows.append(h("div", "r", `<span class="n">${pad(i + 1)}</span><div class="main"><div class="t">${esc(r.name)}</div><div class="s">${esc(r.detail)}</div></div><span class="pill ${r.ok ? "acc" : ""}">${r.ok ? "OK" : "Fix"}</span>`)));
  };
  run.click();
}

// ---------- jobs ----------
function jobsView(el) {
  const page = h("div", "page"); const col = h("div", "col"); page.append(col); el.append(page);
  col.append(h("div", "label acc", "Jobs"), h("h1", "", "Background jobs"), h("p", "lead", "Servers, watchers and long builds Blaze started. They stop when you quit Blaze."));
  const box = h("div", "logbox"); const ctl = h("div", "keyrow");
  ctl.innerHTML = `<input class="field" placeholder="Job number" style="max-width:140px"><button class="btn line v">Show log</button><button class="btn line s">Stop</button><button class="btn ghost r">Refresh</button>`;
  col.append(ctl, box); box.style.marginTop = "14px";
  const id = () => parseInt($("input", ctl).value, 10) || 0;
  const all = async () => box.textContent = await API().Jobs();
  $(".v", ctl).onclick = async () => box.textContent = id() ? await API().JobLog(id()) : await API().Jobs();
  $(".s", ctl).onclick = async () => { if (id()) { box.textContent = await API().JobStop(id()); refreshJobCount(); } };
  $(".r", ctl).onclick = all; all();
}

// ---------- schedule ----------
function scheduleView(el) {
  const page = h("div", "page"); const col = h("div", "col"); page.append(col); el.append(page);
  const draw = async () => {
    col.innerHTML = "";
    col.append(h("div", "label acc", "Schedule"), h("h1", "", "Scheduled jobs"), h("p", "lead", `They run even when Blaze is closed, through ${S.info.os === "windows" ? "Task Scheduler" : "cron"}. To add one, ask in chat, e.g. "every day at 7 back up my notes folder".`));
    const list = await API().Schedules() || [];
    const rows = h("div", "rows"); const box = h("div", "logbox"); box.style.display = "none"; box.style.marginTop = "14px";
    list.forEach((j, i) => {
      const r = h("div", "r", `<span class="n">${pad(i + 1)}</span><div class="main"><div class="t">${esc(j.name)} <span class="pill">${esc(j.when)}</span></div><div class="s mono">${esc(j.command || "blaze: " + j.prompt)}</div></div>`);
      const b = h("div"); b.style.display = "flex";
      const lg = h("button", "btn ghost", "Log"); lg.onclick = async () => { box.style.display = ""; box.textContent = await API().ScheduleLog(j.name); };
      const rm = h("button", "btn ghost", "Remove"); rm.onclick = async () => { await API().RemoveSchedule(j.name); draw(); };
      b.append(lg, rm); r.append(b); rows.append(r);
    });
    if (!list.length) rows.append(h("div", "empty", "Nothing scheduled yet."));
    col.append(rows, box);
  };
  draw();
}

window.addEventListener("load", () => {
  if (window.go && window.runtime) boot();
  else document.body.innerHTML = '<p style="padding:40px;font-family:monospace">Blaze UI needs the desktop app.</p>';
});
