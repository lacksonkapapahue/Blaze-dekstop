// The calm shell (v0.11.0, plan part A): a top bar with Chat | Projects, Search (Ctrl+K),
// the BlazeRouter dot and an avatar menu; a rail that is the recent chats (Chat) or the
// projects (Projects); an Exit chip whenever a view is open. Nothing is deleted: the old
// sidebar buttons, Work/Design tabs, theme button and model chip stay in the DOM with
// their handlers; they just move into /views, the avatar menu and the + menu.
const Shell = (() => {
  let mode = localStorage.getItem("blaze-shell-mode") === "projects" ? "projects" : "chat";
  const AV = '<svg class="i" viewBox="0 0 16 16"><circle cx="8" cy="6" r="2.75"/><path d="M2.75 14c.6-2.6 2.7-4 5.25-4s4.65 1.4 5.25 4"/></svg>';
  const SEARCH = '<svg class="i sm" viewBox="0 0 16 16"><circle cx="7" cy="7" r="4.5"/><path d="m10.5 10.5 3.5 3.5"/></svg>';

  function build() {
    document.body.classList.add("shell");
    const top = $("#top");
    // Chat | Projects (square segmented control, like the old tabs).
    const pill = h("div", "tabs shpill"); pill.id = "pill";
    pill.innerHTML = `<button data-mode="chat">Chat</button><button data-mode="projects">Projects</button>`;
    $$("button", pill).forEach(b => b.onclick = () => setMode(b.dataset.mode));
    $("#tabs").after(pill);
    // DESIGN · Exit, shown while a view is open.
    const exit = h("div", "shexit"); exit.id = "exitChip";
    exit.innerHTML = `<span class="label ink" id="exitName"></span><button class="btn ghost xs" title="Back to the chat (Esc)">${icon("x", "i sm")}Exit</button>`;
    $("button", exit).onclick = () => show("work");
    pill.after(exit);
    // Search, then the router button (already there), then the avatar.
    const sb = h("button", "chip shsearch", `${SEARCH}<span>Search</span><span class="kbd">Ctrl K</span>`); sb.id = "searchBtn";
    sb.title = "Search chats, projects, views and commands (Ctrl+K)";
    sb.onclick = e => { e.stopPropagation(); search(); };
    const rb = $("#routerBtn");
    (rb || $("#themeBtn")).before(sb);
    const av = h("button", "shavatar", AV); av.id = "avatar"; av.title = "Account and settings"; av.dataset.pop = "1";
    av.onclick = e => { e.stopPropagation(); avatarMenu(av); };
    top.append(av);
    // The B logo returns to the plain chat.
    const brand = $("#side .brand");
    if (brand) { brand.style.cursor = "pointer"; brand.title = "Back to the chat"; brand.addEventListener("click", () => show("work")); }
    addEventListener("keydown", e => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); search(); }
      if (e.key === "Escape" && view !== "work" && view !== "design" && !popEl && !menuOpen() && !document.body.classList.contains("orb")) show("work");
    });
    setMode(mode, true);
    sync();
  }

  function setMode(m, quiet) {
    mode = m; localStorage.setItem("blaze-shell-mode", m);
    document.body.classList.toggle("mode-chat", m === "chat");
    document.body.classList.toggle("mode-projects", m === "projects");
    $$("#pill button").forEach(b => b.classList.toggle("on", b.dataset.mode === m));
    if (!quiet && m === "projects" && S && S.project) show("project", S.project.id);
    else if (!quiet && m === "chat" && view !== "work") show("work");
    chips();
  }

  // After every show(): the Exit chip and the pill's state.
  function sync() {
    const inView = typeof view !== "undefined" && view !== "work" && view !== "project";
    const chip = $("#exitChip"); if (!chip) return;
    chip.style.display = inView ? "" : "none";
    $("#exitName").textContent = (window.BlazeViews ? BlazeViews.label(view === "project" ? "projects" : view) : view).toUpperCase();
    $("#pill").classList.toggle("dim", inView);
    chips();
  }

  // Projects rail: a status chip on the project that is working right now.
  function chips() {
    $$("#projects .chat.proj").forEach(b => {
      let c = $(".shchip", b);
      const working = b.classList.contains("on") && typeof busy !== "undefined" && busy;
      if (working && !c) { c = h("span", "shchip", "Working"); b.append(c); }
      if (!working && c) c.remove();
    });
  }

  // Ctrl+K: chats, projects, views and commands in the composer picker.
  async function search() {
    const list = await API().Conversations(S && S.project ? S.project.id : "") || [];
    const projects = await API().Projects() || [];
    const items = [
      ...list.map(c => ({ name: c.title, desc: "Chat · " + (c.updated || ""), run: () => openChat(c.id) })),
      ...[{ id: "", name: "General" }, ...projects].map(p => ({ name: p.name, desc: "Project" + (p.folder ? " · " + p.folder : ""), run: () => switchProject(p.id) })),
      ...(window.BlazeViews ? BlazeViews.items().map(v => ({ ...v, desc: "View · " + v.desc })) : []),
      ...COMMANDS.filter(c => c.run).map(c => ({ name: "/" + c.name, desc: c.desc, run: c.run })),
    ];
    const go = () => { openMenu("sub", items, "Search"); const i = $("#input"); if (i) i.focus(); };
    if (view !== "work" && view !== "design") { show("work"); setTimeout(go, 0); } else go();
  }

  async function switchProject(id) {
    leaveTurn(); const p = await API().OpenProject(id); convId = "";
    if (p && p.folder) { S.prefs.folder = p.folder; setFolder(p.folder); }
    hero(); await refreshSide();
    if (id) show("project", id); else show("work");
  }

  // Account, Settings, BlazeRouter, Theme, Model, Updates, Sign out.
  async function avatarMenu(anchor) {
    if (popEl && popEl.dataset.kind === "avatar") { closePop(); return; }
    let acct = null;
    try { acct = typeof loadAccount === "function" ? await loadAccount() : null; } catch (e) {}
    const dark = document.documentElement.dataset.theme === "dark";
    openPop(anchor, p => {
      p.dataset.kind = "avatar"; p.classList.add("shmenu");
      const who = acct && acct.signed_in ? esc(acct.email || acct.login && acct.login.email || "Signed in") : "Not signed in";
      p.innerHTML = `<div class="phd"><span class="label">Account</span><span class="grow"></span><span class="shwho">${who}</span></div><div class="pbody"></div>`;
      const body = $(".pbody", p);
      const row = (ic, name, desc, fn, extra) => {
        const b = h("button", "opt", `<span class="on-mark">${ic}</span><span class="col2"><span class="ot">${esc(name)}</span>${desc ? `<span class="od">${esc(desc)}</span>` : ""}</span>${extra || ""}`);
        b.onclick = e => { e.stopPropagation(); fn(b); };
        body.append(b); return b;
      };
      row(AV, "Account", acct && acct.signed_in ? "Your Blaze account" : "Sign in to sync keys", () => { closePop(); show(acct && acct.signed_in ? "settings" : "signin", acct && acct.signed_in ? "account" : undefined); });
      row(icon("sliders", "i sm"), "Settings", "Behaviour, appearance, memory, skills", () => { closePop(); show("settings"); });
      row(icon("layers", "i sm"), "BlazeRouter dashboard", (window.Router && Router.view && Router.view.note) || "Models, keys and usage", () => { closePop(); show("router"); });
      row(icon("route", "i sm"), "Model", ($("#routeText") || {}).textContent || "", () => { closePop(); modelPopover(anchor); });
      row(icon(dark ? "moon" : "sun", "i sm"), "Theme", dark ? "Dark · click for light" : "Light · click for dark", () => { const t = $("#themeBtn"); if (t) t.click(); closePop(); });
      row(icon("grid", "i sm"), "All views", "Memory, Jobs, Schedule, Accounts, Doctor…", () => { closePop(); BlazeViews.picker(); });
      row(icon("dl", "i sm"), "Check for updates", UPD && UPD.available ? "A new version is ready" : "", () => { closePop(); show("settings", "updates"); });
      if (acct && acct.signed_in) row(icon("x", "i sm"), "Sign out", "", async () => { closePop(); await API().AccountSignOut(); if (typeof loadAccount === "function") await loadAccount(); });
    }, { width: 300 });
  }

  return { build, sync, setMode, search, get mode() { return mode; } };
})();
window.Shell = Shell;
// Two icons the shell needs that app.js didn't have.
IC.route = '<circle cx="3.5" cy="8" r="1.5"/><circle cx="12.5" cy="4" r="1.5"/><circle cx="12.5" cy="12" r="1.5"/><path d="M5 8h3l3-3.5M8 8l3 3.5"/>';
IC.grid = '<rect x="2.5" y="2.5" width="4.5" height="4.5"/><rect x="9" y="2.5" width="4.5" height="4.5"/><rect x="2.5" y="9" width="4.5" height="4.5"/><rect x="9" y="9" width="4.5" height="4.5"/>';
Shell.build();
