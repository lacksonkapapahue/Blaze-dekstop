// Managed models, plans and PayPal billing (blaze-auth 0.9.0). Upstream providers and
// PayPal are mocked with a stubbed fetch; usage lives in a real SQLite D1 stand-in.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import worker from "../src/index";
import type { Env } from "../src/util";
import { resetPayPalToken } from "../src/billing";
import { FakeKV } from "./kv";
import { FakeD1 } from "./d1";

const BASE = "https://blaze-auth.blaze-app.workers.dev";
let kv: FakeKV;
let d1: FakeD1;
let env: Env;
let ipN = 100;
let bg: Promise<unknown>[];
const ctx = { waitUntil: (p: Promise<unknown>) => bg.push(p), passThroughOnException() {} } as unknown as ExecutionContext;

function call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const h: Record<string, string> = { "CF-Connecting-IP": `10.1.0.${ipN}`, ...headers };
  if (body !== undefined && !h["Content-Type"]) h["Content-Type"] = "application/json";
  const b = body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body);
  return worker.fetch(new Request(BASE + path, { method, headers: h, body: b }), env, ctx);
}

async function signup(email: string) {
  const r = await call("POST", "/v1/auth/signup", { email, password: "hunter2hunter2" });
  const j = (await r.json()) as { token: string; user: { id: string } };
  return { auth: { Authorization: `Bearer ${j.token}` }, uid: j.user.id };
}

const settle = async () => {
  while (bg.length) await Promise.all(bg.splice(0));
};

type Call = { url: string; body: any; headers: Headers };
let calls: Call[];
/** Routes the stubbed fetch: first matching prefix answers. */
function upstream(routes: Record<string, (c: Call) => Response | Promise<Response>>) {
  vi.stubGlobal("fetch", async (input: RequestInfo, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.url;
    let body: any = init?.body;
    if (typeof body === "string") {
      try {
        body = JSON.parse(body);
      } catch {
        /* form body */
      }
    }
    const c = { url, body, headers: new Headers(init?.headers) };
    calls.push(c);
    for (const [prefix, fn] of Object.entries(routes)) if (url.startsWith(prefix)) return fn(c);
    return new Response("no mock for " + url, { status: 599 });
  });
}

const GROQ = "https://api.groq.com/openai/v1/chat/completions";
const CEREBRAS = "https://api.cerebras.ai/v1/chat/completions";
const GEMINI = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
const okChat = (text: string, usage = { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 }) =>
  new Response(JSON.stringify({ id: "x", object: "chat.completion", choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }], usage }), { headers: { "Content-Type": "application/json" } });

const msgs = [{ role: "user", content: "Say hi" }];

beforeEach(() => {
  kv = new FakeKV();
  d1 = new FakeD1();
  bg = [];
  calls = [];
  ipN++;
  resetPayPalToken();
  env = {
    KV: kv as unknown as KVNamespace, DB: d1 as unknown as D1Database, BASE_URL: BASE, PBKDF2_ITERATIONS: "10000",
    GROQ_API_KEY: "gsk_test", CEREBRAS_API_KEY: "csk_test", GEMINI_API_KEY: "AIza_test",
  };
});
afterEach(() => vi.unstubAllGlobals());

