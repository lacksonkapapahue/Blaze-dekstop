// Plans (Basic, Pro, Max) and the models each one may use.
//
// A request names a Blaze model: a tier alias ("blaze-fast", "blaze-smart", "blaze-max")
// or one of the listed models ("kimi-k2", "gemini-2.5-pro", …). Each Blaze model maps to
// an ordered list of upstream routes (provider + upstream model id); the proxy tries them
// in order and skips providers whose key isn't set as a Worker secret.
//
// Everything here can be changed without a code change through the TIERS var (JSON):
//
//   {
//     "basic": {"daily_tokens": 80000},                 // any tier field, merged over the default
//     "pro":   {"rpm": 30},
//     "models": {                                       // add or replace Blaze models
//       "claude-sonnet": {"name": "Claude Sonnet", "tier": "max",
//                         "routes": [{"provider": "openrouter", "model": "anthropic/claude-sonnet-4.5"}]}
//     }
//   }

import type { Env } from "./util";

export type TierId = "basic" | "pro" | "max";
export const TIER_ORDER: TierId[] = ["basic", "pro", "max"];

export interface Tier {
  id: TierId;
  name: string;
  price_usd: number; // per month, for display; PayPal holds the real price
  daily_tokens: number; // prompt + completion tokens per UTC day
  rpm: number; // chat requests per minute
  max_output_tokens: number; // max_tokens is clamped to this
  default_model: string; // what "Auto" uses on this plan
}

export interface Route {
  provider: string;
  model: string;
  vision?: boolean; // can take image parts
}

export interface ModelDef {
  name: string;
  tier: TierId; // the lowest plan that may use it
  alias?: boolean; // a tier alias (Auto picks these)
  desc?: string;
  tools?: boolean; // false = can't call tools (default true)
  vision?: boolean;
  context?: number;
  routes: Route[];
}

export const DEFAULT_TIERS: Record<TierId, Tier> = {
  basic: { id: "basic", name: "Basic", price_usd: 0, daily_tokens: 50_000, rpm: 6, max_output_tokens: 4096, default_model: "blaze-fast" },
  pro: { id: "pro", name: "Pro", price_usd: 10, daily_tokens: 1_000_000, rpm: 20, max_output_tokens: 8192, default_model: "blaze-smart" },
  max: { id: "max", name: "Max", price_usd: 25, daily_tokens: 3_000_000, rpm: 40, max_output_tokens: 16384, default_model: "blaze-max" },
};

export const DEFAULT_MODELS: Record<string, ModelDef> = {
  "blaze-fast": {
    name: "Blaze Fast", tier: "basic", alias: true, desc: "Quick answers and everyday tasks", vision: true, context: 131072,
    routes: [
      { provider: "groq", model: "openai/gpt-oss-120b" },
      { provider: "cerebras", model: "gpt-oss-120b" },
      { provider: "gemini", model: "gemini-2.5-flash-lite", vision: true },
      { provider: "nvidia", model: "openai/gpt-oss-120b" },
      { provider: "openrouter", model: "openai/gpt-oss-120b:free" },
    ],
  },
  "blaze-smart": {
    name: "Blaze Smart", tier: "pro", alias: true, desc: "Stronger reasoning for real work", vision: true, context: 1048576,
    routes: [
      { provider: "gemini", model: "gemini-2.5-flash", vision: true },
      { provider: "groq", model: "moonshotai/kimi-k2-instruct-0905" },
      { provider: "nvidia", model: "deepseek-ai/deepseek-v3.1" },
      { provider: "openrouter", model: "deepseek/deepseek-chat-v3.1:free" },
    ],
  },
  "blaze-max": {
    name: "Blaze Max", tier: "max", alias: true, desc: "The strongest models for hard problems", vision: true, context: 1048576,
    routes: [
      { provider: "gemini", model: "gemini-2.5-pro", vision: true },
      { provider: "nvidia", model: "moonshotai/kimi-k2-instruct" },
      { provider: "groq", model: "moonshotai/kimi-k2-instruct-0905" },
      { provider: "openrouter", model: "qwen/qwen3-coder:free" },
    ],
  },
  "gpt-oss-120b": {
    name: "GPT-OSS 120B", tier: "basic", context: 131072,
    routes: [{ provider: "groq", model: "openai/gpt-oss-120b" }, { provider: "cerebras", model: "gpt-oss-120b" }, { provider: "nvidia", model: "openai/gpt-oss-120b" }],
  },
  "llama-3.3-70b": {
    name: "Llama 3.3 70B", tier: "basic", context: 131072,
    routes: [{ provider: "groq", model: "llama-3.3-70b-versatile" }, { provider: "cerebras", model: "llama-3.3-70b" }, { provider: "nvidia", model: "meta/llama-3.3-70b-instruct" }],
  },
  "gemini-2.5-flash": { name: "Gemini 2.5 Flash", tier: "pro", vision: true, context: 1048576, routes: [{ provider: "gemini", model: "gemini-2.5-flash", vision: true }] },
  "kimi-k2": {
    name: "Kimi K2", tier: "pro", context: 262144,
    routes: [{ provider: "groq", model: "moonshotai/kimi-k2-instruct-0905" }, { provider: "nvidia", model: "moonshotai/kimi-k2-instruct" }],
  },
  "deepseek-v3.1": { name: "DeepSeek V3.1", tier: "pro", context: 131072, routes: [{ provider: "nvidia", model: "deepseek-ai/deepseek-v3.1" }] },
  "qwen3-32b": { name: "Qwen3 32B", tier: "pro", context: 131072, routes: [{ provider: "groq", model: "qwen/qwen3-32b" }, { provider: "cerebras", model: "qwen-3-32b" }] },
  "gemini-2.5-pro": { name: "Gemini 2.5 Pro", tier: "max", vision: true, context: 1048576, routes: [{ provider: "gemini", model: "gemini-2.5-pro", vision: true }] },
};

