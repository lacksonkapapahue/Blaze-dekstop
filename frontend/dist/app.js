// Blaze Desktop UI. Talks to Go through window.go.main.App and Wails events.
const API = () => window.go.main.App;
const on = (ev, fn) => window.runtime.EventsOn(ev, fn);
const $ = (s, el = document) => el.querySelector(s);
const h = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const esc = s => MD.esc(String(s ?? ""));
const pad = n => String(n).padStart(2, "0");
const base = p => (p || "").split(/[\\/]/).filter(Boolean).pop() || p;

let S = null;          // State from Go
let view = "work";     // current main view
let tab = "work";      // last chat tab: work | design
let busy = false;
let current = null;    // the Blaze turn being streamed
let convId = "";
let attachments = [];  // @ files for the next message
let pane = null;       // the chat pane (log + composer), moved between Work and Design

// ---------- theme ----------
function applyTheme() {
  const t = S?.prefs?.theme || "system";
  const dark = t === "dark" || (t === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
}
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", applyTheme);

// ---------- boot ----------
async function boot() {
  // Go's startup runs alongside page load, so keep asking until the backend answers.
  for (let i = 0; i < 40 && !S; i++) {
    try { S = await API().State(); } catch (e) { await new Promise(r => setTimeout(r, 250)); }
  }
  if (!S) { $("#view").innerHTML = '<div class="page"><div class="col"><div class="label acc">Blaze</div><h1>Blaze couldn\'t start.</h1><p class="lead">The app\'s backend didn\'t answer. Quit Blaze and open it again.</p></div></div>'; return; }
  applyTheme();
  pane = buildPane();
  setFolder(S.prefs.folder);
  setModel(S.model);
  await refreshSide();
  hero();
  show(S.setup_done ? "work" : "setup");
  setInterval(refreshJobCount, 4000);
  if (!S.prefs.no_update_check) setTimeout(() => checkUpdate(true), 3000);
}

// ---------- updates ----------
let UPD = null;          // last CheckUpdate result
let updBusy = false;
const updText = t => document.querySelectorAll(".updstatus").forEach(e => e.textContent = t);
on("update", p => updText(p.text || ""));

async function checkUpdate(auto) {
  let u = null;
  try { u = await API().CheckUpdate(); } catch (e) { u = { error: String(e) }; }
  if (!u || typeof u !== "object") return null;
  UPD = u;
  $("#updCount").textContent = u.available && !u.skipped ? "NEW" : "";
  if (auto && u.available && !u.skipped && S.setup_done) updateCard();
  return u;
}

function updateCard() {
  const u = UPD; if (!u || $("#log .col .updcard", pane)) return;
  const card = h("div", "card confirm updcard", `<div class="label acc title">Update ready</div>
    <div>Blaze <span class="mono ink">${esc(u.latest)}</span> is out. You have <span class="mono">${esc(u.current)}</span>.</div>
    <div class="s" style="margin-top:6px">${esc(u.method || "")}</div><div class="label weak updstatus" style="margin-top:8px"></div>
    <div class="actions"><button class="btn accent yes">${u.can_auto ? "Update now" : "Open release page"}</button><button class="btn line no">Later</button><button class="btn ghost skip">Skip this version</button></div>`);
  card.querySelector(".yes").onclick = () => u.can_auto ? installUpdate(card) : API().OpenURL(u.page);
  card.querySelector(".no").onclick = () => card.remove();
  card.querySelector(".skip").onclick = async () => { await API().SkipUpdate(u.latest); UPD.skipped = true; $("#updCount").textContent = ""; card.remove(); };
  $("#log .col", pane).append(card); scrollDown(true);
}

async function installUpdate(box) {
  if (updBusy || busy) { updText(busy ? "Finish or stop the current task first." : "Already updating…"); return; }
  updBusy = true;
  box.querySelectorAll("button").forEach(b => b.disabled = true);
  updText("Starting the download…");
  let err = "";
  try { err = await API().InstallUpdate(); } catch (e) { err = String(e); }
  if (err) { updText(err); box.querySelectorAll("button").forEach(b => b.disabled = false); updBusy = false; }
}

function setFolder(path) {
  const home = S.info.home;
  let p = path || "";
  if (home && p.startsWith(home)) p = "~" + p.slice(home.length);
  $("#folderName").textContent = p || "~";
}
function setModel(m) { $("#route").textContent = m || "No model"; }

$("#folder").onclick = async () => { const d = await API().PickFolder(); S.prefs.folder = d; setFolder(d); };
$("#route").onclick = () => { show(tab); openMenu("model"); };
$("#newChat").onclick = () => newChat();
$("#newProject").onclick = () => newProject();
document.querySelectorAll(".nav").forEach(b => b.onclick = () => show(b.dataset.view));
document.querySelectorAll("#tabs button").forEach(b => b.onclick = () => show(b.dataset.tab));

async function newChat() {
  if (busy) return;
  await API().NewConversation(); convId = ""; attachments = []; drawAttach();
  hero(); show(tab === "design" ? "design" : "work"); refreshSide();
}

// Links open in the system browser; code copy; step toggles.
document.addEventListener("click", e => {
  const a = e.target.closest("a[data-href]");
  if (a) { e.preventDefault(); API().OpenURL(a.dataset.href); }
  const c = e.target.closest(".copy");
  if (c) { navigator.clipboard.writeText(c.closest(".code").querySelector("pre").textContent); c.textContent = "Copied"; setTimeout(() => c.textContent = "Copy", 1200); }
  const st = e.target.closest(".step .head");
  if (st) st.parentElement.classList.toggle("open");
  if (!e.target.closest("#menu") && !e.target.closest("#plus") && !e.target.closest("#route")) closeMenu();
});

// ---------- sidebar ----------
async function refreshSide() {
  S.project = (await API().State()).project;
  const pid = S.project ? S.project.id : "";
  const projects = await API().Projects() || [];
  const pn = $("#projects"); pn.innerHTML = "";
  const item = (id, name, sub) => {
    const b = h("button", "chat proj" + (id === pid ? " on" : ""), `<span class="sq"></span><span class="t">${esc(name)}</span>`);
    b.title = sub || "";
    b.onclick = async () => {
      if (busy) return;
      if (id !== pid) { const p = await API().OpenProject(id); convId = ""; if (p.folder) { S.prefs.folder = p.folder; setFolder(p.folder); } hero(); await refreshSide(); }
      if (id) show("project", id); else show("work");
    };
    pn.append(b);
  };
  item("", "General", "Chats without a project");
  projects.forEach(p => item(p.id, p.name, p.folder));

  $("#chatsLabel").textContent = "Chats · " + (S.project ? S.project.name : "General");
  const list = await API().Conversations(pid) || [];
  const nav = $("#chats"); nav.innerHTML = "";
  if (!list.length) nav.append(h("div", "label weak none", "No chats yet"));
  list.forEach(c => {
    const b = h("button", "chat" + (c.id === convId && (view === "work" || view === "design") ? " on" : ""), `<span class="t">${esc(c.title)}</span><span class="x" title="Delete">×</span>`);
    b.onclick = async e => {
      if (e.target.classList.contains("x")) { await API().DeleteConversation(c.id); if (c.id === convId) { convId = ""; hero(); } refreshSide(); return; }
      if (busy) return;
      openChat(c.id);
    };
    nav.append(b);
  });
}

async function openChat(id) {
  const conv = await API().OpenConversation(id);
  convId = id;
  if (conv.folder) { S.prefs.folder = conv.folder; setFolder(conv.folder); }
  loadConv(conv);
  show(tab === "design" ? "design" : "work");
  refreshSide();
}

async function refreshJobCount() {
  const t = await API().Jobs();
  const n = (t.match(/\[running/g) || []).length;
  $("#jobCount").textContent = n ? pad(n) : "";
}

// ---------- views ----------
function show(v, arg) {
  if (v === "chat") v = "work";
  view = v;
  if (v === "work" || v === "design") tab = v;
  document.querySelectorAll(".nav").forEach(b => b.classList.toggle("on", b.dataset.view === v));
  document.querySelectorAll("#tabs button").forEach(b => b.classList.toggle("on", b.dataset.tab === v));
  $("#tabs").classList.toggle("dim", v !== "work" && v !== "design");
  if (v === "design") $("#designDot").className = "";
  const el = $("#view"); pane.remove(); el.innerHTML = ""; closeMenu();
  ({ work: workView, design: designView, setup: setupView, settings: settingsView, doctor: doctorView, jobs: jobsView, schedule: scheduleView, project: projectView, newproject: newProjectView })[v](el, arg);
  document.querySelectorAll("#chats .chat").forEach(b => b.classList.remove("on"));
}

function workView(el) {
  pane.classList.remove("narrow");
  el.append(pane);
  scrollDown(true);
  $("#input").focus();
}

// ---------- chat pane ----------
function buildPane() {
  const p = h("div", "chatpane");
  p.innerHTML = `<div id="log"><div class="col"></div></div>
  <div id="composer"><div class="cwrap">
    <div id="menu" class="menu" style="display:none"></div>
    <div id="attach" class="attach"></div>
    <div class="inbox">
      <button id="plus" class="plusbtn" title="Commands and files">+</button>
      <textarea id="input" rows="1" placeholder="Ask Blaze · / commands · @ files"></textarea>
    </div>
    <div class="row">
      <span class="label weak" id="hint">/ commands · @ files · Shift+Enter new line</span>
      <span class="grow"></span>
      <label class="toggle" title="Auto-approve risky actions (deletes still ask)"><input type="checkbox" id="yolo"><span class="label">Auto-approve</span></label>
      <button id="send" class="btn accent">Send</button>
    </div></div></div>`;
  const input = $("#input", p), yolo = $("#yolo", p);
  yolo.checked = !!S.yolo;
  yolo.onchange = () => { S.yolo = yolo.checked; API().SetYolo(yolo.checked); };
  input.addEventListener("input", () => { grow(); onType(); });
  input.addEventListener("keydown", onKey);
  $("#send", p).onclick = () => busy ? API().Stop() : submit();
  $("#plus", p).onclick = () => menuOpen() ? closeMenu() : openMenu("root");
  return p;
}
function grow() { const i = $("#input"); i.style.height = "auto"; i.style.height = Math.min(i.scrollHeight, 220) + "px"; }

function hero() {
  const col = $("#log .col", pane); col.innerHTML = "";
  const os = S.info.os_name || "your computer";
  const where = S.project ? S.project.name : os;
  const box = h("div", "hero");
  box.innerHTML = `<div class="label acc">Blaze · ${esc(where)}</div><div class="big" style="margin-top:10px">What should we <em>get done</em>?</div>
    <p class="lead" style="margin-top:12px">Blaze runs commands, edits files here, writes code, uses git and the web. Designs open live in the Design tab. Type <span class="kbd">/</span> for commands or <span class="kbd">@</span> to attach a file.</p>`;
  const sug = h("div", "suggest");
  [["Explore", "What's in this folder? Give me a short tour."],
   ["Fix", "Run the tests here and fix whatever fails."],
   ["Design", "Suggest 3 directions for a clean landing page for this project."],
   ["System", "How much disk space is left, and what's using the most?"]].forEach(([k, t]) => {
    const b = h("button", "", `<span class="label">${k}</span>${esc(t)}`);
    b.onclick = () => { $("#input").value = t; submit(); };
    sug.append(b);
  });
  box.append(sug); col.append(box);
}

function loadConv(conv) {
  const col = $("#log .col", pane); col.innerHTML = "";
  if (!conv || !conv.messages || !conv.messages.length) { hero(); return; }
  let turn = null;
  const results = {};
  conv.messages.forEach(m => { if (m.role === "tool") results[m.tool_call_id] = m.content; });
  conv.messages.forEach(m => {
    if (m.role === "user") { col.append(userMsg(m.content)); turn = null; }
    else if (m.role === "assistant") {
      if (!turn) { turn = blazeMsg(); col.append(turn.el); }
      (m.tool_calls || []).forEach(tc => { const s = addStep(turn, tc.id, tc.function.name, tc.function.arguments); finishStep(s, results[tc.id] || ""); });
      if (m.content) { turn.text += (turn.text ? "\n\n" : "") + m.content; turn.mdEl.innerHTML = MD.render(turn.text); }
    }
  });
  scrollDown(true);
}

// User bubbles hide attached file bodies and long design-edit context.
function userMsg(content) {
  const files = [];
  let text = content.replace(/\n*<attached path="([^"]*)">[\s\S]*?<\/attached>/g, (_, p) => { files.push(p); return ""; });
  const m = h("div", "msg user");
  if (text.startsWith("[Design edit]")) {
    const act = (text.match(/^\[Design edit\] (.*)/) || [])[1] || "Edit";
    const req = (text.match(/\nRequest: ([\s\S]*)$/) || [])[1] || "";
    const tags = [...text.matchAll(/\nElement: (.*)/g)].map(x => x[1]);
    m.append(h("div", "bubble", `<span class="label acc">${esc(act)}</span> ${esc(req)}<div class="chips">${tags.map(t => `<span class="fchip">${esc(t.length > 40 ? "…" + t.slice(-40) : t)}</span>`).join("")}</div>`));
  } else {
    const b = h("div", "bubble", esc(text));
    if (files.length) b.append(h("div", "chips", files.map(f => `<span class="fchip">@ ${esc(f)}</span>`).join("")));
    m.append(b);
  }
  return m;
}

function blazeMsg() {
  const el = h("div", "msg blaze");
  el.append(h("div", "who label", "Blaze"));
  const stepsEl = h("div", "steps"); stepsEl.style.display = "none";
  const mdEl = h("div", "md");
  el.append(stepsEl, mdEl);
  return { el, stepsEl, mdEl, text: "", steps: {} };
}

function scrollDown(force) {
  const log = $("#log", pane); if (!log) return;
  if (force || log.scrollHeight - log.scrollTop - log.clientHeight < 160) log.scrollTop = log.scrollHeight;
}

function setBusy(b) {
  busy = b;
  const send = $("#send", pane);
  send.textContent = b ? "Stop" : "Send";
  send.classList.toggle("accent", !b); send.classList.toggle("line", b);
  $("#hint", pane).textContent = b ? "Working… Stop ends the task" : "/ commands · @ files · Shift+Enter new line";
}

let thinkingEl = null;
function thinking(onOff, text) {
  if (thinkingEl) { thinkingEl.remove(); thinkingEl = null; }
  if (onOff && current) {
    thinkingEl = h("div", "thinking label", `<span class="sq"></span><span>${esc(text || "Thinking")}</span>`);
    current.el.append(thinkingEl); scrollDown();
  }
}

function submit() {
  const input = $("#input", pane);
  const text = input.value.trim();
  if (!text || busy) return;
  if (/^\/\S+$/.test(text)) { const c = matchCommands(text.slice(1))[0]; if (c) { input.value = ""; runCommand(c); return; } }
  input.value = ""; grow();
  sendText(text, attachments.slice());
  attachments = []; drawAttach();
}

async function sendText(text, files) {
  if (busy) return;
  const col = $("#log .col", pane);
  const heroEl = $(".hero", col); if (heroEl) heroEl.remove();
  col.append(userMsg(text + (files || []).map(f => `\n<attached path="${f}"></attached>`).join("")));
  current = blazeMsg(); col.append(current.el);
  setBusy(true); thinking(true);
  scrollDown(true);
  const r = await API().Send(text, files || []);
  if (r === "busy") setBusy(true);
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
  s.dataset.tool = name;
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

// ---------- events from Go ----------
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
  if (current.text) current.text += "\n\n";
  addStep(current, t.id, t.name, t.args);
  thinking(true, describe(t.name, t.args));
  scrollDown();
});
on("tool_done", t => {
  if (!current) return;
  const s = current.steps[t.id];
  finishStep(s, t.result);
  if (view === "design" && s && /^file_(write|edit)$/.test(s.dataset.tool)) reloadPreview();
});
on("confirm", c => {
  thinking(false);
  const card = h("div", "card confirm", `<div class="label acc title">${esc(c.title)}</div><div class="detail">${esc(c.detail)}</div>
    <div class="actions"><button class="btn accent yes">Yes, do it</button><button class="btn line no">No</button></div>`);
  const done = yes => { API().Answer(c.id, yes); card.classList.add("done"); card.querySelector(".actions").innerHTML = `<span class="label">${yes ? "Approved" : "Declined"}</span>`; thinking(true); };
  card.querySelector(".yes").onclick = () => done(true);
  card.querySelector(".no").onclick = () => done(false);
  (current ? current.el : $("#log .col", pane)).append(card);
  scrollDown(true);
});
on("done", d => {
  thinking(false);
  if (current) current.el.append(h("div", "route label weak", `${esc(d.route)} · ${d.seconds.toFixed(1)}s`));
  setModel(d.route);
  current = null; setBusy(false); scrollDown(); refreshSide();
});
on("error", msg => {
  thinking(false);
  const target = current ? current.el : $("#log .col", pane);
  target.append(h("div", "card err", `<div class="label ink title">Couldn't finish</div><div class="md">${MD.render(msg)}</div>`));
  current = null; setBusy(false); scrollDown(true); refreshSide();
});
on("stopped", () => {
  thinking(false);
  if (current) current.el.append(h("div", "route label weak", "Stopped"));
  current = null; setBusy(false); refreshSide();
});
on("design", d => {
  if (view === "design") { drawDesign(); return; }
  const mode = S.prefs.design_mode || "ask";
  if (mode === "always") { show("design"); return; }
  $("#designDot").className = "dotnew";
  if (mode === "never") return;
  const what = d.target.kind === "url" ? d.target.url : d.target.path;
  const card = h("div", "card confirm", `<div class="label acc title">Design ready</div><div>Preview <span class="mono ink">${esc(what || "the design")}</span> live, with versions and point-to-edit.</div>
    <div class="actions"><button class="btn accent yes">Open Design</button><button class="btn line no">Not now</button><button class="btn ghost al">Always open</button></div>`);
  card.querySelector(".yes").onclick = () => { card.remove(); show("design"); };
  card.querySelector(".no").onclick = () => card.remove();
  card.querySelector(".al").onclick = async () => { await API().SetDesignMode("always"); S.prefs.design_mode = "always"; card.remove(); show("design"); };
  $("#log .col", pane).append(card); scrollDown(true);
});

