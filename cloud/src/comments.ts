// Pinned comments on pages shipped from Blaze Desktop (v0.8.0). Public by design: a
// shipped page carries <script src=".../v1/comments.js" data-site="<id>">, anyone with
// the link can read and add pins, and the desktop app reads them back. One KV key per
// site (comments:<site>), capped at 200 pins, with a soft per-IP limit on writes.
import { Env, HttpError, json } from "./util";

export interface Pin { id: string; sel: string; text: string; x: number; y: number; path: string; who: string; when: string }

const SITE_RE = /^[a-f0-9]{8,32}$/;
const MAX = 200;

export const OPEN_CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "600",
};

function withCors(r: Response): Response {
  const h = new Headers(r.headers);
  for (const [k, v] of Object.entries(OPEN_CORS)) h.set(k, v);
  return new Response(r.body, { status: r.status, headers: h });
}

const clip = (s: unknown, n: number) => String(s ?? "").slice(0, n);

/** Handles /v1/comments.js and /v1/comments/<site>; null for any other path. */
export async function comments(req: Request, env: Env, path: string, limit: (key: string) => void): Promise<Response | null> {
  if (path === "/v1/comments.js") {
    return withCors(new Response(WIDGET, { headers: { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "public, max-age=300" } }));
  }
  const m = /^\/v1\/comments\/([^/]+)$/.exec(path);
  if (!m) return null;
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: OPEN_CORS });
  const site = m[1] ?? "";
  try {
    if (!SITE_RE.test(site)) throw new HttpError(400, "bad_site");
    const key = `comments:${site}`;
    const list: Pin[] = (await env.KV.get(key, "json")) || [];
    if (req.method === "GET") return withCors(json(list));
    if (req.method !== "POST") throw new HttpError(405, "method_not_allowed");
    limit(`comments:${req.headers.get("CF-Connecting-IP") || "?"}`);
    let b: any;
    try { b = await req.json(); } catch { throw new HttpError(400, "bad_json"); }
    const text = clip(b.text, 1000).trim();
    if (!text) throw new HttpError(400, "empty");
    const pin: Pin = {
      id: crypto.randomUUID().slice(0, 8), sel: clip(b.sel, 300), text, path: clip(b.path, 300), who: clip(b.who, 60).trim(),
      x: Math.min(1, Math.max(0, Number(b.x) || 0)), y: Math.max(0, Math.min(1e6, Number(b.y) || 0)), when: new Date().toISOString().slice(0, 16).replace("T", " "),
    };
    list.push(pin);
    await env.KV.put(key, JSON.stringify(list.slice(-MAX)));
    return withCors(json(pin, 201));
  } catch (e) {
    if (e instanceof HttpError) return withCors(json({ error: e.code }, e.status));
    throw e;
  }
}

// The widget a shipped page loads: pins, and click "Comment" then a spot to leave one.
const WIDGET = `(function(){var s=document.currentScript,site=s&&s.dataset.site,base=s&&s.src.replace(/\\/v1\\/comments\\.js.*$/,"");if(!site)return;
var api=base+"/v1/comments/"+site,on=false,ui="data-bzc";
function sel(el){var p=[];while(el&&el.nodeType===1&&el!==document.body){var t=el.tagName.toLowerCase();if(el.id){p.unshift("#"+el.id);break}p.unshift(t);el=el.parentElement}return p.join(" > ")}
function pins(){fetch(api).then(function(r){return r.json()}).then(function(cs){document.querySelectorAll("["+ui+"=pin]").forEach(function(n){n.remove()});(cs||[]).filter(function(c){return !c.path||c.path===location.pathname}).forEach(function(c,i){var d=document.createElement("div");d.setAttribute(ui,"pin");d.title=(c.who?c.who+": ":"")+c.text;d.textContent=i+1;d.style.cssText="position:absolute;z-index:2147483646;left:calc("+(c.x*100)+"% - 11px);top:"+(c.y-11)+"px;width:22px;height:22px;border-radius:50% 50% 50% 0;background:#1F4BD8;color:#fff;font:700 11px/22px system-ui;text-align:center;cursor:pointer;box-shadow:0 2px 6px rgba(0,0,0,.3)";d.onclick=function(e){e.stopPropagation();alert(d.title)};document.body.appendChild(d)})}).catch(function(){})}
var b=document.createElement("button");b.setAttribute(ui,"btn");b.textContent="Comment";b.style.cssText="position:fixed;right:16px;bottom:16px;z-index:2147483647;background:#111;color:#fff;border:0;border-radius:999px;padding:10px 16px;font:600 13px system-ui;box-shadow:0 4px 14px rgba(0,0,0,.25);cursor:pointer";
b.onclick=function(e){e.stopPropagation();on=!on;b.textContent=on?"Click a spot…":"Comment";document.documentElement.style.cursor=on?"crosshair":""};
document.addEventListener("click",function(e){if(!on||e.target.closest("["+ui+"]"))return;e.preventDefault();e.stopPropagation();on=false;b.textContent="Comment";document.documentElement.style.cursor="";
var t=prompt("Your comment:");if(!t)return;var who=localStorage.getItem("bzc-who")||prompt("Your name (optional):")||"";localStorage.setItem("bzc-who",who);
fetch(api,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({sel:sel(e.target),text:t,who:who,x:e.pageX/document.documentElement.scrollWidth,y:e.pageY,path:location.pathname})}).then(pins)},true);
document.body.appendChild(b);pins()})();`;
