// Injected into design previews by Blaze: hover outlines, click to select, live style tweaks.
(function () {
  if (window.__blazePicker) return;
  window.__blazePicker = true;
  let on = false, hoverBox, boxes = [], picked = [];
  const css = `position:fixed;pointer-events:none;z-index:2147483647;box-sizing:border-box;`;
  function mk(color, fill) {
    const d = document.createElement("div");
    d.style.cssText = css + `border:1.5px solid ${color};background:${fill};display:none`;
    document.documentElement.appendChild(d); return d;
  }
  function place(d, el) {
    const r = el.getBoundingClientRect();
    Object.assign(d.style, { display: "block", left: r.left + "px", top: r.top + "px", width: r.width + "px", height: r.height + "px" });
  }
  function selector(el) {
    if (el.id) return "#" + CSS.escape(el.id);
    const parts = [];
    while (el && el.nodeType === 1 && el !== document.documentElement) {
      if (el.id) { parts.unshift("#" + CSS.escape(el.id)); break; }
      let s = el.tagName.toLowerCase();
      const cls = [...el.classList].filter(c => !/^(hover|active|focus)/.test(c)).slice(0, 2);
      if (cls.length) s += "." + cls.map(c => CSS.escape(c)).join(".");
      const sib = el.parentElement ? [...el.parentElement.children].filter(x => x.tagName === el.tagName) : [];
      if (sib.length > 1) s += `:nth-of-type(${sib.indexOf(el) + 1})`;
      parts.unshift(s); el = el.parentElement;
    }
    return parts.join(" > ");
  }
  function info(el) {
    const cs = getComputedStyle(el);
    let html = el.outerHTML; if (html.length > 3000) html = html.slice(0, 3000) + "…";
    return { selector: selector(el), tag: el.tagName.toLowerCase(), text: (el.innerText || el.textContent || "").trim().slice(0, 200), html,
      styles: { color: cs.color, background: cs.backgroundColor, fontSize: cs.fontSize, padding: cs.padding, borderRadius: cs.borderRadius, gap: cs.gap } };
  }
  function send() {
    boxes.forEach(b => b.remove()); boxes = [];
    picked.forEach(el => { const b = mk("#1F4BD8", "rgba(31,75,216,.10)"); place(b, el); boxes.push(b); });
    const r = picked.length ? picked[picked.length - 1].getBoundingClientRect() : null;
    parent.postMessage({ blaze: "selected", items: picked.map(info), rect: r && { left: r.left, top: r.top, bottom: r.bottom, width: r.width } }, "*");
  }
  document.addEventListener("mousemove", e => {
    if (!on) return;
    hoverBox = hoverBox || mk("#6B8CFF", "rgba(107,140,255,.08)");
    const el = e.target; if (el === document.documentElement || el === document.body) { hoverBox.style.display = "none"; return; }
    place(hoverBox, el);
  }, true);
  document.addEventListener("click", e => {
    if (!on) return;
    e.preventDefault(); e.stopPropagation();
    const el = e.target;
    if (e.shiftKey) { const i = picked.indexOf(el); i >= 0 ? picked.splice(i, 1) : picked.push(el); }
    else picked = [el];
    send();
  }, true);
  addEventListener("scroll", () => { if (picked.length) { boxes.forEach((b, i) => place(b, picked[i])); } }, true);
  addEventListener("message", e => {
    const m = e.data || {};
    if (m.blaze === "mode") {
      on = !!m.on;
      if (!on) { picked = []; boxes.forEach(b => b.remove()); boxes = []; if (hoverBox) hoverBox.style.display = "none"; }
      document.documentElement.style.cursor = on ? "crosshair" : "";
    }
    if (m.blaze === "clear") { picked = []; send(); }
    if (m.blaze === "style") { picked.forEach(el => el.style.setProperty(m.prop, m.value)); boxes.forEach((b, i) => place(b, picked[i])); }
    if (m.blaze === "theme") { document.documentElement.style.colorScheme = m.value; }
  });
  parent.postMessage({ blaze: "ready", title: document.title }, "*");
})();
