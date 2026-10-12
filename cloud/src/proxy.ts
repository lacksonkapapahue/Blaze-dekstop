// Managed models: an OpenAI-compatible proxy in front of Joey's provider keys.
//
//   POST /v1/chat/completions   Bearer <Blaze session>; body as OpenAI's, "model" is a Blaze model
//   GET  /v1/models             the plan's models (OpenAI list shape + Blaze fields)
//   GET  /v1/plan               plan, today's usage and limit, reset time, models, billing state
//
// Limits per plan (tiers.ts): a daily token cap (402 plan_limit) and requests per minute
// (429 rate_limited). A model above the plan answers 403 model_not_in_plan with the
// plan it needs. Tokens come from the provider's usage (stream_options.include_usage is
// requested on streams), else an estimate of ~4 characters a token.
//
// Streams are passed through byte for byte; the Worker only watches them for the usage
// chunk. Fallback across providers happens before the first byte reaches the client.

import { Env, HttpError, json, readJSON } from "./util";
import { User, effectivePlan } from "./accounts";
import { catalog, allowed, available, nextTier, resetAt, upstreamKey, UPSTREAMS, ModelDef, Route, TierId, TIER_ORDER } from "./tiers";
import { today, addUsage, rateHit, prune, estimateTokens } from "./usage";
import { billingConfigured } from "./billing";

const MAX_BODY = 8 * 1024 * 1024; // images travel as base64 data URLs
const RETRYABLE = new Set([401, 403, 404, 408, 409, 425, 429, 500, 502, 503, 504, 520, 522, 524, 529]);

/** Runs p after the response when the runtime allows it (tests pass no ctx). */
export function later(ctx: ExecutionContext | undefined, p: Promise<unknown>): void {
  const q = p.catch(e => console.error("background", e));
  if (ctx) ctx.waitUntil(q);
}

// ---------------- models and plan ----------------

function modelView(env: Env, id: string, m: ModelDef, plan: TierId) {
  return {
    id, object: "model", owned_by: "blaze", name: m.name, tier: m.tier, alias: !!m.alias, desc: m.desc || "",
    tools: m.tools !== false, vision: !!m.vision, context: m.context || 0,
    allowed: allowed(m, plan), available: available(env, m),
  };
}

function modelList(env: Env, plan: TierId) {
  const { models } = catalog(env);
  return Object.entries(models)
    .filter(([, m]) => available(env, m))
    .map(([id, m]) => modelView(env, id, m, plan))
    .sort((a, b) => Number(b.alias) - Number(a.alias) || TIER_ORDER.indexOf(a.tier) - TIER_ORDER.indexOf(b.tier));
}

export function models(env: Env, u: User): Response {
  const plan = effectivePlan(u);
  return json({ object: "list", plan, default_model: catalog(env).tiers[plan].default_model, data: modelList(env, plan) });
}

export async function plan(env: Env, u: User): Promise<Response> {
  const cat = catalog(env);
  const p = effectivePlan(u);
  const t = cat.tiers[p];
  const used = await today(env, u.id);
  const b = u.billing;
  return json({
    plan: { id: p, name: t.name, price_usd: t.price_usd },
    usage: { tokens: used.tokens, requests: used.requests, limit: t.daily_tokens, remaining: Math.max(0, t.daily_tokens - used.tokens), reset_at: resetAt() },
    rpm: t.rpm,
    default_model: t.default_model,
    plan_until: u.plan_until || 0,
    source: u.plan_source || "",
    billing: {
      enabled: billingConfigured(env),
      provider: "paypal",
      status: b ? b.status : "",
      tier: b ? b.tier : "",
      period_end: b ? b.period_end : 0,
      cancel_at_period_end: !!(b && b.cancel_at_period_end),
    },
    tiers: TIER_ORDER.map(id => ({ id, name: cat.tiers[id].name, price_usd: cat.tiers[id].price_usd, daily_tokens: cat.tiers[id].daily_tokens, rpm: cat.tiers[id].rpm })),
    models: modelList(env, p),
  });
}

// ---------------- chat completions ----------------

type Msg = { content?: unknown };

/** Text characters in the prompt (images count as ~1,000 tokens each). */
function promptChars(messages: Msg[], tools: unknown): number {
  let n = 0;
  for (const m of messages) {
    const c = m && m.content;
    if (typeof c === "string") n += c.length + 16;
    else if (Array.isArray(c)) {
      for (const p of c as { type?: string; text?: string }[]) {
        if (p && p.type === "text" && typeof p.text === "string") n += p.text.length;
        else n += 4000;
      }
    }
    if (m && (m as { tool_calls?: unknown }).tool_calls) n += JSON.stringify((m as { tool_calls?: unknown }).tool_calls).length;
  }
  if (tools) n += JSON.stringify(tools).length;
  return n;
}

function hasImages(messages: Msg[]): boolean {
  return messages.some(m => Array.isArray(m && m.content) && (m.content as { type?: string }[]).some(p => p && p.type === "image_url"));
}

