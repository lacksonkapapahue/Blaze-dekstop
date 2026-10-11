// jsdom test for the Specialists strip: a finished round tucks away instead of staying
// on "3 done" forever; work still running or awaiting review keeps it up.
// Run: npm i jsdom (anywhere on NODE_PATH), then node ci/specs.test.js
const fs = require("fs"), path = require("path");
const { JSDOM, VirtualConsole } = require("jsdom");
const dist = path.join(__dirname, "..", "frontend", "dist");

let fails = 0, n = 0;
const ok = (cond, msg) => { n++; if (!cond) { fails++; console.log("FAIL " + msg); } else console.log("ok   " + msg); };

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
  const S = w.eval("Specs"), conv = w.eval("convId") || "c-test";
  if (!w.eval("convId")) w.eval("convId = 'c-test'");
  const strip = () => d.querySelector("#specs");
  const visible = () => !!strip() && strip().style.display !== "none";
  const sum = () => strip() ? strip().querySelector(".sp-sum").textContent : "";
  const now = Date.now();
  const spec = (h, status, extra) => ({ handle: h, kind: "specialist", conv, status, task: "task " + h, mode: "build", started: now - 5000, ...(status === "running" ? {} : { ended: now }), ...extra });

  ["a", "b", "c"].forEach(h => S.upsert(spec(h, "running")));
  await tick(30);
  ok(visible() && /3 running/.test(sum()), "strip: shows while specialists run (" + sum() + ")");

  S.upsert(spec("a", "done", { review: "applied" })); S.upsert(spec("b", "done", { review: "applied" }));
  await tick(30);
  ok(visible() && /1 running/.test(sum()), "strip: stays up while one still runs");
  S.upsert(spec("c", "done", { review: "pending", changes: [{ path: "x" }] }));
  await tick(6500);
  ok(visible() && /1 to review/.test(sum()), "strip: stays up while a result awaits review");

  S.upsert(spec("c", "done", { review: "applied" }));
  await tick(30);
  ok(visible() && /3 done/.test(sum()) && strip().classList.contains("all-done"), "strip: shows the finished round briefly");
  await tick(6500);
  ok(!visible(), "strip: a finished round tucks away on its own");

  S.upsert(spec("d", "running"));
  await tick(30);
  ok(visible() && sum() === "1 running", "strip: a new round shows only the new specialist (" + sum() + ")");
  S.upsert(spec("d", "failed"));
  await tick(30);
  strip().querySelector(".sp-clear").click(); await tick(30);
  ok(!visible(), "strip: Clear hides a finished round at once");

  S.load([spec("e", "done", { review: "applied" }), spec("f", "running")]);
  await tick(30);
  ok(visible() && sum() === "1 running", "reopened chat: only specialists that still need something show (" + sum() + ")");

  const real = errs.filter(e => !/Could not load|Not implemented|canvas|getContext|globalAlpha|ResizeObserver/i.test(e));
  ok(!real.length, "no page errors" + (real.length ? ": " + real.slice(0, 3).join(" | ") : ""));
  console.log(`\n${n - fails}/${n} passed`);
  w.close();
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log("FAIL crashed: " + (e && e.stack || e)); process.exit(1); });