describe("chat proxy: auth and plans", () => {
  it("needs a Blaze session", async () => {
    expect((await call("POST", "/v1/chat/completions", { model: "blaze-fast", messages: msgs })).status).toBe(401);
    expect((await call("POST", "/v1/chat/completions", { model: "blaze-fast", messages: msgs }, { Authorization: "Bearer sk-not-a-session" })).status).toBe(401);
    expect((await call("GET", "/v1/plan")).status).toBe(401);
  });

  it("lists the plan's models with locked ones marked, and hides models with no provider key", async () => {
    const { auth } = await signup("models@example.com");
    const r = await call("GET", "/v1/models", undefined, auth);
    expect(r.status).toBe(200);
    const j = (await r.json()) as { plan: string; default_model: string; data: { id: string; allowed: boolean; tier: string }[] };
    expect(j.plan).toBe("basic");
    expect(j.default_model).toBe("blaze-fast");
    const by = Object.fromEntries(j.data.map(m => [m.id, m]));
    expect(by["blaze-fast"]?.allowed).toBe(true);
    expect(by["blaze-smart"]).toMatchObject({ allowed: false, tier: "pro" });
    expect(by["blaze-max"]).toMatchObject({ allowed: false, tier: "max" });
    expect(by["deepseek-v3.1"]).toBeUndefined(); // only NVIDIA serves it, and NVIDIA has no key here
  });

  it("refuses a model above the plan with the plan it needs, and allows it after an upgrade", async () => {
    const { auth } = await signup("gate@example.com");
    upstream({ [GEMINI]: () => okChat("smart hi"), [GROQ]: () => okChat("groq hi") });
    let r = await call("POST", "/v1/chat/completions", { model: "blaze-smart", messages: msgs }, auth);
    expect(r.status).toBe(403);
    expect(await r.json()).toMatchObject({ error: "model_not_in_plan", required_tier: "pro", plan: "basic" });
    expect(calls.length).toBe(0);

    env.ADMIN_TOKEN = "admin-token-0123456789";
    expect((await call("POST", "/v1/admin/plan", { email: "gate@example.com", plan: "pro" }, { Authorization: "Bearer wrong-token-0123456789" })).status).toBe(401);
    r = await call("POST", "/v1/admin/plan", { email: "gate@example.com", plan: "pro" }, { Authorization: `Bearer ${env.ADMIN_TOKEN}` });
    expect(r.status).toBe(200);
    expect(((await r.json()) as { user: { plan: string } }).user.plan).toBe("pro");

    r = await call("POST", "/v1/chat/completions", { model: "blaze-smart", messages: msgs }, auth);
    expect(r.status).toBe(200);
    expect(r.headers.get("X-Blaze-Upstream")).toBe("gemini/gemini-2.5-flash");
    expect(((await r.json()) as any).choices[0].message.content).toBe("smart hi");
    expect(calls[0]?.headers.get("Authorization")).toBe("Bearer AIza_test"); // Joey's key, never the user's token
    expect(calls[0]?.body.model).toBe("gemini-2.5-flash");

    // Tool schemas are scrubbed for Gemini (it refuses additionalProperties, format, number enums).
    calls.length = 0;
    const tools = [{ type: "function", function: { name: "f", description: "", parameters: { type: "object", additionalProperties: false, properties: { format: { type: "string", format: "uri" }, n: { enum: [1, 2] } } } } }];
    expect((await call("POST", "/v1/chat/completions", { model: "blaze-smart", messages: msgs, tools }, auth)).status).toBe(200);
    expect(calls[0]?.body.tools[0].function.parameters).toEqual({ type: "object", properties: { format: { type: "string" }, n: { enum: ["1", "2"], type: "string" } } });
  });

  it("maps auto to the plan's default model and rejects unknown models", async () => {
    const { auth } = await signup("auto@example.com");
    upstream({ [GROQ]: () => okChat("hi") });
    expect((await call("POST", "/v1/chat/completions", { model: "auto", messages: msgs }, auth)).status).toBe(200);
    expect(calls[0]?.body.model).toBe("openai/gpt-oss-120b");
    expect((await call("POST", "/v1/chat/completions", { model: "gpt-9", messages: msgs }, auth)).status).toBe(404);
    expect((await call("POST", "/v1/chat/completions", { model: "blaze-fast", messages: [] }, auth)).status).toBe(400);
  });
});

