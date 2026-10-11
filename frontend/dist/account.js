// Blaze account: sign in / create an account (Google, GitHub, email + password)
// through Blaze's sign-in service, and Settings › Account. Optional: connectors,
// keys and chats stay on this computer either way. Loaded after accounts.js.

IC.user = '<circle cx="8" cy="5.5" r="2.75"/><path d="M2.5 14c.6-2.9 2.8-4.5 5.5-4.5s4.9 1.6 5.5 4.5"/>';
IC.mail = '<rect x="1.5" y="3.5" width="13" height="9"/><path d="m1.5 4 6.5 5 6.5-5"/>';

let ACCT = null; // last AccountState()
let signMode = "signin"; // signin | signup

async function loadAccount() { ACCT = await API().AccountState() || { signed_in: false, login: {} }; return ACCT; }

function initials(u) {
  const s = (u.name || u.email || "?").trim();
  const p = s.split(/[\s@._-]+/).filter(Boolean);
  return ((p[0] || "?")[0] + (p.length > 1 && u.name ? p[1][0] : "")).toUpperCase();
}

function avatar(u, big) {
  const a = h("span", "uav" + (big ? " big" : ""), esc(initials(u)));
  if (u.avatar_url && /^https:\/\//.test(u.avatar_url)) {
    const img = new Image(); img.alt = ""; img.referrerPolicy = "no-referrer";
    img.onload = () => { a.textContent = ""; a.append(img); };
    img.src = u.avatar_url;
  }
  return a;
}

// The sign-in / sign-up form. onDone runs after a successful sign-in.
function signinForm(onDone) {
  const st = ACCT || { login: {} };
  const box = h("div", "signbox");
  const pend = st.pending;
  if (pend) {
    box.innerHTML = `<div class="label acc">Blaze account</div><h2>Finish in your browser</h2>
      <div class="waitline"><span class="sq"></span><span>Waiting for ${esc(pend === "github" ? "GitHub" : "Google")} to send you back to Blaze…</span></div>
      <div class="keyrow" style="margin-top:16px"><button class="btn line sm cancel">Cancel</button></div>`;
    $(".cancel", box).onclick = async () => { await API().AccountCancel(); await loadAccount(); box.replaceWith(signinForm(onDone)); };
    return box;
  }
  const up = signMode === "signup";
  box.innerHTML = `<div class="label acc">Blaze account</div><h2>${up ? "Create your Blaze account" : "Sign in to Blaze"}</h2>
    <p class="sub small">Optional. Your chats, connectors and keys stay on this computer either way.</p>
    <div class="oauthbtns"></div>
    <div class="ordiv"><span class="label weak">or with email</span></div>
    <form class="formgrid signform" autocomplete="on">
      <div class="fg nm" ${up ? "" : "hidden"}><label class="label">Name <span class="weak">optional</span></label><input class="field" name="name" autocomplete="name" placeholder="Luke"></div>
      <div class="fg"><label class="label">Email</label><input class="field" name="email" type="email" autocomplete="email" placeholder="you@example.com" required></div>
      <div class="fg"><label class="label">Password</label><input class="field" name="password" type="password" autocomplete="${up ? "new-password" : "current-password"}" placeholder="${up ? "At least 8 characters" : "Your password"}" required></div>
      <div class="out small" role="alert"></div>
      <button class="btn accent go" type="submit">${up ? "Create account" : "Sign in"}</button>
    </form>
    <div class="switch small sub">${up ? "Already have an account?" : "New to Blaze?"} <button class="btn ghost xs sw">${up ? "Sign in" : "Create an account"}</button></div>`;
  const ob = $(".oauthbtns", box);
  [["google", "Google"], ["github", "GitHub"]].forEach(([id, name]) => {
    const on = st.login && st.login[id];
    const b = h("button", "btn line obtn", `${logo(id)}<span>Continue with ${name}</span>${on ? "" : '<span class="soon label weak">Soon</span>'}`);
    b.type = "button";
    b.disabled = !on;
    b.title = on ? `Sign in with your ${name} account in the browser` : `Sign in with ${name} isn't switched on yet`;
    b.onclick = async () => {
      const err = await API().AccountSignIn(id);
      if (err) { toast(err, "error"); return; }
      await loadAccount(); box.replaceWith(signinForm(onDone));
    };
    ob.append(b);
  });
  if (!st.online) $(".ordiv", box).insertAdjacentHTML("afterend", `<div class="callout small">${icon("x")}<div>Blaze can't reach its sign-in service right now. Check your connection.</div></div>`);
  $(".sw", box).onclick = () => { signMode = up ? "signin" : "signup"; box.replaceWith(signinForm(onDone)); };
  const form = $("form", box);
  form.onsubmit = async e => {
    e.preventDefault();
    const out = $(".out", box), go = $(".go", box), f = new FormData(form);
    go.disabled = true; out.className = "out small sub"; out.textContent = up ? "Creating your account…" : "Signing in…";
    const r = await API().AccountEmail(up ? "signup" : "signin", f.get("name") || "", f.get("email") || "", f.get("password") || "");
    go.disabled = false;
    if (!r || r.error) { out.className = "out small bad"; out.textContent = (r && r.error) || "Sign-in failed."; return; }
    ACCT = r.state || await loadAccount();
    toast(up ? "Welcome to Blaze" : "Signed in as " + ACCT.user.email, "ok");
    onDone && onDone();
  };
  return box;
}