// ---------- command menu ----------
const COMMANDS = [
  { name: "new", desc: "Start a new chat", run: () => newChat() },
  { name: "model", desc: "See or switch the AI model", sub: async () => (await API().Models() || []).map((m, i) => ({ name: m.name, desc: m.model + (i === 0 ? " · in use" : ""), run: async () => setModel(await API().UseModel(m.provider)) })).concat([{ name: "Add a model…", desc: "Settings › models", run: () => show("settings") }]) },
  { name: "project", desc: "Switch project or make a new one", sub: async () => [{ name: "General", desc: "No project", run: () => switchProject("") }].concat((await API().Projects() || []).map(p => ({ name: p.name, desc: p.folder, run: () => switchProject(p.id) }))).concat([{ name: "New project…", desc: "Pick a folder", run: () => newProject() }]) },
  { name: "folder", desc: "Change the working folder", run: () => $("#folder").click() },
  { name: "design", desc: "Open the Design tab", run: () => show("design") },
  { name: "work", desc: "Back to the Work tab", run: () => show("work") },
  { name: "attach", desc: "Attach a project file (or type @)", run: () => { const i = $("#input"); i.value += (i.value && !i.value.endsWith(" ") ? " " : "") + "@"; i.focus(); onType(); } },
  { name: "retry", desc: "Ask the last message again", run: () => retry() },
  { name: "stop", desc: "Stop the current task", run: () => API().Stop() },
  { name: "clear", desc: "Clear this chat and start fresh", run: () => newChat() },
  { name: "skills", desc: "Use one of your skills", sub: async () => { const s = (await API().State()).skills || []; return s.length ? s.map(x => ({ name: x.split(":")[0], desc: x.split(":").slice(1).join(":").trim(), run: () => { const i = $("#input"); i.value = `Use the ${x.split(":")[0]} skill: `; i.focus(); } })) : [{ name: "No skills yet", desc: "Ask Blaze to save one after a task", run: () => {} }]; } },
  { name: "auto-approve", desc: "Toggle auto-approve for risky actions", run: () => { const y = $("#yolo", pane); y.checked = !y.checked; y.onchange(); } },
  { name: "theme", desc: "System, light or dark", sub: async () => ["system", "light", "dark"].map(t => ({ name: t, desc: t === S.prefs.theme ? "current" : "", run: async () => { await API().SetTheme(t); S.prefs.theme = t; applyTheme(); } })) },
  { name: "jobs", desc: "Background jobs and their logs", run: () => show("jobs") },
  { name: "schedule", desc: "Scheduled jobs", run: () => show("schedule") },
  { name: "doctor", desc: "Check models, shell and tools", run: () => show("doctor") },
  { name: "memory", desc: "What Blaze remembers about you", run: () => show("settings", "memory") },
  { name: "settings", desc: "Models, behaviour, appearance", run: () => show("settings") },
  { name: "update", desc: "Check for a new version of Blaze", run: () => show("settings", "updates") },
];