interface UsageIn {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

function usageTokens(u: UsageIn | null | undefined): number {
  if (!u) return 0;
  const t = Number(u.total_tokens || 0);
  return t > 0 ? t : Number(u.prompt_tokens || 0) + Number(u.completion_tokens || 0);
}

async function callUpstream(r: Route, key: string, body: Record<string, unknown>, signal?: AbortSignal): Promise<Response> {
  const h: Record<string, string> = { "Content-Type": "application/json", Authorization: `Bearer ${key}` };
  if (body.stream) h.Accept = "text/event-stream";
  if (r.provider === "openrouter") {
    h["HTTP-Referer"] = "https://github.com/lacksonkapapahue/Blaze-dekstop";
    h["X-Title"] = "Blaze";
  }
  return fetch((UPSTREAMS[r.provider] as { url: string }).url, { method: "POST", headers: h, body: JSON.stringify(body), signal });
}

// Gemini's OpenAI endpoint refuses some JSON-schema keywords (INVALID_ARGUMENT) and wants
// enum values as strings, so tool schemas are scrubbed for Gemini routes only (the same
// rules as Blaze Desktop's AdaptTools used to apply with the user's own Gemini key).
const GEMINI_DROP = new Set(["additionalProperties", "$schema", "examples", "default", "$ref", "$defs", "definitions", "pattern", "format", "minLength", "maxLength", "const"]);

function scrub(o: Record<string, unknown>, props: boolean): Record<string, unknown> {
  for (const [k, v] of Object.entries(o)) {
    if (!props && GEMINI_DROP.has(k)) {
      delete o[k];
      continue;
    }
    if (Array.isArray(v)) {
      if (k === "enum" && !props) {
        o[k] = v.map(x => String(x));
        o.type = "string";
      } else {
        o[k] = v.map(x => (x && typeof x === "object" && !Array.isArray(x) ? scrub(x as Record<string, unknown>, false) : x));
      }
    } else if (v && typeof v === "object") {
      o[k] = scrub(v as Record<string, unknown>, !props && k === "properties");
    }
  }
  return o;
}

export function geminiTools(tools: unknown): unknown {
  if (!Array.isArray(tools)) return tools;
  return tools.map(t => {
    const c = structuredClone(t) as { function?: { parameters?: Record<string, unknown> } };
    if (c && c.function && c.function.parameters && typeof c.function.parameters === "object") c.function.parameters = scrub(c.function.parameters, false);
    return c;
  });
}

const CONTENT_RE = /"(?:content|arguments|reasoning)":"((?:[^"\\]|\\.)*)"/g;

export async function chat(req: Request, env: Env, ctx: ExecutionContext | undefined, u: User): Promise<Response> {
  const cat = catalog(env);
  const planId = effectivePlan(u);
  const tier = cat.tiers[planId];
  const b = await readJSON(req, MAX_BODY);
  let id = typeof b.model === "string" && b.model.trim() ? b.model.trim() : tier.default_model;
  if (id === "auto" || id === "blaze" || id === "blaze-auto") id = tier.default_model;
  const m = cat.models[id];
  if (!m) throw new HttpError(404, "model_not_found", { model: id, message: `Blaze has no model called ${id}.` });
  if (!allowed(m, planId)) {
    throw new HttpError(403, "model_not_in_plan", {
      model: id, plan: planId, required_tier: m.tier,
      message: `${m.name} needs the ${cat.tiers[m.tier].name} plan. You're on ${tier.name}.`,
    });
  }
  const messages = b.messages;
  if (!Array.isArray(messages) || messages.length === 0) throw new HttpError(400, "invalid_request", { message: "messages must be a non-empty array" });

  // Per-minute rate, then today's tokens.
  const rh = await rateHit(env, u.id);
  if (Math.random() < 0.02) later(ctx, prune(env));
  if (tier.rpm > 0 && rh.n > tier.rpm) {
    throw new HttpError(429, "rate_limited", { retry_after: rh.retryAfter, limit: tier.rpm, message: `Your ${tier.name} plan allows ${tier.rpm} requests a minute.` });
  }
  const used = await today(env, u.id);
  if (used.tokens >= tier.daily_tokens) {
    const up = nextTier(planId);
    throw new HttpError(402, "plan_limit", {
      plan: planId, limit: tier.daily_tokens, used: used.tokens, reset_at: resetAt(), upgrade: up,
      message: `You've used today's ${tier.daily_tokens.toLocaleString("en-US")} tokens on ${tier.name}.` + (up ? ` Upgrade to ${cat.tiers[up].name} for more, or wait for the reset.` : " It resets at midnight UTC."),
    });
  }

  const imgs = hasImages(messages as Msg[]);
  let routes = m.routes.filter(r => !!upstreamKey(env, r.provider) && UPSTREAMS[r.provider]);
  if (imgs && routes.some(r => r.vision)) routes = routes.filter(r => r.vision);
  if (!routes.length) throw new HttpError(503, "no_providers", { model: id, message: "No provider for this model is switched on right now." });

  const stream = b.stream === true;
  const pchars = promptChars(messages as Msg[], b.tools);
  const cap = tier.max_output_tokens;
  let busy = false;
  let lastStatus = 0;
  for (const r of routes) {
    const key = upstreamKey(env, r.provider);
    const body: Record<string, unknown> = { ...b, model: r.model };
    for (const k of ["max_tokens", "max_completion_tokens"]) {
      const v = body[k];
      if (typeof v === "number" && cap > 0 && v > cap) body[k] = cap;
    }
    if (stream) body.stream_options = { include_usage: true };
    if (r.provider === "gemini" && body.tools) body.tools = geminiTools(body.tools);
    let resp: Response;
    try {
      resp = await callUpstream(r, key, body, req.signal);
      if (resp.status === 400 && stream) {
        const txt = await resp.clone().text();
        if (/stream_options|include_usage/i.test(txt)) {
          delete body.stream_options;
          resp = await callUpstream(r, key, body, req.signal);
        }
      }
    } catch (e) {
      console.error("upstream", r.provider, e);
      lastStatus = 0;
      continue;
    }
    if (resp.ok) {
      const headers: Record<string, string> = {
        "X-Blaze-Model": id, "X-Blaze-Upstream": `${r.provider}/${r.model}`, "X-Blaze-Plan": planId,
        "X-Blaze-Tokens-Remaining": String(Math.max(0, tier.daily_tokens - used.tokens)),
      };
      return stream ? relayStream(resp, env, ctx, u.id, pchars, headers) : relayWhole(resp, env, ctx, u.id, pchars, headers);
    }
    lastStatus = resp.status;
    if (resp.status === 429) busy = true;
    if (RETRYABLE.has(resp.status)) {
      console.warn("upstream refused", r.provider, r.model, resp.status, (await resp.text().catch(() => "")).slice(0, 200));
      continue;
    }
    // The request itself is wrong (400, 413, 422…): another provider won't do better.
    const text = await resp.text();
    return new Response(text, { status: resp.status, headers: { "Content-Type": resp.headers.get("Content-Type") || "application/json", "Cache-Control": "no-store", "X-Blaze-Upstream": `${r.provider}/${r.model}` } });
  }
  if (busy) throw new HttpError(503, "upstream_busy", { retry_after: 20, message: "Blaze's models are busy right now. Try again in a moment." });
  throw new HttpError(502, "upstream_error", { status: lastStatus, message: "Blaze's model providers didn't answer. Try again shortly." });
}