describe("chat proxy: routing", () => {
  it("falls back to the next provider on a 429 and skips providers without a key", async () => {
    delete env.GEMINI_API_KEY;
    const { auth } = await signup("fallback@example.com");
    upstream({ [GROQ]: () => new Response('{"error":{"message":"rate limit"}}', { status: 429 }), [CEREBRAS]: () => okChat("from cerebras") });
    const r = await call("POST", "/v1/chat/completions", { model: "blaze-fast", messages: msgs, max_tokens: 999999 }, auth);
    expect(r.status).toBe(200);
    expect(r.headers.get("X-Blaze-Upstream")).toBe("cerebras/gpt-oss-120b");
    expect(calls.map(c => c.url)).toEqual([GROQ, CEREBRAS]);
    expect(calls[1]?.body.max_tokens).toBe(4096); // clamped to the Basic cap
  });

  it("passes a request error straight back instead of trying others", async () => {
    const { auth } = await signup("badreq@example.com");
    upstream({ [GROQ]: () => new Response('{"error":{"message":"tool_calls must be followed by tool messages"}}', { status: 400 }) });
    const r = await call("POST", "/v1/chat/completions", { model: "blaze-fast", messages: msgs }, auth);
    expect(r.status).toBe(400);
    expect(await r.text()).toContain("tool_calls must be followed");
    expect(calls.length).toBe(1);
  });

  it("says busy when every provider is rate limited", async () => {
    env = { ...env, GEMINI_API_KEY: undefined };
    const { auth } = await signup("busy@example.com");
    upstream({ [GROQ]: () => new Response("{}", { status: 429 }), [CEREBRAS]: () => new Response("{}", { status: 503 }) });
    const r = await call("POST", "/v1/chat/completions", { model: "blaze-fast", messages: msgs }, auth);
    expect(r.status).toBe(503);
    expect(await r.json()).toMatchObject({ error: "upstream_busy" });
  });

  it("streams SSE through untouched, asks for usage, and meters the final usage chunk", async () => {
    const { auth, uid } = await signup("stream@example.com");
    const sse = [
      'data: {"choices":[{"index":0,"delta":{"content":"Hel"}}]}',
      'data: {"choices":[{"index":0,"delta":{"content":"lo"}}]}',
      'data: {"choices":[],"usage":{"prompt_tokens":300,"completion_tokens":7,"total_tokens":307}}',
      "data: [DONE]", "", "",
    ].join("\n");
    upstream({
      [GROQ]: () => {
        const enc = new TextEncoder();
        const parts = [sse.slice(0, 30), sse.slice(30, 95), sse.slice(95)];
        return new Response(new ReadableStream({ start(c) { for (const p of parts) c.enqueue(enc.encode(p)); c.close(); } }), { headers: { "Content-Type": "text/event-stream" } });
      },
    });
    const r = await call("POST", "/v1/chat/completions", { model: "blaze-fast", messages: msgs, stream: true }, auth);
    expect(r.status).toBe(200);
    expect(r.headers.get("Content-Type")).toContain("text/event-stream");
    expect(calls[0]?.body.stream_options).toEqual({ include_usage: true });
    expect(await r.text()).toBe(sse);
    await settle();
    expect(d1.rows("SELECT tokens, requests FROM usage WHERE uid = ?", uid)).toEqual([{ tokens: 307, requests: 1 }]);
  });

  it("estimates tokens when the provider sends no usage", async () => {
    const { auth, uid } = await signup("estimate@example.com");
    upstream({ [GROQ]: () => new Response(JSON.stringify({ choices: [{ message: { content: "x".repeat(400) } }] }), { headers: { "Content-Type": "application/json" } }) });
    expect((await call("POST", "/v1/chat/completions", { model: "blaze-fast", messages: [{ role: "user", content: "y".repeat(784) }] }, auth)).status).toBe(200);
    await settle();
    expect(d1.rows("SELECT tokens FROM usage WHERE uid = ?", uid)[0].tokens).toBe(300); // (784+16+400)/4
  });
});