let menu = { items: [], idx: 0, kind: "" };
const menuOpen = () => $("#menu") && $("#menu").style.display !== "none";
function matchCommands(q) { q = q.toLowerCase(); return COMMANDS.filter(c => c.name.startsWith(q)).concat(COMMANDS.filter(c => !c.name.startsWith(q) && (c.name.includes(q) || c.desc.toLowerCase().includes(q)))); }
function closeMenu() { const m = $("#menu"); if (m) m.style.display = "none"; menu.kind = ""; }

async function openMenu(kind, items, title) {
  if (kind === "root") items = COMMANDS.map(c => ({ ...c, slash: true }));
  if (kind === "model") { items = await COMMANDS[1].sub(); title = "Model"; }
  menu = { items: items || [], idx: 0, kind, title };
  drawMenu();
}

function drawMenu() {
  const m = $("#menu");
  if (!menu.items.length) { closeMenu(); return; }
  m.innerHTML = (menu.title ? `<div class="mhead label">${esc(menu.title)}</div>` : "") +
    menu.items.slice(0, 40).map((it, i) => `<button class="mi ${i === menu.idx ? "on" : ""}" data-i="${i}"><span class="mn">${it.slash ? "/" : ""}${esc(it.name)}${it.sub ? " ›" : ""}</span><span class="md2">${esc(it.desc || "")}</span></button>`).join("") +
    `<div class="mfoot label weak">↑↓ move · Enter pick · Esc close</div>`;
  m.style.display = "";
  m.querySelectorAll(".mi").forEach(b => { b.onmouseenter = () => { menu.idx = +b.dataset.i; m.querySelectorAll(".mi").forEach(x => x.classList.toggle("on", x === b)); }; b.onclick = () => pickMenu(+b.dataset.i); });
  const sel = m.querySelector(".mi.on"); if (sel) sel.scrollIntoView({ block: "nearest" });
}

