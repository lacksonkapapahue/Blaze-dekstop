// v0.7 Learning (learn_app.go): a small mark in the chat and a toast when Blaze saves,
// updates or forgets a memory or creates/changes a skill; Settings › Behaviour › Learning;
// Settings › Skills with the bundled library (on/off, view, reset, delete, restore).
(() => {
  const marksOn = () => !(S && S.prefs && S.prefs.learn && S.prefs.learn.no_marks);
  const learnOn = () => !(S && S.prefs && S.prefs.learn && S.prefs.learn.off);

  const WORDS = {
    memory: { saved: "Remembered", updated: "Memory updated", replaced: "Memory updated", forgot: "Forgot" },
    skill: { created: "New skill", edited: "Skill updated" },
  };
  function describe(ev) {
    const kind = ev.kind === "skill" ? "skill" : "memory";
    return { kind, word: (WORDS[kind] || {})[ev.action] || (kind === "skill" ? "Skill" : "Memory"), text: ev.text || ev.ref || "" };
  }

  // The message the mark belongs to: the answer being streamed, else the last answer in the open chat.
  function targetMsg() {
    if (current && current.el && current.el.isConnected) return current.el;
    const all = $$("#log .msg.blaze");
    return all[all.length - 1] || null;
  }

  function mark(ev) {
    const d = describe(ev);
    const msg = targetMsg();
    if (!msg) return null;
    let box = $(".learnmarks", msg);
    if (!box) { box = h("div", "learnmarks"); msg.append(box); }
    const b = h("button", "learnmark " + d.kind + (ev.action === "forgot" ? " forgot" : ""),
      `<span class="sq"></span><span class="label">${esc(d.word)}${ev.auto ? " · auto" : ""}</span><span class="lt">${esc(d.text)}</span>`);
    b.title = d.kind === "skill" ? "Open Settings › Skills" : "Open Memory";
    b.onclick = () => d.kind === "skill" ? show("settings", "skills") : show("memory");
    box.append(b);
    return b;
  }

  function toast(ev) {
    const d = describe(ev);
    $$(".ltoast").forEach(t => t.remove());
    const t = h("div", "ltoast " + d.kind, `<span class="sq"></span><span class="label">${esc(d.word)}</span><span class="lt">${esc(d.text)}</span>`);
    document.body.append(t);
    requestAnimationFrame(() => t.classList.add("in"));
    setTimeout(() => { t.classList.remove("in"); setTimeout(() => t.remove(), 250); }, 3200);
  }

  on("learned", ev => {
    if (!ev || !marksOn()) return;
    const m = view === "work" || view === "design" ? mark(ev) : null;
    if (!m || document.hidden || ev.auto || ev.kind === "skill") toast(ev);
  });

  // ---------------- Settings › Behaviour › Learning ----------------
  function learningGroup(redraw) {
    const g = group("Learning", "Blaze keeps memories and skills on this computer (shared with Blaze CLI). You can see, edit or forget them in Memory and Settings › Skills.");
    const bx = h("div", "box pad formgrid");
    const t1 = h("label", "toggle", `<input type="checkbox" ${learnOn() ? "checked" : ""}><span><span class="tt">Learn automatically</span><span class="td">Blaze saves lasting facts and preferences as they come up, replaces ones that changed, and turns repeated workflows into skills. A tiny check after each answer decides if anything is worth keeping; it uses your cheapest model and stops at your spend cap. Off: it saves only when you ask.</span></span>`);
    $("input", t1).onchange = async e => { await API().SetLearn(e.target.checked); S.prefs.learn = { ...(S.prefs.learn || {}), off: !e.target.checked }; };
    const t2 = h("label", "toggle", `<input type="checkbox" ${marksOn() ? "checked" : ""}><span><span class="tt">Show what Blaze learns</span><span class="td">A small mark under the answer (and a toast) whenever a memory or skill is saved, changed or forgotten.</span></span>`);
    $("input", t2).onchange = async e => { await API().SetLearnMarks(e.target.checked); S.prefs.learn = { ...(S.prefs.learn || {}), no_marks: !e.target.checked }; };
    bx.append(t1, t2); g.append(bx);
    return g;
  }
  const _setBehaviourLearn = setBehaviour;
  setBehaviour = async function (col, redraw) {
    await _setBehaviourLearn(col, redraw);
    const g = learningGroup(redraw);
    const chat = $$(".group", col).find(x => ($(".gh .label", x) || {}).textContent === "Chat");
    if (chat) chat.after(g); else col.append(g);
  };

  // ---------------- Settings › Skills ----------------
  const STATE = {
    bundled: ["Bundled", "Ships with Blaze. Updates arrive with new versions."],
    edited: ["Edited", "A bundled skill you (or Blaze) changed. Updates never overwrite it."],
    own: ["Yours", "Made by you or by Blaze for you."],
    removed: ["Removed", "A bundled skill you deleted. Restore brings it back."],
  };
  let filter = "";
  window.SETTINGS_FNS = window.SETTINGS_FNS || {};
  window.SETTINGS_FNS.skills = async (col, redraw) => {
    const list = (API().SkillList ? await API().SkillList() : []) || [];
    const live = list.filter(s => s.state !== "removed");
    const on = live.filter(s => s.enabled).length;
    const search = h("input", "field sksearch"); search.placeholder = "Filter skills"; search.value = filter;
    const g = group("Skills", `Reusable instructions Blaze loads when a task matches: ${live.length} skills, ${on} on. Same SKILL.md format as Blaze CLI and the phone app (~/.blaze/skills). Ask Blaze to "save this as a skill" after a task.`, search);
    const rows = h("div", "rows skrows");
    const draw = () => {
      rows.innerHTML = "";
      const q = filter.trim().toLowerCase();
      const shown = list.filter(s => !q || (s.name + " " + s.description + " " + (s.tags || []).join(" ")).toLowerCase().includes(q));
      shown.forEach((s, i) => rows.append(skillRow(s, i, redraw)));
      if (!shown.length) rows.append(h("div", "empty", q ? `<b>No skill matches “${esc(q)}”</b>` : "<b>No skills yet</b>After a task, say “save this as a skill”."));
    };
    search.oninput = () => { filter = search.value; draw(); };
    draw();
    g.append(rows); col.append(g);
  };

  function skillRow(s, i, redraw) {
    const [badge, why] = STATE[s.state] || STATE.own;
    const r = h("div", "r skr" + (s.enabled || s.state === "removed" ? "" : " off") + (s.state === "removed" ? " removed" : ""));
    const tags = (s.tags || []).slice(0, 4).map(t => `<span class="sktag">${esc(t)}</span>`).join("");
    r.innerHTML = `<span class="n">${pad(i + 1)}</span>
      <div class="main"><div class="skt"><span class="t mono small">${esc(s.name)}</span><span class="skbadge ${esc(s.state)}" title="${esc(why)}">${esc(badge)}${s.version ? " · v" + s.version : ""}</span>${s.update ? `<span class="skbadge upd" title="A newer bundled version exists. Reset to get it (your edits are replaced).">Update</span>` : ""}</div>
      <div class="s">${esc(s.description)}</div>${tags ? `<div class="sktags">${tags}</div>` : ""}</div>
      <div class="skacts"></div>`;
    const acts = $(".skacts", r);
    if (s.state === "removed") {
      const rs = h("button", "btn line xs", "Restore");
      rs.onclick = async () => { rs.disabled = true; await API().RestoreSkill(s.name); redraw(); };
      acts.append(rs);
      return r;
    }
    const view = h("button", "btn ghost xs", "View");
    view.onclick = async () => {
      const open = r.nextElementSibling && r.nextElementSibling.classList.contains("skview");
      if (open) { r.nextElementSibling.remove(); view.textContent = "View"; return; }
      const txt = API().SkillText ? await API().SkillText(s.name) : "";
      const pv = h("div", "xpand skview", `<pre>${esc(txt || "(empty)")}</pre>`);
      r.after(pv); view.textContent = "Hide";
    };
    acts.append(view);
    if (s.state === "edited") {
      const rs = h("button", "btn ghost xs", "Reset");
      rs.title = "Replace your edits with the bundled version";
      rs.onclick = async () => { if (!confirm(`Reset “${s.name}” to the bundled version? Your edits are replaced.`)) return; await API().RestoreSkill(s.name); redraw(); };
      acts.append(rs);
    }
    const del = h("button", "btn ghost xs danger", "Delete");
    del.onclick = async () => {
      const msg = s.state === "own" ? `Delete “${s.name}”? This removes its folder.` : `Delete “${s.name}”? You can restore bundled skills later.`;
      if (!confirm(msg)) return;
      await API().DeleteSkill(s.name); redraw();
    };
    const tg = h("label", "toggle", `<input type="checkbox" ${s.enabled ? "checked" : ""} aria-label="Use ${esc(s.name)}">`);
    $("input", tg).onchange = async e => { await API().SetSkillEnabled(s.name, e.target.checked); s.enabled = e.target.checked; r.classList.toggle("off", !s.enabled); };
    acts.append(del, tg);
    return r;
  }

  window.Learn = { mark, toast };
})();