describe("chat proxy: limits", () => {
  it("returns 402 plan_limit once today's tokens are used, with the plan to upgrade to", async () => {
    const { auth, uid } = await signup("limit@example.com");
    upstream({ [GROQ]: () => okChat("hi", { prompt_tokens: 40000, completion_tokens: 10000, total_tokens: 50000 }) });
    expect((await call("POST", "/v1/chat/completions", { model: "blaze-fast", messages: msgs }, auth)).status).toBe(200);
    await settle();
    const r = await call("POST", "/v1/chat/completions", { model: "blaze-fast", messages: msgs }, auth);
    expect(r.status).toBe(402);
    const j = (await r.json()) as Record<string, unknown>;
    expect(j).toMatchObject({ error: "plan_limit", plan: "basic", limit: 50000, used: 50000, upgrade: "pro" });
    expect(typeof j.reset_at).toBe("number");
    expect(calls.length).toBe(1);
    const p = (await (await call("GET", "/v1/plan", undefined, auth)).json()) as any;
    expect(p.plan).toMatchObject({ id: "basic", name: "Basic", price_usd: 0 });
    expect(p.usage).toMatchObject({ tokens: 50000, requests: 1, limit: 50000, remaining: 0 });
    expect(p.tiers.map((t: any) => [t.id, t.price_usd])).toEqual([["basic", 0], ["pro", 10], ["max", 25]]);
    expect(uid).toMatch(/^u_/);
  });

  it("rate-limits requests per minute (429 with retry_after) and honours TIERS overrides", async () => {
    env.TIERS = JSON.stringify({ basic: { rpm: 2, daily_tokens: 999999 }, models: { "blaze-fast": { name: "Fast", tier: "basic", alias: true, routes: [{ provider: "cerebras", model: "llama-3.3-70b" }] } } });
    const { auth } = await signup("rpm@example.com");
    upstream({ [CEREBRAS]: () => okChat("hi") });
    for (let i = 0; i < 2; i++) expect((await call("POST", "/v1/chat/completions", { model: "blaze-fast", messages: msgs }, auth)).status).toBe(200);
    const r = await call("POST", "/v1/chat/completions", { model: "blaze-fast", messages: msgs }, auth);
    expect(r.status).toBe(429);
    expect(r.headers.get("Retry-After")).toBeTruthy();
    expect(await r.json()).toMatchObject({ error: "rate_limited", limit: 2 });
    expect(calls.every(c => c.body.model === "llama-3.3-70b")).toBe(true);
  });

  it("never writes KV per chat request", async () => {
    const { auth } = await signup("kvwrites@example.com");
    upstream({ [GROQ]: () => okChat("hi") });
    const before = kv.writes;
    for (let i = 0; i < 3; i++) await call("POST", "/v1/chat/completions", { model: "blaze-fast", messages: msgs }, auth);
    await settle();
    expect(kv.writes).toBe(before);
  });
});

