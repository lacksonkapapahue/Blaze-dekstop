// jsdom test for the composer pickers (v0.7.4): /skills narrows as you type, like the "/" menu.
// Run: npm i jsdom (anywhere on NODE_PATH), then node ci/picker.test.js
const fs = require("fs"), path = require("path");
const { JSDOM, VirtualConsole } = require("jsdom");
const dist = path.join(__dirname, "..", "frontend", "dist");
const F = require(path.join(dist, "filter.js"));

let fails = 0, n = 0;
const ok = (cond, msg) => { n++; if (!cond) { fails++; console.log("FAIL " + msg); } else console.log("ok   " + msg); };
const eq = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b), msg + (JSON.stringify(a) === JSON.stringify(b) ? "" : `\n     got ${JSON.stringify(a)}\n     want ${JSON.stringify(b)}`));

// ---- the ranker on its own ----
const names = ["landing-page-builder", "shell-sysadmin", "skill-creator", "slide-deck", "web-design-blaze-classic", "writing-tests"];
const list = names.map(x => ({ name: x, desc: x === "slide-deck" ? "Make a presentation as slides" : "Something else", tags: x === "writing-tests" ? ["testing", "go"] : [] }));
eq(F.rank(list, "sli").map(x => x.name), ["slide-deck"], "rank: 'sli' narrows to slide-deck (no loose fuzzy hits like shell-sysadmin)");
eq(F.rank(list, "s").slice(0, 3).map(x => x.name), ["shell-sysadmin", "skill-creator", "slide-deck"], "rank: name prefixes first, in list order");
eq(F.rank(list, "wdb").map(x => x.name), ["web-design-blaze-classic"], "rank: fuzzy word initials");
eq(F.rank(list, "design").map(x => x.name), ["web-design-blaze-classic"], "rank: word-start substring");
eq(F.rank(list, "testing").map(x => x.name), ["writing-tests"], "rank: tags");
eq(F.rank(list, "presentation").map(x => x.name), ["slide-deck"], "rank: description last");
const tiers = F.rank([{ name: "deck-slide" }, { name: "xsli" }, { name: "slim" }], "sli").map(x => x.name);
eq(tiers, ["slim", "deck-slide", "xsli"], "rank: prefix > word-start > substring");
eq(F.hl("slide-<deck>", [0, 1, 2]), '<mark class="hit">sli</mark>de-&lt;deck&gt;', "hl: merged marks and escaping");