async function pickMenu(i) {
  const it = menu.items[i]; if (!it) return;
  const input = $("#input");
  if (menu.kind === "file") {
    input.value = input.value.replace(/(^|\s)@[^\s]*$/, "$1");
    if (!attachments.includes(it.name)) attachments.push(it.name);
    drawAttach(); closeMenu(); input.focus(); return;
  }
  if (menu.kind === "cmd" || menu.kind === "root") input.value = "";
  if (it.sub) { openMenu("sub", await it.sub(), it.name); return; }
  closeMenu(); grow();
  await it.run();
  if (view === "work" || view === "design") input.focus();
}

let filesCache = null, filesAt = 0;
async function onType() {
  const input = $("#input"), v = input.value.slice(0, input.selectionStart);
  if (/^\/\S*$/.test(v) && input.value === v) { openMenu("cmd", matchCommands(v.slice(1)).map(c => ({ ...c, slash: true }))); return; }
  const at = v.match(/(?:^|\s)@([^\s]*)$/);
  if (at) {
    if (!filesCache || Date.now() - filesAt > 15000) { filesCache = await API().Files() || []; filesAt = Date.now(); }
    const q = at[1].toLowerCase();
    const hits = filesCache.filter(f => f.toLowerCase().includes(q)).sort((a, b) => (base(a).toLowerCase().startsWith(q) ? 0 : 1) - (base(b).toLowerCase().startsWith(q) ? 0 : 1)).slice(0, 30);
    openMenu("file", hits.length ? hits.map(f => ({ name: f, desc: "" })) : [], hits.length ? "Attach a file" : "");
    if (!hits.length) { $("#menu").innerHTML = `<div class="mhead label">No matching files in this folder</div>`; $("#menu").style.display = ""; }
    return;
  }
  if (menu.kind === "cmd" || menu.kind === "file") closeMenu();
}

function onKey(e) {
  if (menuOpen() && menu.items.length) {
    if (e.key === "ArrowDown") { e.preventDefault(); menu.idx = (menu.idx + 1) % Math.min(menu.items.length, 40); drawMenu(); return; }
    if (e.key === "ArrowUp") { e.preventDefault(); menu.idx = (menu.idx - 1 + Math.min(menu.items.length, 40)) % Math.min(menu.items.length, 40); drawMenu(); return; }
    if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); pickMenu(menu.idx); return; }
  }
  if (e.key === "Escape") { closeMenu(); return; }
  if (e.key === "Backspace" && !e.target.value && attachments.length) { attachments.pop(); drawAttach(); return; }
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); }
}

function drawAttach() {
  const a = $("#attach", pane); a.innerHTML = "";
  attachments.forEach((f, i) => { const c = h("span", "fchip", `@ ${esc(f)} <button title="Remove">×</button>`); $("button", c).onclick = () => { attachments.splice(i, 1); drawAttach(); }; a.append(c); });
}

async function retry() {
  if (busy) return;
  const col = $("#log .col", pane);
  const msgs = col.querySelectorAll(".msg");
  const last = msgs[msgs.length - 1];
  if (last && last.classList.contains("blaze")) last.remove();
  current = blazeMsg(); col.append(current.el);
  setBusy(true); thinking(true);
  const r = await API().Retry();
  if (r !== "ok") { current.el.remove(); current = null; setBusy(r === "busy"); }
}

async function switchProject(id) {
  if (busy) return;
  const p = await API().OpenProject(id); convId = "";
  if (p.folder) { S.prefs.folder = p.folder; setFolder(p.folder); }
  await refreshSide(); hero();
  if (id) show("project", id); else show("work");
}

// ---------- projects ----------
async function newProject() {
  const folder = await API().ChooseFolder();
  if (folder) show("newproject", folder);
}