describe("PayPal billing", () => {
  const PP = "https://api-m.sandbox.paypal.com";
  beforeEach(() => {
    Object.assign(env, { PAYPAL_CLIENT_ID: "cid", PAYPAL_SECRET: "sec", PAYPAL_ENV: "sandbox", PAYPAL_PLAN_PRO: "P-PRO", PAYPAL_PLAN_MAX: "P-MAX", PAYPAL_WEBHOOK_ID: "WH-1" });
  });
  const hooks = { "paypal-auth-algo": "SHA256withRSA", "paypal-cert-url": "https://api.paypal.com/cert.pem", "paypal-transmission-id": "t1", "paypal-transmission-sig": "sig", "paypal-transmission-time": "2026-10-12T08:00:00Z" };
  let verified = true;
  let subs: Record<string, any>;
  const paypal = () =>
    upstream({
      [`${PP}/v1/oauth2/token`]: () => Response.json({ access_token: "A21", expires_in: 3600 }),
      [`${PP}/v1/notifications/verify-webhook-signature`]: () => Response.json({ verification_status: verified ? "SUCCESS" : "FAILURE" }),
      [`${PP}/v1/billing/subscriptions`]: c => {
        const m = /subscriptions\/([^/]+)(\/\w+)?$/.exec(c.url);
        if (!m) return Response.json({ id: "I-NEWSUB123", status: "APPROVAL_PENDING", links: [{ rel: "approve", href: "https://www.sandbox.paypal.com/webapps/billing/subscriptions?ba_token=BA-1" }] }, { status: 201 });
        if (m[2] === "/revise") return Response.json({ plan_id: c.body.plan_id, links: [{ rel: "approve", href: "https://www.sandbox.paypal.com/revise?ba_token=BA-2" }] });
        if (m[2] === "/cancel") return new Response(null, { status: 204 });
        return Response.json(subs[m[1] as string] || {}, { status: subs[m[1] as string] ? 200 : 404 });
      },
    });
  const event = (type: string, resource: unknown) => call("POST", "/v1/billing/paypal/webhook", { id: "WH-EV-" + type, event_type: type, resource }, hooks);
  const userRec = async (uid: string) => JSON.parse((await kv.get(`user:${uid}`)) as string);

  it("starts a checkout with custom_id = the user id and returns the approve URL", async () => {
    verified = true;
    subs = {};
    paypal();
    const { auth, uid } = await signup("buyer@example.com");
    expect((await call("POST", "/v1/billing/checkout", { tier: "basic" }, auth)).status).toBe(400);
    const r = await call("POST", "/v1/billing/checkout", { tier: "pro" }, auth);
    expect(r.status).toBe(201);
    expect(await r.json()).toMatchObject({ approve_url: expect.stringContaining("sandbox.paypal.com"), subscription_id: "I-NEWSUB123", tier: "pro" });
    const create = calls.find(c => c.url === `${PP}/v1/billing/subscriptions`);
    expect(create?.body).toMatchObject({ plan_id: "P-PRO", custom_id: uid, subscriber: { email_address: "buyer@example.com" } });
    expect(create?.body.application_context.return_url).toBe(`${BASE}/v1/billing/return`);
  });

  it("refuses webhooks that fail PayPal's signature check", async () => {
    verified = false;
    subs = {};
    paypal();
    const { uid } = await signup("forged@example.com");
    const r = await event("BILLING.SUBSCRIPTION.ACTIVATED", { id: "I-FORGED1", plan_id: "P-MAX", status: "ACTIVE", custom_id: uid });
    expect(r.status).toBe(400);
    expect((await userRec(uid)).plan).toBeUndefined();
    const v = calls.find(c => c.url.endsWith("verify-webhook-signature"));
    expect(v?.body).toMatchObject({ webhook_id: "WH-1", transmission_id: "t1", webhook_event: { event_type: "BILLING.SUBSCRIPTION.ACTIVATED" } });
    expect((await call("POST", "/v1/billing/paypal/webhook", { event_type: "X" })).status).toBe(400); // no PayPal headers
  });

  it("activates, renews, revises, cancels (access until period end) and suspends", async () => {
    verified = true;
    const t0 = Math.floor(Date.now() / 1000);
    const next = new Date((t0 + 30 * 86400) * 1000).toISOString();
    subs = {};
    paypal();
    const { auth, uid } = await signup("sub@example.com");

    let r = await event("BILLING.SUBSCRIPTION.ACTIVATED", { id: "I-SUB0001", plan_id: "P-PRO", status: "ACTIVE", custom_id: uid, billing_info: { next_billing_time: next } });
    expect(r.status).toBe(200);
    let u = await userRec(uid);
    expect(u).toMatchObject({ plan: "pro", plan_source: "paypal", billing: { subscription_id: "I-SUB0001", status: "ACTIVE", tier: "pro" } });
    expect(u.plan_until).toBeGreaterThan(t0 + 30 * 86400);
    expect(await kv.get("paypalsub:I-SUB0001")).toBe(uid);
    let p = (await (await call("GET", "/v1/plan", undefined, auth)).json()) as any;
    expect(p.plan.id).toBe("pro");
    expect(p.billing).toMatchObject({ enabled: true, status: "ACTIVE", tier: "pro" });

    // A renewal payment only names the subscription; the Worker asks PayPal for the new period.
    const later = new Date((t0 + 61 * 86400) * 1000).toISOString();
    subs["I-SUB0001"] = { id: "I-SUB0001", plan_id: "P-PRO", status: "ACTIVE", custom_id: uid, billing_info: { next_billing_time: later } };
    r = await event("PAYMENT.SALE.COMPLETED", { id: "SALE-1", billing_agreement_id: "I-SUB0001", state: "completed" });
    expect(r.status).toBe(200);
    expect((await userRec(uid)).billing.period_end).toBe(t0 + 61 * 86400);

    // Pro -> Max revises the same subscription.
    r = await call("POST", "/v1/billing/checkout", { tier: "max" }, auth);
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ kind: "revise", subscription_id: "I-SUB0001" });
    expect((await call("POST", "/v1/billing/checkout", { tier: "pro" }, auth)).status).toBe(409);
    r = await event("BILLING.SUBSCRIPTION.UPDATED", { id: "I-SUB0001", plan_id: "P-MAX", status: "ACTIVE", custom_id: uid, billing_info: { next_billing_time: later } });
    expect((await userRec(uid)).plan).toBe("max");

    // Cancel from Blaze: PayPal is told, access stays until the paid period ends.
    r = await call("POST", "/v1/billing/cancel", {}, auth);
    expect(r.status).toBe(200);
    expect(calls.some(c => c.url.endsWith("/I-SUB0001/cancel"))).toBe(true);
    u = await userRec(uid);
    expect(u).toMatchObject({ plan: "max", billing: { status: "CANCELLED", cancel_at_period_end: true } });
    expect(u.plan_until).toBe(t0 + 61 * 86400);
    p = (await (await call("GET", "/v1/plan", undefined, auth)).json()) as any;
    expect(p.plan.id).toBe("max");
    expect(p.billing.cancel_at_period_end).toBe(true);
    // The CANCELLED webhook that follows changes nothing more.
    await event("BILLING.SUBSCRIPTION.CANCELLED", { id: "I-SUB0001", plan_id: "P-MAX", status: "CANCELLED", custom_id: uid });
    expect((await userRec(uid)).plan_until).toBe(t0 + 61 * 86400);

    // A lapsed paid period is Basic again.
    const rec = await userRec(uid);
    rec.plan_until = t0 - 10;
    await kv.put(`user:${uid}`, JSON.stringify(rec));
    expect(((await (await call("GET", "/v1/me", undefined, auth)).json()) as any).user.plan).toBe("basic");
  });

  it("drops to Basic at once when PayPal suspends or expires the subscription", async () => {
    verified = true;
    subs = {};
    paypal();
    const { uid } = await signup("suspend@example.com");
    await event("BILLING.SUBSCRIPTION.ACTIVATED", { id: "I-SUB0002", plan_id: "P-MAX", status: "ACTIVE", custom_id: uid });
    expect((await userRec(uid)).plan).toBe("max");
    await event("BILLING.SUBSCRIPTION.SUSPENDED", { id: "I-SUB0002", plan_id: "P-MAX", status: "SUSPENDED", custom_id: uid });
    const u = await userRec(uid);
    expect(u.plan).toBe("basic");
    expect(u.billing.status).toBe("SUSPENDED");
  });

  it("applies the subscription when the browser comes back from PayPal", async () => {
    verified = true;
    const { uid } = await signup("return@example.com");
    subs = { "I-RETURN01": { id: "I-RETURN01", plan_id: "P-PRO", status: "ACTIVE", custom_id: uid } };
    paypal();
    const r = await call("GET", "/v1/billing/return?subscription_id=I-RETURN01&ba_token=BA-1&token=T");
    expect(r.status).toBe(200);
    expect(await r.text()).toContain("subscribed");
    expect((await userRec(uid)).plan).toBe("pro");
  });

  it("answers not_configured without PayPal secrets", async () => {
    delete env.PAYPAL_CLIENT_ID;
    const { auth } = await signup("nopaypal@example.com");
    const r = await call("POST", "/v1/billing/checkout", { tier: "pro" }, auth);
    expect(r.status).toBe(503);
    expect(((await (await call("GET", "/v1/plan", undefined, auth)).json()) as any).billing.enabled).toBe(false);
  });
});
