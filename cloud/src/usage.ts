// Usage metering in D1 (binding "DB"), never KV: KV's free tier allows ~1,000 writes a
// day, D1's allows 100,000. Each chat request costs two small writes: one for the
// per-minute rate counter and one adding the request's tokens to today's total.
//
//   usage(uid, day, tokens, requests)   day = "YYYY-MM-DD" in UTC
//   rate(uid, minute, n)                minute = unix seconds / 60
//
// Schema: migrations/0001_usage.sql (wrangler d1 migrations apply blaze-usage --remote).

import { Env, HttpError } from "./util";
import { UTC_DAY } from "./tiers";

function db(env: Env): D1Database {
  if (!env.DB) throw new HttpError(503, "not_configured", { what: "usage_db", hint: "bind a D1 database as DB (see cloud/README.md)" });
  return env.DB;
}

export interface DayUsage {
  tokens: number;
  requests: number;
}

/** Today's tokens and requests for a user. */
export async function today(env: Env, uid: string): Promise<DayUsage> {
  const r = await db(env).prepare("SELECT tokens, requests FROM usage WHERE uid = ?1 AND day = ?2").bind(uid, UTC_DAY()).first<DayUsage>();
  return { tokens: Number(r?.tokens || 0), requests: Number(r?.requests || 0) };
}

/** Adds one finished request's tokens to today's total. */
export async function addUsage(env: Env, uid: string, tokens: number): Promise<void> {
  const t = Math.max(0, Math.round(tokens));
  await db(env)
    .prepare("INSERT INTO usage (uid, day, tokens, requests) VALUES (?1, ?2, ?3, 1) ON CONFLICT(uid, day) DO UPDATE SET tokens = tokens + ?3, requests = requests + 1")
    .bind(uid, UTC_DAY(), t)
    .run();
}

/** Counts a request in this minute's window and returns the count including it. */
export async function rateHit(env: Env, uid: string): Promise<{ n: number; retryAfter: number }> {
  const now = Math.floor(Date.now() / 1000);
  const minute = Math.floor(now / 60);
  const r = await db(env)
    .prepare("INSERT INTO rate (uid, minute, n) VALUES (?1, ?2, 1) ON CONFLICT(uid, minute) DO UPDATE SET n = n + 1 RETURNING n")
    .bind(uid, minute)
    .first<{ n: number }>();
  return { n: Number(r?.n || 1), retryAfter: (minute + 1) * 60 - now || 1 };
}

/** Drops old rate windows and usage older than 90 days (run now and then, off the hot path). */
export async function prune(env: Env): Promise<void> {
  const minute = Math.floor(Date.now() / 60000);
  const old = new Date(Date.now() - 90 * 86400_000).toISOString().slice(0, 10);
  await db(env).batch([
    db(env).prepare("DELETE FROM rate WHERE minute < ?1").bind(minute - 5),
    db(env).prepare("DELETE FROM usage WHERE day < ?1").bind(old),
  ]);
}

/** Removes a deleted account's rows. */
export async function deleteUsage(env: Env, uid: string): Promise<void> {
  if (!env.DB) return;
  await env.DB.batch([env.DB.prepare("DELETE FROM usage WHERE uid = ?1").bind(uid), env.DB.prepare("DELETE FROM rate WHERE uid = ?1").bind(uid)]);
}

/** Rough tokens for text when the provider sends no usage (about 4 characters a token). */
export function estimateTokens(chars: number): number {
  return Math.ceil(Math.max(0, chars) / 4);
}