// ---- the real page with the CI fake backend ----
(async () => {
  const html = fs.readFileSync(path.join(dist, "index.html"), "utf8");
  const mock = fs.readFileSync(path.join(__dirname, "mock.js"), "utf8");
  const vc = new VirtualConsole(); const errs = [];
  vc.on("jsdomError", e => errs.push(String(e && (e.detail || e.message || e))));
  // Inline the page's scripts and styles and give it a real-looking origin, so localStorage
  // works (file:// is opaque) and no resource loader is needed.
  const page = html
    .replace(/<script src="([^"]+)"><\/script>/g, (_, f) => fs.existsSync(path.join(dist, f)) ? "<script>" + fs.readFileSync(path.join(dist, f), "utf8").replace(/<\/script/gi, "<\\/script") + "</script>" : "")
    .replace(/<link rel="stylesheet" href="([^"]+)">/g, (_, f) => fs.existsSync(path.join(dist, f)) ? "<style>" + fs.readFileSync(path.join(dist, f), "utf8") + "</style>" : "");
  const dom = new JSDOM(page, {
    url: "http://blaze.test/index.html", runScripts: "dangerously", pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) {
      w.__theme = "dark";
      w.matchMedia = w.matchMedia || (() => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
      w.HTMLCanvasElement.prototype.getContext = () => null;
      w.Element.prototype.scrollIntoView = function () {};
      w.eval(mock);
    },
  });
  const w = dom.window, d = w.document;
  if (d.readyState !== "complete") await new Promise(r => w.addEventListener("load", r));
  const tick = (ms = 30) => new Promise(r => setTimeout(r, ms));
  for (let i = 0; i < 100 && !d.querySelector("#input"); i++) await tick(30);
  if (!d.querySelector("#input")) { console.log(errs.slice(0,5).join("\n")); w.eval("show(\"work\")"); await tick(100); }
  ok(!!d.querySelector("#input"), "page: composer is up");
  // Put slide-deck in the usable list, as on Luke's machine (the mock has it removed).
  const st = await w.go.main.App.State();
  const sd = w.__skills.find(s => s.name === "slide-deck");
  if (!st.skills.some(s => s.startsWith("slide-deck:"))) st.skills.push("slide-deck: " + sd.description);
  sd.state = "bundled"; sd.enabled = true;
  const total = st.skills.length;

  const input = d.querySelector("#input"), menuEl = () => d.querySelector("#menu");
  const type = async v => { input.value = v; input.selectionStart = input.selectionEnd = v.length; input.dispatchEvent(new w.Event("input", { bubbles: true })); await tick(); };
  const key = async k => { input.dispatchEvent(new w.KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true })); await tick(); };
  const shown = () => [...menuEl().querySelectorAll(".mi .mn")].map(x => x.textContent.replace(/^\//, "").replace(/ ›$/, ""));
  const open = () => menuEl() && menuEl().style.display !== "none";
  const sel = () => { const b = menuEl().querySelector(".mi.on .mn"); return b && b.textContent; };

  // "/" then pick skills: the picker opens with every skill.
  await type("/sk"); ok(shown()[0] === "skills", "slash menu: '/sk' ranks skills first");
  await key("Enter"); await tick(60);
  eq(shown().length, total, "skills picker: opens with all " + total + " skills");
  // Luke's bug: typing "sli" must narrow the list.
  await type("s"); const afterS = shown().length;
  ok(afterS < total && afterS > 1, "filter: 's' narrows (" + afterS + " of " + total + ")");
  await type("sli");
  eq(shown(), ["slide-deck"], "filter: 'sli' leaves only slide-deck");
  eq(sel(), "slide-deck", "filter: first match is auto-selected");
  const hit = menuEl().querySelector(".mi .mn mark.hit");
  ok(hit && hit.textContent === "sli", "highlight: matched letters are marked");
  ok(/1 of \d+/.test(menuEl().querySelector(".mhead").textContent), "header: shows the match count");
  // Backspace widens again.
  await type("sl"); ok(shown().length >= 1 && shown()[0] === "slide-deck", "backspace: 'sl' still ranks slide-deck first");
  await type("s"); eq(shown().length, afterS, "backspace: back to the 's' list");
  await type(""); eq(shown().length, total, "backspace: empty filter shows everything");
  // Ranking among several: prefix first, then the rest.
  await type("web"); { const r = shown(), k = r.findIndex(x => !x.startsWith("web")); ok(r.filter(x => x.startsWith("web")).length === 3 && (k < 0 || r.slice(k).every(x => !x.startsWith("web"))), "ranking: 'web' puts the three web-* skills first, description hits after (" + r.join(", ") + ")"); }
  await type("de"); ok(shown().indexOf("debugging") < shown().indexOf("slide-deck") && shown().indexOf("deep-research") < shown().indexOf("slide-deck"), "ranking: name prefixes beat word-start matches");
  // ↓ moves, Enter picks the filtered item.
  await type("wri"); const first = sel(); await key("ArrowDown"); const second = sel();
  ok(first !== second, "arrows: ↓ moves the selection (" + first + " → " + second + ")");
  await key("ArrowUp"); eq(sel(), first, "arrows: ↑ moves back");
  await type("sli"); await key("Enter"); await tick(60);
  ok(!open(), "enter: picker closes");
  eq(input.value, "Use the slide-deck skill: ", "enter: picks the filtered item (slide-deck)");
  // Tab picks too.
  await type(""); await type("/skills"); await key("Enter"); await tick(60); await type("refac"); await key("Tab"); await tick(60);
  eq(input.value, "Use the refactoring skill: ", "tab: picks the filtered item");
  // Empty state, then Esc.
  await type(""); await type("/skills"); await key("Enter"); await tick(60);
  await type("xyz");
  ok(open() && /No skill matches 'xyz'/.test(menuEl().textContent), "empty state: \"No skill matches 'xyz'\"");
  await key("Enter"); ok(open() && input.value === "xyz", "empty state: Enter doesn't send the filter text");
  await type("x"); ok(shown().length > 0, "empty state: backspace widens again");
  await key("Escape"); ok(!open(), "esc: closes the picker");
  // "/skills sli" typed straight in opens the picker already narrowed.
  await type(""); await type("/skills sli"); await tick(80);
  ok(open(), "prefill: '/skills sli' opens the picker");
  eq(shown(), ["slide-deck"], "prefill: already narrowed to slide-deck");
  await type("/skills sl"); ok(shown()[0] === "slide-deck" && shown().length >= 1, "prefill: backspace keeps working");
  await type("/skills sli"); await key("Enter"); await tick(60);
  eq(input.value, "Use the slide-deck skill: ", "prefill: Enter picks slide-deck");
  // Same code on the other pickers: /theme and @files.
  await type(""); await type("/theme d"); await tick(60);
  eq(shown(), ["dark"], "theme picker: '/theme d' narrows to dark");
  await key("Escape");
  await type(""); await type("@hero"); await tick(80);
  ok(open() && shown().length >= 1 && shown().every(x => x.toLowerCase().includes("hero")), "@files: narrows to files matching 'hero'");
  ok(!!menuEl().querySelector(".mi .mn mark.hit"), "@files: highlights the match");
  await key("Escape");

  if (process.env.DEBUG) console.log(errs.join("\n"));
  const real = errs.filter(e => !/Could not load|Not implemented|canvas|getContext|ResizeObserver/i.test(e));
  ok(!real.length, "no page errors" + (real.length ? ": " + real.slice(0, 3).join(" | ") : ""));
  console.log(`\n${n - fails}/${n} passed`);
  w.close();
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log("FAIL crashed: " + (e && e.stack || e)); process.exit(1); });