function newProjectView(el, folder) {
  const page = h("div", "page"); const col = h("div", "col"); page.append(col); el.append(page);
  col.append(h("div", "label acc", "New project"), h("h1", "", "Set up the project"), h("p", "lead", "A project keeps its own chats and instructions, and Blaze always works in its folder."));
  const g = h("div", "group");
  g.innerHTML = `<span class="label">01 · Folder</span><div class="mono ink" style="margin-bottom:18px">${esc(folder)}</div>
    <span class="label">02 · Name</span><input class="field nm" value="${esc(base(folder))}" style="margin-bottom:18px">
    <span class="label">03 · Instructions <span class="weak">optional</span></span><textarea class="field ins" placeholder="Anything Blaze should always follow here, e.g. 'TypeScript, pnpm, Tailwind. Run pnpm test before saying done.'"></textarea>`;
  const row = h("div", "actions"); row.style.cssText = "display:flex;gap:8px;margin-top:20px";
  const ok = h("button", "btn accent", "Create project"), cancel = h("button", "btn line", "Cancel");
  ok.onclick = async () => {
    try {
      const p = await API().CreateProject(folder, $(".nm", g).value);
      await API().UpdateProject(p.id, $(".nm", g).value, $(".ins", g).value);
      S.prefs.folder = p.folder; setFolder(p.folder); convId = ""; hero(); await refreshSide(); show("project", p.id);
    } catch (e) { ok.textContent = String(e); }
  };
  cancel.onclick = () => show(tab);
  row.append(ok, cancel); col.append(g, row);
}

async function projectView(el, id) {
  const page = h("div", "page"); const col = h("div", "col"); page.append(col); el.append(page);
  const d = await API().ProjectDetails(id);
  const p = d.project;
  col.append(h("div", "label acc", "Project"), h("h1", "", esc(p.name)), h("p", "lead mono", esc(p.folder)));
  const actions = h("div"); actions.style.cssText = "display:flex;gap:8px;margin-bottom:24px";
  const nc = h("button", "btn accent", "New chat"); nc.onclick = () => newChat();
  const ds = h("button", "btn line", "Open Design"); ds.onclick = () => show("design");
  actions.append(nc, ds); col.append(actions);

  const g1 = h("div", "group"); g1.append(h("span", "label", "01 · Chats"));
  const rows = h("div", "rows");
  (d.chats || []).forEach((c, i) => { const r = h("div", "r click", `<span class="n">${pad(i + 1)}</span><div class="main"><div class="t">${esc(c.title)}</div></div><span class="label weak">${esc(c.updated)}</span>`); r.onclick = () => openChat(c.id); rows.append(r); });
  if (!(d.chats || []).length) rows.append(h("div", "empty", "No chats in this project yet."));
  g1.append(rows);

  const g2 = h("div", "group"); g2.append(h("span", "label", "02 · Instructions Blaze always follows here"));
  const nm = h("input", "field"); nm.value = p.name; nm.style.marginBottom = "8px";
  const ins = h("textarea", "field"); ins.value = p.instructions || ""; ins.placeholder = "e.g. Python 3.12 with uv. Keep functions small. Never push to main.";
  const sv = h("button", "btn line", "Save"); sv.style.marginTop = "8px";
  sv.onclick = async () => { await API().UpdateProject(p.id, nm.value, ins.value); sv.textContent = "Saved"; setTimeout(() => sv.textContent = "Save", 1200); refreshSide(); };
  g2.append(nm, ins, sv);

  const g3 = h("div", "group"); g3.append(h("span", "label", "03 · Git"));
  g3.append(d.branch ? h("div", "", `<div class="ink" style="margin-bottom:8px">Branch <span class="mono acc2">${esc(d.branch)}</span></div><div class="logbox">${esc(d.status)}</div>`) : h("div", "empty", "Not a git repository."));

  const g4 = h("div", "group"); g4.append(h("span", "label", "04 · Recently changed files"));
  const fr = h("div", "rows");
  (d.recent || []).forEach((f, i) => {
    const r = h("div", "r click", `<span class="n">${pad(i + 1)}</span><div class="main"><div class="t mono small">${esc(f.path)}</div></div><span class="label weak">${esc(f.when)}</span>`);
    r.title = "Attach to a new message"; r.onclick = () => { attachments = [f.path]; drawAttach(); show("work"); };
    fr.append(r);
  });
  if (!(d.recent || []).length) fr.append(h("div", "empty", "No files yet."));
  g4.append(fr);

  const g5 = h("div", "group");
  const del = h("button", "btn ghost", "Remove project");
  del.onclick = async () => { if (del.dataset.sure) { await API().DeleteProject(p.id); await refreshSide(); hero(); show("work"); } else { del.dataset.sure = 1; del.textContent = "Remove it and its chats? Files stay on disk. Click again"; } };
  g5.append(del);
  col.append(g1, g2, g3, g4, g5);
}

// ---------- design ----------
let D = null;            // DesignView from Go
let viewing = 0;         // version being viewed (0 = live)
let compare = [];        // versions picked to compare
let device = "desktop", selectOn = false, selection = null, frameTheme = "light";

function designView(el) {
  const wrap = h("div", "design");
  wrap.innerHTML = `<div class="dmain">
      <div class="dbar">
        <select id="dtarget" class="field sel"></select>
        <div class="seg" id="ddev"><button data-d="desktop">Desktop</button><button data-d="tablet">Tablet</button><button data-d="phone">Phone</button></div>
        <div class="seg" id="dtheme"><button data-t="light">Light</button><button data-t="dark">Dark</button></div>
        <span class="grow"></span>
        <button id="dselect" class="btn line sm">Select</button>
        <button id="ddirs" class="btn line sm">Directions</button>
        <button id="dopen" class="btn ghost sm">Open ↗</button>
      </div>
      <div class="dstage" id="dstage"></div>
      <div class="dstrip"><div class="dstriphead"><span class="label">Versions</span><span class="grow"></span><label class="toggle"><input type="checkbox" id="dcmp"><span class="label">Compare</span></label></div><div id="dversions" class="dversions"></div></div>
    </div>
    <div class="dside"></div>`;
  el.append(wrap);
  pane.classList.add("narrow");
  $(".dside", wrap).append(pane);
  $("#ddev").querySelectorAll("button").forEach(b => b.onclick = () => { device = b.dataset.d; drawStage(); });
  $("#dtheme").querySelectorAll("button").forEach(b => b.onclick = () => { frameTheme = b.dataset.t; drawStage(); });
  $("#dselect").onclick = () => { selectOn = !selectOn; drawStage(); };
  $("#ddirs").onclick = () => directions();
  $("#dopen").onclick = () => API().OpenPreview(viewing);
  $("#dcmp").onchange = e => { compare = e.target.checked ? [] : []; drawVersions(); drawStage(); };
  $("#dtarget").onchange = async e => {
    const v = e.target.value;
    if (v === "__url") { urlPrompt(); return; }
    D = await API().SetDesignTarget("file", v); viewing = 0; drawDesign();
  };
  drawDesign();
}