async function relayWhole(resp: Response, env: Env, ctx: ExecutionContext | undefined, uid: string, pchars: number, headers: Record<string, string>): Promise<Response> {
  const text = await resp.text();
  let tokens = 0;
  try {
    const data = JSON.parse(text) as { usage?: UsageIn; choices?: { message?: { content?: string; tool_calls?: unknown } }[] };
    tokens = usageTokens(data.usage);
    if (!tokens) {
      const msg = data.choices?.[0]?.message;
      const out = (msg?.content || "").length + (msg?.tool_calls ? JSON.stringify(msg.tool_calls).length : 0);
      tokens = estimateTokens(pchars + out);
    }
  } catch {
    tokens = estimateTokens(pchars + text.length);
  }
  later(ctx, addUsage(env, uid, tokens));
  return new Response(text, { status: 200, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers } });
}

function relayStream(resp: Response, env: Env, ctx: ExecutionContext | undefined, uid: string, pchars: number, headers: Record<string, string>): Response {
  const reader = (resp.body as ReadableStream<Uint8Array>).getReader();
  const dec = new TextDecoder();
  let buf = "";
  let outChars = 0;
  let usage: UsageIn | null = null;
  let done = false;
  let settle: () => void = () => {};
  const finished = new Promise<void>(res => (settle = res));
  later(ctx, finished);
  const scan = (line: string) => {
    if (!line.startsWith("data:")) return;
    if (line.includes('"usage"') && line.includes("_tokens")) {
      try {
        const o = JSON.parse(line.slice(5).trim()) as { usage?: UsageIn };
        if (o.usage && usageTokens(o.usage) > 0) usage = o.usage;
      } catch {
        /* a partial or odd line */
      }
    }
    CONTENT_RE.lastIndex = 0;
    let mm: RegExpExecArray | null;
    while ((mm = CONTENT_RE.exec(line))) outChars += (mm[1] as string).length;
  };
  const finish = async () => {
    if (done) return;
    done = true;
    if (buf) scan(buf);
    const tokens = usageTokens(usage) || estimateTokens(pchars + outChars);
    try {
      await addUsage(env, uid, tokens);
    } catch (e) {
      console.error("addUsage", e);
    }
    settle();
  };
  const out = new ReadableStream<Uint8Array>({
    async pull(c) {
      try {
        const { done: end, value } = await reader.read();
        if (end) {
          await finish();
          c.close();
          return;
        }
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() || "";
        for (const l of lines) scan(l.trim());
        c.enqueue(value);
      } catch (e) {
        await finish();
        c.error(e);
      }
    },
    async cancel(reason) {
      await reader.cancel(reason).catch(() => {});
      await finish(); // the client went away: count what was used so far
    },
  });
  return new Response(out, {
    status: 200,
    headers: { "Content-Type": resp.headers.get("Content-Type") || "text/event-stream", "Cache-Control": "no-cache", ...headers },
  });
}