// Signed-in account card (Settings › Account and the top of Accounts).
function accountCard(compact, redraw) {
  const u = ACCT.user;
  const card = h("div", "ucard" + (compact ? " compact" : ""));
  const via = (u.providers || []).map(p => p === "github" ? "GitHub" : p === "google" ? "Google" : p);
  if (u.has_password) via.push("Email");
  const since = u.created_at ? new Date(u.created_at * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "";
  card.append(avatar(u, !compact));
  const main = h("div", "um", `<div class="label acc">Blaze account</div><div class="un">${esc(u.name || u.email.split("@")[0])}</div><div class="ue mono">${esc(u.email)}</div>`);
  card.append(main);
  const acts = h("div", "uacts");
  if (compact) {
    const m = h("button", "btn ghost sm", `Manage${icon("chev", "i sm")}`); m.onclick = () => show("settings", "account"); acts.append(m);
    card.classList.add("click"); card.onclick = e => { if (!e.target.closest("button")) show("settings", "account"); };
  } else {
    main.append(h("div", "upills", via.map(v => `<span class="pill">${esc(v)}</span>`).join("") + (u.email_verified ? '<span class="pill acc">Verified</span>' : "")));
    if (since) main.append(h("div", "note2", `Member since ${esc(since)}`));
    const so = h("button", "btn line sm", "Sign out");
    so.onclick = async () => { so.disabled = true; await API().AccountSignOut(); await loadAccount(); toast("Signed out of Blaze"); redraw && redraw(); };
    acts.append(so);
  }
  card.append(acts);
  return card;
}

function signedOutCard() {
  const card = h("div", "ucard compact out click", `<span class="uav off">${icon("user")}</span><div class="um"><div class="label">Blaze account</div><div class="un">Not signed in</div><div class="ue">Sign in with Google, GitHub or email. Optional.</div></div>`);
  const b = h("button", "btn line sm", "Sign in");
  b.onclick = e => { e.stopPropagation(); show("signin"); };
  card.onclick = () => show("signin");
  const a = h("div", "uacts"); a.append(b); card.append(a);
  return card;
}

// Full-screen sign-in page.
async function signinView(el, mode) {
  if (mode === "signup" || mode === "signin") signMode = mode;
  await loadAccount();
  const pg = h("div", "page signpage"); const col = h("div", "col"); pg.append(col); el.append(pg);
  if (ACCT.signed_in) { show("settings", "account"); return; }
  const back = h("button", "btn ghost xs back", `<svg class="i sm" viewBox="0 0 16 16"><path d="m10 4-4 4 4 4"/></svg>Back`); back.onclick = () => show("work");
  col.append(back, signinForm(() => show("settings", "account")));
}

window.VIEWS = window.VIEWS || {};
window.VIEWS.signin = signinView;

SECTIONS.unshift(["account", "Account", "user"]);
window.SETTINGS_FNS = window.SETTINGS_FNS || {};
window.SETTINGS_FNS.account = async (col, redraw) => {
  await loadAccount();
  if (!ACCT.signed_in) {
    col.append(signinForm(redraw));
    return;
  }
  col.append(accountCard(false, redraw));
  const g = group("What your account does", "");
  g.append(h("div", "box pad note2 acctnote", "Your Blaze account is who you are across Blaze apps. One-click connectors work with or without it, and your chats, memory, connectors and model keys never leave this computer."));
  col.append(g);
  const d = group("Delete account");
  const bx = h("div", "box pad keyrow dangerrow");
  bx.append(h("div", "note2", "Deletes your Blaze account and signs out everywhere. Nothing on this computer is removed."));
  const del = h("button", "btn ghost sm danger", "Delete account");
  del.onclick = async () => {
    if (!del.dataset.sure) { del.dataset.sure = 1; del.textContent = "Delete for good? Click again"; return; }
    del.disabled = true;
    const err = await API().AccountDelete();
    if (err) { toast(err, "error"); del.disabled = false; return; }
    await loadAccount(); toast("Your Blaze account is deleted"); redraw();
  };
  bx.append(del); d.append(bx); col.append(d);
};

on("account", async st => {
  ACCT = st || await loadAccount();
  if (view === "signin") { if (ACCT.signed_in) show("settings", "account"); else show("signin"); }
  if (view === "settings" && settingsSection === "account") show("settings", "account");
  if (view === "accounts" && connRedraw) connRedraw();
});

COMMANDS.splice(COMMANDS.findIndex(c => c.name === "accounts"), 0, { name: "account", desc: "Your Blaze account: sign in, sign out", run: () => { loadAccount().then(a => show(a.signed_in ? "settings" : "signin", a.signed_in ? "account" : undefined)); } });