async function drawDesign() {
  if (view !== "design") return;
  D = await API().Design();
  const sel = $("#dtarget"); if (!sel) return;
  const t = D.target || {};
  const opts = (D.files || []).map(f => `<option value="${esc(f)}" ${t.kind === "file" && t.path === f ? "selected" : ""}>${esc(f)}</option>`);
  if (t.kind === "url") opts.unshift(`<option selected>${esc(t.url)}</option>`);
  if (!t.kind) opts.unshift(`<option selected disabled>Pick what to preview</option>`);
  opts.push(`<option value="__url">Local server URL…</option>`);
  sel.innerHTML = opts.join("");
  drawVersions(); drawStage();
}

function urlPrompt() {
  const st = $("#dstage");
  st.innerHTML = `<div class="dempty"><div class="label acc">Local server</div><p class="lead">The address your dev server prints, e.g. localhost:5173</p><div class="keyrow"><input class="field" id="durl" placeholder="http://localhost:5173"><button class="btn accent" id="durlok">Preview</button></div></div>`;
  $("#durlok").onclick = async () => { D = await API().SetDesignTarget("url", $("#durl").value.trim()); viewing = 0; drawDesign(); };
}

function frameURL(n) {
  const t = D.target || {};
  let u = D.base + "/" + (t.kind === "file" ? t.path.split("/").map(encodeURIComponent).join("/") : "");
  const q = [];
  if (n) q.push("__v=" + n);
  if (t.kind === "file" && /\.svg$/i.test(t.path)) q.push("wrap=1");
  q.push("t=" + Date.now());
  return u + "?" + q.join("&");
}

function drawStage() {
  const st = $("#dstage"); if (!st) return;
  document.querySelectorAll("#ddev button").forEach(b => b.classList.toggle("on", b.dataset.d === device));
  document.querySelectorAll("#dtheme button").forEach(b => b.classList.toggle("on", b.dataset.t === frameTheme));
  $("#dselect").classList.toggle("accent", selectOn); $("#dselect").classList.toggle("line", !selectOn);
  $("#dselect").textContent = selectOn ? "Selecting · Esc" : "Select";
  st.innerHTML = "";
  if (!D || !D.target || !D.target.kind) {
    st.innerHTML = `<div class="dempty"><div class="label acc">Design</div><div class="big2">Nothing to preview yet.</div><p class="lead">Ask for something visual in the chat and it shows up here live, version by version. Or pick a file or local server above.</p></div>`;
    const b = h("button", "btn accent", "Suggest 3 directions"); b.onclick = () => directions(); $(".dempty", st).append(b);
    return;
  }
  const isUrl = D.target.kind === "url";
  if (viewing && !isUrl) {
    const v = (D.versions || []).find(x => x.n === viewing);
    const bar = h("div", "viewing", `<span class="label acc">Viewing ${pad(viewing)}</span><span class="sub">${esc(v ? v.summary : "")}</span><span class="grow"></span>`);
    const rs = h("button", "btn accent sm", "Restore this"); rs.onclick = async () => { const r = await API().RestoreVersion(viewing); if (r !== "ok") rs.textContent = r; else { viewing = 0; drawDesign(); } };
    const lv = h("button", "btn line sm", "Back to live"); lv.onclick = () => { viewing = 0; drawStage(); drawVersions(); };
    bar.append(rs, lv); st.append(bar);
  }
  const frames = h("div", "frames");
  const list = compare.length === 2 ? compare : [viewing];
  list.forEach(n => {
    const box = h("div", "fbox " + device);
    if (compare.length === 2) box.prepend(h("div", "label fcap", n ? "Version " + pad(n) : "Live"));
    const f = h("iframe", "pframe"); f.src = frameURL(n);
    f.onload = () => { f.contentWindow.postMessage({ blaze: "mode", on: selectOn && compare.length !== 2 }, "*"); f.contentWindow.postMessage({ blaze: "theme", value: frameTheme }, "*"); };
    box.append(f); frames.append(box);
  });
  st.append(frames);
  if (selection && selectOn) drawSelBar();
}

function reloadPreview() {
  clearTimeout(reloadPreview.t);
  reloadPreview.t = setTimeout(() => { if (view === "design" && !viewing) { selection = null; drawStage(); } }, 400);
}

function drawVersions() {
  const box = $("#dversions"); if (!box || !D) return;
  box.innerHTML = "";
  const vs = (D.versions || []).slice().reverse();
  if (!vs.length) { box.append(h("div", "label weak", "Each change Blaze makes is saved here as a version.")); return; }
  const cmp = $("#dcmp").checked;
  vs.forEach((v, i) => {
    const t = h("button", "vtile" + ((viewing === v.n && !cmp) || compare.includes(v.n) ? " on" : ""));
    const thumb = h("div", "vthumb");
    if (i < 6 && D.target.kind === "file") { const f = h("iframe"); f.src = frameURL(v.n); f.tabIndex = -1; thumb.append(f); }
    t.append(thumb, h("div", "vcap", `<span class="label acc">${pad(v.n)}</span> <span>${esc(v.summary || "Change")}</span>`));
    t.title = v.when;
    t.onclick = () => {
      if (cmp) { compare = compare.includes(v.n) ? compare.filter(x => x !== v.n) : compare.concat(v.n).slice(-2); }
      else { viewing = D.target.kind === "url" ? 0 : v.n; if (D.target.kind === "url") { API().RestoreVersion(v.n).then(drawDesign); return; } }
      drawVersions(); drawStage();
    };
    box.append(t);
  });
}

function directions() {
  const t = D && D.target && D.target.kind ? (D.target.path || D.target.url) : "";
  show("design");
  $("#input").value = t
    ? `Suggest 3 clearly different design directions for ${t}, as separate files design/option-a.html, option-b.html and option-c.html. One line on each.`
    : "Suggest 3 clearly different design directions for a page for this project, as self-contained files design/option-a.html, option-b.html and option-c.html. One line on each.";
  $("#input").focus(); grow();
}

// Messages from the preview (selection).
addEventListener("message", e => {
  const m = e.data || {};
  if (m.blaze === "selected") { selection = m.items.length ? m : null; drawSelBar(); }
});
addEventListener("keydown", e => { if (e.key === "Escape" && view === "design" && selectOn) { selectOn = false; selection = null; drawStage(); } });

