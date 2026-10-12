// Model-key sync for Blaze accounts: one encrypted blob per account that Blaze Desktop,
// Blaze CLI and Blaze Android merge into their own key stores.
//
//   GET  /v1/keys  (Bearer session) -> {rev, blob, key, updated_at}
//   POST /v1/keys  {rev, blob}      -> {rev}; 409 {error:"conflict", rev} when another device wrote first
//
// The Worker never sees a model key in the clear: clients encrypt the blob with
// AES-256-GCM before sending it. The blob key ("key", 32 random bytes) is made here on
// first use and kept in its own KV record, so the blob alone (logs, a leaked value)
// reveals nothing. It is handed to every signed-in session of the account, so this is
// not end-to-end encryption: whoever controls this Worker and its KV could decrypt.
//
// KV: keys:<uid> = {rev, blob, updated_at}; keykey:<uid> = base64 key. One write per
// change (plus one the first time), nothing on reads.

import { Env, HttpError, json, readJSON } from "./util";
import type { User } from "./accounts";

const MAX_BLOB = 64 * 1024; // base64 chars; a few hundred keys fit easily
const B64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

interface Stored {
  rev: number;
  blob: string;
  updated_at: number;
}

function b64(bytes: Uint8Array): string {
  let s = "";
  for (const c of bytes) s += String.fromCharCode(c);
  return btoa(s);
}

export async function blobKey(env: Env, uid: string): Promise<string> {
  const k = `keykey:${uid}`;
  const have = await env.KV.get(k);
  if (have) return have;
  const raw = new Uint8Array(32);
  crypto.getRandomValues(raw);
  const v = b64(raw);
  await env.KV.put(k, v);
  return v;
}

export async function getKeys(env: Env, u: User): Promise<Response> {
  const s = (await env.KV.get<Stored>(`keys:${u.id}`, "json")) || { rev: 0, blob: "", updated_at: 0 };
  return json({ rev: s.rev, blob: s.blob, updated_at: s.updated_at, key: await blobKey(env, u.id) }, 200, { "Cache-Control": "no-store" });
}

export async function putKeys(env: Env, u: User, req: Request): Promise<Response> {
  const b = await readJSON(req, MAX_BLOB + 1024);
  const blob = typeof b.blob === "string" ? b.blob : "";
  const rev = typeof b.rev === "number" && Number.isInteger(b.rev) && b.rev >= 0 ? b.rev : -1;
  if (rev < 0) throw new HttpError(400, "invalid_rev");
  if (!blob || blob.length > MAX_BLOB || !B64_RE.test(blob) || blob.length < 40) throw new HttpError(400, "invalid_blob");
  const k = `keys:${u.id}`;
  const cur = (await env.KV.get<Stored>(k, "json")) || { rev: 0, blob: "", updated_at: 0 };
  // KV is eventually consistent, so this is best effort; clients merge again on 409.
  if (cur.rev !== rev) throw new HttpError(409, "conflict", { rev: cur.rev });
  const next: Stored = { rev: cur.rev + 1, blob, updated_at: Math.floor(Date.now() / 1000) };
  await env.KV.put(k, JSON.stringify(next));
  return json({ rev: next.rev, updated_at: next.updated_at });
}

export async function deleteKeys(env: Env, uid: string): Promise<void> {
  await env.KV.delete(`keys:${uid}`);
  await env.KV.delete(`keykey:${uid}`);
}
