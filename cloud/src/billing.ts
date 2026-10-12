// Billing with PayPal Subscriptions (Stripe isn't available to Joey's account).
//
//   POST /v1/billing/checkout        Bearer; {tier:"pro"|"max"} -> {approve_url, subscription_id}
//   GET  /v1/billing/return          PayPal sends the browser back here after approval
//   POST /v1/billing/cancel          Bearer; cancels at PayPal, access lasts until the paid period ends
//   POST /v1/billing/paypal/webhook  PayPal events, verified with verify-webhook-signature
//   POST /v1/admin/plan              Authorization: Bearer <ADMIN_TOKEN>; {email, plan, days?}
//
// Config: PAYPAL_CLIENT_ID, PAYPAL_SECRET, PAYPAL_WEBHOOK_ID (secrets); PAYPAL_ENV
// ("sandbox" | "live"), PAYPAL_PLAN_PRO, PAYPAL_PLAN_MAX (plan ids made in PayPal).
//
// The subscription's custom_id is the Blaze user id, so the webhook knows whose plan to
// change without a KV write at checkout. An activation also writes paypalsub:<id> -> uid
// for payment events that only carry the subscription id. Plan changes are rare writes
// to the account record.

import { Env, HttpError, json, html, esc, readJSON, safeEqual, normEmail } from "./util";
import { User, Billing, getUser, putUser, userByEmail, publicUser, effectivePlan } from "./accounts";
import { TierId, isTier, catalog } from "./tiers";

const GRACE = 3 * 86400; // a renewal webhook can be a little late
const now = () => Math.floor(Date.now() / 1000);

export function billingConfigured(env: Env): boolean {
  return !!(env.PAYPAL_CLIENT_ID && env.PAYPAL_SECRET && (env.PAYPAL_PLAN_PRO || env.PAYPAL_PLAN_MAX));
}

function apiBase(env: Env): string {
  return (env.PAYPAL_ENV || "sandbox").toLowerCase() === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";
}

function planIdFor(env: Env, tier: TierId): string {
  return (tier === "pro" ? env.PAYPAL_PLAN_PRO : tier === "max" ? env.PAYPAL_PLAN_MAX : "") || "";
}

export function tierForPlanId(env: Env, planId: unknown): TierId | null {
  if (typeof planId !== "string" || !planId) return null;
  if (env.PAYPAL_PLAN_PRO && planId === env.PAYPAL_PLAN_PRO) return "pro";
  if (env.PAYPAL_PLAN_MAX && planId === env.PAYPAL_PLAN_MAX) return "max";
  return null;
}

// ---------------- PayPal API ----------------

let tokenCache: { key: string; token: string; exp: number } | null = null;