function drawSelBar() {
  const st = $("#dstage"); if (!st) return;
  const old = $(".selbar", st); if (old) old.remove();
  if (!selection) return;
  const items = selection.items, one = items[items.length - 1];
  const bar = h("div", "selbar");
  bar.innerHTML = `<div class="sbhead"><span class="label acc">${items.length > 1 ? pad(items.length) + " elements" : "&lt;" + esc(one.tag) + "&gt;"}</span><span class="sbtext">${esc(one.text.slice(0, 60))}</span><button class="x" title="Clear">×</button></div>
    <div class="sbacts"><button data-a="Change">Change</button><button data-a="Remove">Remove</button><button data-a="Restyle">Restyle</button><button data-a="Replace text">Replace text</button><button data-a="Ask">Ask…</button></div>
    <div class="sbform" style="display:none"><input class="field" placeholder=""><button class="btn accent sm go">Do it</button></div>
    <div class="sbtweak" style="display:none">
      <label><span class="label">Text</span><input type="color" data-p="color"></label>
      <label><span class="label">Fill</span><input type="color" data-p="background-color"></label>
      <label><span class="label">Size</span><input type="range" min="8" max="96" data-p="font-size" data-u="px"></label>
      <label><span class="label">Padding</span><input type="range" min="0" max="80" data-p="padding" data-u="px"></label>
      <label><span class="label">Radius</span><input type="range" min="0" max="48" data-p="border-radius" data-u="px"></label>
      <button class="btn accent sm apply">Apply</button>
    </div>`;
  const frame = $(".pframe", st);
  const post = msg => frame && frame.contentWindow.postMessage(msg, "*");
  $(".x", bar).onclick = () => { selection = null; post({ blaze: "clear" }); bar.remove(); };
  const form = $(".sbform", bar), input = $("input", form), tweak = $(".sbtweak", bar);
  let action = "";
  const tweaks = {};
  bar.querySelectorAll(".sbacts button").forEach(b => b.onclick = () => {
    action = b.dataset.a;
    bar.querySelectorAll(".sbacts button").forEach(x => x.classList.toggle("on", x === b));
    if (action === "Remove") { designEdit("Remove", "Remove this element from the design completely."); return; }
    tweak.style.display = action === "Restyle" ? "" : "none";
    form.style.display = "";
    input.placeholder = { Change: "What should change? e.g. make it a 3-column grid", Restyle: "Describe the style, or use the controls", "Replace text": "New text", Ask: "Ask anything about this part" }[action];
    if (action === "Replace text") input.value = one.text;
    input.focus();
  });
  tweak.querySelectorAll("input").forEach(inp => {
    const s = one.styles || {};
    if (inp.dataset.p === "color") inp.value = rgbHex(s.color);
    if (inp.dataset.p === "background-color") inp.value = rgbHex(s.background);
    if (inp.dataset.p === "font-size") inp.value = parseInt(s.fontSize) || 16;
    if (inp.dataset.p === "padding") inp.value = parseInt(s.padding) || 0;
    if (inp.dataset.p === "border-radius") inp.value = parseInt(s.borderRadius) || 0;
    inp.oninput = () => { const v = inp.value + (inp.dataset.u || ""); tweaks[inp.dataset.p] = v; post({ blaze: "style", prop: inp.dataset.p, value: v }); };
  });
  $(".apply", tweak).onclick = () => designEdit("Restyle", (input.value ? input.value + "\n" : "") + "Set these CSS values in the source: " + Object.entries(tweaks).map(([k, v]) => `${k}: ${v}`).join("; "));
  const go = () => { if (!input.value.trim() && action !== "Restyle") return; designEdit(action, action === "Replace text" ? `Replace its text with: ${input.value}` : input.value); };
  $(".go", form).onclick = go;
  input.onkeydown = e => { if (e.key === "Enter") { e.preventDefault(); go(); } };
  st.append(bar);
}

function designEdit(action, request) {
  if (!selection || busy) return;
  const t = D.target.kind === "url" ? `dev server ${D.target.url} (find the source file)` : D.target.path;
  let text = `[Design edit] ${action}\nFile: ${t}`;
  selection.items.forEach(it => { text += `\nElement: ${it.selector}\n\`\`\`html\n${it.html}\n\`\`\``; });
  text += `\nRequest: ${request}`;
  selection = null; selectOn = false;
  drawStage();
  sendText(text, []);
}

function rgbHex(c) {
  const m = (c || "").match(/\d+/g); if (!m || m.length < 3) return "#000000";
  return "#" + m.slice(0, 3).map(x => (+x).toString(16).padStart(2, "0")).join("");
}

// ---------- setup wizard ----------
let wizStep = 0;
function setupView(el) {
  const page = h("div", "page"); const col = h("div", "col"); page.append(col); el.append(page);
  const titles = ["Your computer", "Tools", "AI models"];
  const draw = () => {
    col.innerHTML = `<div class="steps-wiz">${titles.map((t, i) => `<span class="label ${i === wizStep ? "on" : ""}">${pad(i + 1)} ${t}</span>`).join("")}</div>`;
    [pcStep, toolsStep, modelsStep][wizStep](col);
  };
  function nav(col, last) {
    const row = h("div", "actions"); row.style.cssText = "display:flex;gap:8px;margin-top:28px";
    if (wizStep > 0) { const b = h("button", "btn line", "Back"); b.onclick = () => { wizStep--; draw(); }; row.append(b); }
    const n = h("button", "btn accent", last ? "Start using Blaze" : "Continue");
    n.onclick = async () => { if (last) { await API().FinishSetup(); S = await API().State(); setModel(S.model); show("work"); } else { wizStep++; draw(); } };
    row.append(n); col.append(row);
  }
  function pcStep(col) {
    col.append(h("h1", "", "Hi. This is your computer."), h("p", "lead", "Blaze detected all of this itself, so it never has to ask what you're running."));
    col.append(pcTable(S.info)); nav(col);
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
    col.append(providerRows(() => draw())); nav(col, true);
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
      if (used) { await API().RemoveProvider(p.id); S = await API().State(); setModel(S.model); redraw(); return; }
      if (p.keyless) { btn.disabled = true; btn.textContent = "Checking…"; const res = await API().AddProvider(p.id, ""); S = await API().State(); setModel(S.model); if (res.ok) redraw(); else { btn.disabled = false; btn.textContent = "Add"; form.style.display = ""; msg.textContent = res.error; } return; }
      form.style.display = form.style.display ? "" : "none";
    };
    const get = $(".get", form); if (get) get.onclick = () => API().OpenURL(p.key_page);
    const save = $(".save", form);
    if (save) save.onclick = async () => {
      const f = $("input", form); let key = f.value.trim(); if (key.startsWith("••")) key = "";
      save.disabled = true; save.textContent = "Testing…"; msg.textContent = "";
      const res = await API().AddProvider(p.id, key);
      save.disabled = false; save.textContent = "Test & save";
      if (res.ok) { S = await API().State(); setModel(S.model); redraw(); } else { msg.innerHTML = `<span class="bad">${esc(res.error)}</span>`; }
    };
    rows.append(r);
  });
  return rows;
}