/** Upstream providers (all OpenAI-compatible) and the Worker secret holding Joey's key. */
export const UPSTREAMS: Record<string, { url: string; secret: keyof Env }> = {
  groq: { url: "https://api.groq.com/openai/v1/chat/completions", secret: "GROQ_API_KEY" },
  cerebras: { url: "https://api.cerebras.ai/v1/chat/completions", secret: "CEREBRAS_API_KEY" },
  gemini: { url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", secret: "GEMINI_API_KEY" },
  openrouter: { url: "https://openrouter.ai/api/v1/chat/completions", secret: "OPENROUTER_API_KEY" },
  nvidia: { url: "https://integrate.api.nvidia.com/v1/chat/completions", secret: "NVIDIA_API_KEY" },
  mistral: { url: "https://api.mistral.ai/v1/chat/completions", secret: "MISTRAL_API_KEY" },
};

export function upstreamKey(env: Env, provider: string): string {
  const u = UPSTREAMS[provider];
  if (!u) return "";
  const v = env[u.secret];
  return typeof v === "string" ? v.trim() : "";
}

export interface Catalog {
  tiers: Record<TierId, Tier>;
  models: Record<string, ModelDef>;
}

let cached: { src: string; cat: Catalog } | null = null;

function num(v: unknown, d: number): number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : d;
}

/** The plans and models, with the TIERS var merged over the defaults. A broken TIERS is ignored (logged). */
export function catalog(env: Env): Catalog {
  const src = env.TIERS || "";
  if (cached && cached.src === src) return cached.cat;
  const tiers = structuredClone(DEFAULT_TIERS);
  const models = structuredClone(DEFAULT_MODELS);
  if (src.trim()) {
    try {
      const o = JSON.parse(src) as Record<string, unknown>;
      for (const id of TIER_ORDER) {
        const t = o[id] as Partial<Tier> | undefined;
        if (!t || typeof t !== "object") continue;
        const cur = tiers[id];
        if (typeof t.name === "string") cur.name = t.name;
        cur.price_usd = num(t.price_usd, cur.price_usd);
        cur.daily_tokens = num(t.daily_tokens, cur.daily_tokens);
        cur.rpm = num(t.rpm, cur.rpm);
        cur.max_output_tokens = num(t.max_output_tokens, cur.max_output_tokens);
        if (typeof t.default_model === "string") cur.default_model = t.default_model;
      }
      const ms = o.models as Record<string, ModelDef | null> | undefined;
      if (ms && typeof ms === "object") {
        for (const [id, m] of Object.entries(ms)) {
          if (m === null) {
            delete models[id];
            continue;
          }
          if (!m || !Array.isArray(m.routes) || !TIER_ORDER.includes(m.tier)) continue;
          const routes = m.routes.filter(r => r && typeof r.provider === "string" && typeof r.model === "string");
          if (routes.length) models[id] = { ...m, name: m.name || id, routes };
        }
      }
    } catch (e) {
      console.error("TIERS is not valid JSON; using the defaults", e);
    }
  }
  const cat = { tiers, models };
  cached = { src, cat };
  return cat;
}

export function tierRank(t: TierId): number {
  return TIER_ORDER.indexOf(t);
}

export function isTier(v: unknown): v is TierId {
  return typeof v === "string" && (TIER_ORDER as string[]).includes(v);
}

/** The next plan up, or null on Max. */
export function nextTier(t: TierId): TierId | null {
  return TIER_ORDER[tierRank(t) + 1] || null;
}

export function allowed(m: ModelDef, plan: TierId): boolean {
  return tierRank(m.tier) <= tierRank(plan);
}

/** A model is offered when at least one of its providers has a key. */
export function available(env: Env, m: ModelDef): boolean {
  return m.routes.some(r => !!upstreamKey(env, r.provider));
}

export const UTC_DAY = () => new Date().toISOString().slice(0, 10);

/** Unix seconds of the next UTC midnight, when daily usage resets. */
export function resetAt(): number {
  const d = new Date();
  return Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1) / 1000);
}