async function accessToken(env: Env): Promise<string> {
  if (!billingConfigured(env)) throw new HttpError(503, "not_configured", { what: "billing" });
  const key = `${apiBase(env)}|${env.PAYPAL_CLIENT_ID}`;
  if (tokenCache && tokenCache.key === key && tokenCache.exp > Date.now() + 60_000) return tokenCache.token;
  const r = await fetch(`${apiBase(env)}/v1/oauth2/token`, {
    method: "POST",
    headers: { Authorization: "Basic " + btoa(`${env.PAYPAL_CLIENT_ID}:${env.PAYPAL_SECRET}`), "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: "grant_type=client_credentials",
  });
  const d = (await r.json().catch(() => ({}))) as { access_token?: string; expires_in?: number };
  if (!r.ok || !d.access_token) {
    console.error("paypal token", r.status);
    throw new HttpError(502, "billing_unavailable", { message: "PayPal didn't answer. Try again shortly." });
  }
  tokenCache = { key, token: d.access_token, exp: Date.now() + (d.expires_in || 3000) * 1000 };
  return d.access_token;
}

/** Forget the cached token (tests). */
export function resetPayPalToken(): void {
  tokenCache = null;
}

async function paypal(env: Env, method: string, path: string, body?: unknown | string): Promise<{ status: number; data: Record<string, unknown> }> {
  const tok = await accessToken(env);
  const r = await fetch(apiBase(env) + path, {
    method,
    headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json", Accept: "application/json", Prefer: "return=representation" },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
  const text = await r.text();
  let data: Record<string, unknown> = {};
  try {
    data = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    /* empty or not JSON */
  }
  return { status: r.status, data };
}

interface Subscription {
  id?: string;
  plan_id?: string;
  status?: string;
  custom_id?: string;
  billing_info?: { next_billing_time?: string };
  links?: { rel?: string; href?: string }[];
}

function approveLink(d: { links?: { rel?: string; href?: string }[] }): string {
  return (d.links || []).find(l => l.rel === "approve")?.href || "";
}

function ts(v: unknown): number {
  if (typeof v !== "string") return 0;
  const t = Date.parse(v);
  return Number.isFinite(t) ? Math.floor(t / 1000) : 0;
}

// ---------------- applying PayPal's view to the account ----------------

/**
 * Saves what PayPal says about a subscription onto its account and sets the plan:
 * ACTIVE grants the tier until the next billing time (+ grace); CANCELLED keeps it until
 * the paid period ends; SUSPENDED and EXPIRED drop to Basic at once.
 */
export async function applySubscription(env: Env, sub: Subscription, statusHint?: string): Promise<User | null> {
  const sid = typeof sub.id === "string" ? sub.id : "";
  if (!sid) return null;
  let uid = typeof sub.custom_id === "string" && sub.custom_id.startsWith("u_") ? sub.custom_id : "";
  if (!uid) uid = (await env.KV.get(`paypalsub:${sid}`)) || "";
  const u = uid ? await getUser(env, uid) : null;
  if (!u) {
    console.warn("paypal: no account for subscription", sid);
    return null;
  }
  const prev = u.billing && u.billing.subscription_id === sid ? u.billing : null;
  const tier = tierForPlanId(env, sub.plan_id) || (prev ? prev.tier : null);
  if (!tier) {
    console.warn("paypal: unknown plan", sub.plan_id);
    return null;
  }
  const status = String(sub.status || statusHint || "").toUpperCase();
  // An old subscription's late events never undo the newer one in force.
  if (u.billing && u.billing.subscription_id !== sid && u.billing.status === "ACTIVE" && status !== "ACTIVE") return u;
  const periodEnd = ts(sub.billing_info?.next_billing_time) || (prev ? prev.period_end : 0);
  const b: Billing = { provider: "paypal", subscription_id: sid, tier, status, period_end: periodEnd, updated_at: now() };
  const fromPayPal = !u.plan_source || u.plan_source === "paypal";
  switch (status) {
    case "ACTIVE":
      u.plan = tier;
      u.plan_source = "paypal";
      u.plan_until = periodEnd ? periodEnd + GRACE : 0;
      if (!u.billing || u.billing.subscription_id !== sid) await env.KV.put(`paypalsub:${sid}`, u.id);
      break;
    case "CANCELLED":
      b.cancel_at_period_end = true;
      if (fromPayPal) {
        u.plan = tier;
        u.plan_source = "paypal";
        u.plan_until = periodEnd > now() ? periodEnd : now();
      }
      break;
    case "SUSPENDED":
    case "EXPIRED":
      if (fromPayPal) {
        u.plan = "basic";
        delete u.plan_until;
      }
      break;
    default:
      // APPROVAL_PENDING / APPROVED: nothing paid yet.
      if (u.billing && u.billing.subscription_id !== sid) return u; // keep the record of the one in force
  }
  u.billing = b;
  await putUser(env, u);
  return u;
}

// ---------------- endpoints ----------------

export async function checkout(env: Env, u: User, req: Request): Promise<Response> {
  if (!billingConfigured(env)) throw new HttpError(503, "not_configured", { what: "billing", message: "Upgrades aren't switched on yet." });
  const b = await readJSON(req);
  const tier = b.tier;
  if (!isTier(tier) || tier === "basic") throw new HttpError(400, "invalid_tier", { hint: 'send {"tier":"pro"} or {"tier":"max"}' });
  const planId = planIdFor(env, tier);
  if (!planId) throw new HttpError(503, "not_configured", { what: `PAYPAL_PLAN_${tier.toUpperCase()}` });
  const ret = `${env.BASE_URL}/v1/billing/return`;
  const appCtx = { brand_name: "Blaze", user_action: "SUBSCRIBE_NOW", shipping_preference: "NO_SHIPPING", return_url: ret, cancel_url: `${ret}?cancelled=1` };
  const cur = u.billing;
  if (cur && cur.status === "ACTIVE" && !cur.cancel_at_period_end) {
    if (cur.tier === tier) throw new HttpError(409, "already_subscribed", { tier, message: `You're already on ${catalog(env).tiers[tier].name}.` });
    // Switching between Pro and Max: PayPal revises the same subscription.
    const r = await paypal(env, "POST", `/v1/billing/subscriptions/${encodeURIComponent(cur.subscription_id)}/revise`, { plan_id: planId, application_context: appCtx });
    const url = approveLink(r.data as Subscription);
    if (r.status >= 300 || !url) {
      console.error("paypal revise", r.status, JSON.stringify(r.data).slice(0, 300));
      throw new HttpError(502, "billing_unavailable", { message: "PayPal couldn't change the plan. Try again shortly." });
    }
    return json({ approve_url: url, subscription_id: cur.subscription_id, tier, kind: "revise" });
  }
  const body: Record<string, unknown> = { plan_id: planId, custom_id: u.id, application_context: appCtx };
  if (!u.email.endsWith(".invalid")) body.subscriber = { email_address: u.email };
  const r = await paypal(env, "POST", "/v1/billing/subscriptions", body);
  const url = approveLink(r.data as Subscription);
  if (r.status >= 300 || !url) {
    console.error("paypal create", r.status, JSON.stringify(r.data).slice(0, 300));
    throw new HttpError(502, "billing_unavailable", { message: "PayPal couldn't start the checkout. Try again shortly." });
  }
  return json({ approve_url: url, subscription_id: String((r.data as Subscription).id || ""), tier, kind: "new" }, 201);
}

function page(title: string, msg: string): Response {
  return html(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Blaze</title><body style="font:15px/1.5 system-ui,sans-serif;background:#FBFBFA;color:#111110;display:grid;place-items:center;min-height:100vh;margin:0"><div style="max-width:440px;padding:32px;border:1px solid rgba(17,17,16,.18);background:#fff;box-shadow:inset 3px 0 0 #111110"><div style="font:500 11px monospace;letter-spacing:.12em;text-transform:uppercase">Blaze</div><h2 style="margin:8px 0 6px;font-weight:600">${esc(title)}</h2><p style="margin:0;color:rgba(17,17,16,.6)">${esc(msg)}</p></div></body>`, 200);
}

/** The browser lands here after PayPal. Applies the subscription at once (the webhook confirms it too). */
export async function billingReturn(env: Env, req: Request): Promise<Response> {
  const q = new URL(req.url).searchParams;
  if (q.get("cancelled")) return page("No change", "You left PayPal before subscribing. Nothing was charged. You can close this tab.");
  const sid = q.get("subscription_id") || "";
  if (/^I-[A-Z0-9]{6,40}$/.test(sid) && billingConfigured(env)) {
    try {
      const r = await paypal(env, "GET", `/v1/billing/subscriptions/${encodeURIComponent(sid)}`);
      if (r.status < 300) await applySubscription(env, r.data as Subscription);
    } catch (e) {
      console.error("billing return", e);
    }
  }
  return page("Thanks, you're subscribed", "Go back to Blaze: your plan updates in a few seconds. You can close this tab.");
}

export async function cancel(env: Env, u: User): Promise<Response> {
  const b = u.billing;
  if (!b || b.status !== "ACTIVE") throw new HttpError(400, "no_subscription", { message: "You don't have an active subscription to cancel." });
  const r = await paypal(env, "POST", `/v1/billing/subscriptions/${encodeURIComponent(b.subscription_id)}/cancel`, { reason: "Cancelled from Blaze" });
  if (r.status >= 300 && r.status !== 422) {
    console.error("paypal cancel", r.status, JSON.stringify(r.data).slice(0, 300));
    throw new HttpError(502, "billing_unavailable", { message: "PayPal couldn't cancel right now. Try again shortly." });
  }
  const after = await applySubscription(env, { id: b.subscription_id, plan_id: planIdFor(env, b.tier), status: "CANCELLED", custom_id: u.id });
  const v = after || u;
  return json({ ok: true, plan: effectivePlan(v), plan_until: v.plan_until || 0, billing: v.billing });
}

/** Best effort when an account is deleted: stop billing the person. */
export async function cancelOnDelete(env: Env, u: User): Promise<void> {
  const b = u.billing;
  if (!b || b.status !== "ACTIVE" || !billingConfigured(env)) return;
  try {
    await paypal(env, "POST", `/v1/billing/subscriptions/${encodeURIComponent(b.subscription_id)}/cancel`, { reason: "Blaze account deleted" });
  } catch (e) {
    console.error("cancel on delete", e);
  }
}

const HANDLED = new Set([
  "BILLING.SUBSCRIPTION.ACTIVATED", "BILLING.SUBSCRIPTION.UPDATED", "BILLING.SUBSCRIPTION.RE-ACTIVATED",
  "BILLING.SUBSCRIPTION.CANCELLED", "BILLING.SUBSCRIPTION.SUSPENDED", "BILLING.SUBSCRIPTION.EXPIRED",
  "PAYMENT.SALE.COMPLETED",
]);

export async function webhook(env: Env, req: Request): Promise<Response> {
  if (!billingConfigured(env) || !env.PAYPAL_WEBHOOK_ID) throw new HttpError(503, "not_configured", { what: "billing" });
  const raw = await req.text();
  if (raw.length > 256 * 1024) throw new HttpError(413, "too_large");
  let ev: { id?: string; event_type?: string; resource?: Record<string, unknown> };
  try {
    ev = JSON.parse(raw);
  } catch {
    throw new HttpError(400, "invalid_json");
  }
  const H = (n: string) => req.headers.get(n) || "";
  const fields = {
    auth_algo: H("paypal-auth-algo"), cert_url: H("paypal-cert-url"), transmission_id: H("paypal-transmission-id"),
    transmission_sig: H("paypal-transmission-sig"), transmission_time: H("paypal-transmission-time"), webhook_id: env.PAYPAL_WEBHOOK_ID,
  };
  if (!fields.transmission_id || !fields.transmission_sig || !fields.cert_url) throw new HttpError(400, "invalid_signature");
  // The event goes back byte for byte, so PayPal checks exactly what it signed.
  const vbody = JSON.stringify(fields).slice(0, -1) + `,"webhook_event":${raw}}`;
  const v = await paypal(env, "POST", "/v1/notifications/verify-webhook-signature", vbody);
  if (v.status >= 300 || v.data.verification_status !== "SUCCESS") {
    console.warn("paypal webhook failed verification", v.status, ev.event_type);
    throw new HttpError(400, "invalid_signature");
  }
  const type = String(ev.event_type || "");
  if (!HANDLED.has(type) || !ev.resource) return json({ ok: true, ignored: type });
  if (type === "PAYMENT.SALE.COMPLETED") {
    // A renewal: ask PayPal for the subscription's new billing time.
    const sid = String(ev.resource.billing_agreement_id || "");
    if (!sid) return json({ ok: true, ignored: "no subscription" });
    const r = await paypal(env, "GET", `/v1/billing/subscriptions/${encodeURIComponent(sid)}`);
    if (r.status >= 300) throw new HttpError(502, "billing_unavailable"); // PayPal retries the webhook
    await applySubscription(env, r.data as Subscription);
    return json({ ok: true });
  }
  const hint = type.split(".").pop() === "RE-ACTIVATED" ? "ACTIVE" : type.split(".").pop();
  const sub = ev.resource as Subscription;
  if (type === "BILLING.SUBSCRIPTION.UPDATED" && !sub.status) sub.status = "ACTIVE";
  await applySubscription(env, sub, hint);
  return json({ ok: true });
}

export async function adminPlan(env: Env, req: Request): Promise<Response> {
  const tok = /^Bearer\s+(.+)$/.exec(req.headers.get("Authorization") || "")?.[1]?.trim() || "";
  if (!env.ADMIN_TOKEN || env.ADMIN_TOKEN.length < 16) throw new HttpError(404, "not_found");
  if (!tok || !safeEqual(tok, env.ADMIN_TOKEN)) throw new HttpError(401, "unauthorized");
  const b = await readJSON(req);
  const email = normEmail(b.email);
  if (!email) throw new HttpError(400, "invalid_email");
  if (!isTier(b.plan)) throw new HttpError(400, "invalid_tier", { hint: "basic, pro or max" });
  const u = await userByEmail(env, email);
  if (!u) throw new HttpError(404, "no_such_user");
  const days = typeof b.days === "number" && b.days > 0 ? Math.min(b.days, 3650) : 0;
  if (b.plan === "basic") {
    u.plan = "basic";
    delete u.plan_until;
    delete u.plan_source;
  } else {
    u.plan = b.plan;
    u.plan_source = "admin";
    if (days) u.plan_until = now() + Math.round(days * 86400);
    else delete u.plan_until;
  }
  await putUser(env, u);
  return json({ ok: true, user: publicUser(u), plan_until: u.plan_until || 0 });
}