// ---------- settings ----------
function settingsView(el, focus) {
  const page = h("div", "page"); const col = h("div", "col"); page.append(col); el.append(page);
  const draw = async () => {
    S = await API().State(); setModel(S.model);
    col.innerHTML = "";
    col.append(h("div", "label acc", "Settings"), h("h1", "", "Blaze"), h("p", "lead", `Version ${esc(S.version)} · settings and keys are shared with the Blaze command line.`));

    const g1 = h("div", "group"); g1.append(h("span", "label", "01 · Model order"));
    const chain = h("div", "rows");
    (S.chain || []).forEach((e, i) => {
      const r = h("div", "r", `<span class="n">${pad(i + 1)}</span><div class="main"><div class="t">${esc((S.providers.find(p => p.id === e.provider) || {}).name || e.provider)}</div><div class="s">${esc(e.model)}</div></div>`);
      const up = h("button", "btn ghost", "↑"); up.disabled = i === 0;
      up.onclick = async () => { const c = [...S.chain]; [c[i - 1], c[i]] = [c[i], c[i - 1]]; await API().SetChain(c); draw(); };
      r.append(up); chain.append(r);
    });
    if (!(S.chain || []).length) chain.append(h("div", "empty", "No models yet."));
    g1.append(chain);
    const g1b = h("div", "group"); g1b.append(h("span", "label", "02 · Add or remove models"), providerRows(draw));

    const g2 = h("div", "group"); g2.append(h("span", "label", "03 · Behaviour"));
    const t1 = h("label", "toggle", `<input type="checkbox" ${S.yolo ? "checked" : ""}><span>Auto-approve risky commands and installs <span class="label weak">deletes still ask</span></span>`);
    $("input", t1).onchange = e => { API().SetYolo(e.target.checked); $("#yolo", pane).checked = e.target.checked; };
    const t2 = h("label", "toggle", `<input type="checkbox" ${S.keyless ? "checked" : ""}><span>Fall back to the keyless model when every key fails</span>`);
    $("input", t2).onchange = e => API().SetKeyless(e.target.checked);
    t2.style.marginTop = "12px"; t2.style.display = "flex";
    const pers = h("textarea", "field"); pers.placeholder = "How Blaze should talk (optional), e.g. short answers, explain like I'm new to coding…"; pers.value = S.persona || "";
    const ps = h("button", "btn line", "Save style"); ps.onclick = async () => { await API().SetPersona(pers.value); ps.textContent = "Saved"; setTimeout(() => ps.textContent = "Save style", 1200); };
    const pw = h("div"); pw.style.marginTop = "14px"; pw.append(pers, ps); ps.style.marginTop = "8px";
    g2.append(t1, t2, pw);

    const g3 = h("div", "group"); g3.append(h("span", "label", "04 · Appearance"));
    const seg = h("div", "seg");
    ["system", "light", "dark"].forEach(t => { const b = h("button", S.prefs.theme === t ? "on" : "", t); b.onclick = async () => { await API().SetTheme(t); S.prefs.theme = t; applyTheme(); draw(); }; seg.append(b); });
    g3.append(seg);

    const g3b = h("div", "group"); g3b.append(h("span", "label", "05 · Design tab"), h("p", "s", "When Blaze makes something visual, open it in Design:"));
    const seg2 = h("div", "seg"); seg2.style.marginTop = "10px";
    [["ask", "Ask first"], ["always", "Always"], ["never", "Never"]].forEach(([k, t]) => { const b = h("button", (S.prefs.design_mode || "ask") === k ? "on" : "", t); b.onclick = async () => { await API().SetDesignMode(k); S.prefs.design_mode = k; draw(); }; seg2.append(b); });
    g3b.append(seg2);

    const g4 = h("div", "group"); g4.id = "memory"; g4.append(h("span", "label", "06 · What Blaze remembers"));
    const mem = h("textarea", "field"); mem.value = S.memory || ""; mem.placeholder = "Nothing yet. Blaze saves lasting facts here as you work, or type your own.";
    const ms = h("button", "btn line", "Save"); ms.style.marginTop = "8px"; ms.onclick = async () => { await API().SetMemory(mem.value); ms.textContent = "Saved"; setTimeout(() => ms.textContent = "Save", 1200); };
    g4.append(mem, ms);

    const g5 = h("div", "group"); g5.append(h("span", "label", "07 · Skills"));
    const sk = h("div", "rows");
    (S.skills || []).forEach((s, i) => sk.append(h("div", "r", `<span class="n">${pad(i + 1)}</span><div class="main"><div class="s">${esc(s)}</div></div><span></span>`)));
    if (!(S.skills || []).length) sk.append(h("div", "empty", "No skills yet. Ask Blaze to save one after a task, the same SKILL.md format as the phone app."));
    g5.append(sk);

    const g6 = h("div", "group"); g6.append(h("span", "label", "08 · This computer"), pcTable(S.info));
    const rf = h("button", "btn line", "Detect again"); rf.style.marginTop = "14px";
    rf.onclick = async () => { rf.textContent = "Detecting…"; await API().RefreshPC(); draw(); };
    g6.append(rf);
    const g7 = h("div", "group"); g7.id = "updates"; g7.append(h("span", "label", "09 · Updates"));
    const ur = h("div", "s"); const us = h("div", "label weak updstatus"); us.style.marginTop = "8px";
    const ub = h("div", "keyrow"); ub.style.marginTop = "12px";
    const chk = h("button", "btn line", "Check for updates"); const ins = h("button", "btn accent", "Update now"); ins.style.display = "none";
    const drawU = u => {
      if (!u) { ur.textContent = `You have ${S.version}.`; return; }
      if (u.error) ur.textContent = `You have ${u.current || S.version}. ${u.error}`;
      else if (u.available) ur.textContent = `Blaze ${u.latest} is out. You have ${u.current}. ${u.method || ""}`;
      else ur.textContent = `You're on the latest version, ${u.current}.`;
      ins.style.display = u.available ? "" : "none";
      ins.textContent = u.can_auto ? "Update now" : "Open release page";
    };
    chk.onclick = async () => { chk.disabled = true; chk.textContent = "Checking…"; drawU(await checkUpdate(false)); chk.disabled = false; chk.textContent = "Check again"; };
    ins.onclick = () => UPD && (UPD.can_auto ? installUpdate(g7) : API().OpenURL(UPD.page));
    const t3 = h("label", "toggle", `<input type="checkbox" ${S.prefs.no_update_check ? "" : "checked"}><span>Check for updates when Blaze opens</span>`);
    $("input", t3).onchange = e => { API().SetUpdateCheck(e.target.checked); S.prefs.no_update_check = !e.target.checked; };
    t3.style.marginTop = "14px"; t3.style.display = "flex";
    ub.append(chk, ins); g7.append(ur, us, ub, t3); drawU(UPD);
    col.append(g1, g1b, g2, g3, g3b, g4, g5, g6, g7);
    if (focus) { const f = $("#" + focus, col); if (f) f.scrollIntoView(); focus = ""; }
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
