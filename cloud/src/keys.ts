// Leftovers of model-key sync (retired in blaze-auth 0.9.0: Blaze provides the models
// through the account's plan, and /v1/keys answers 410 Gone).
//
// Kept: the per-account blob key (keykey:<uid>), which skill sync (skills.ts) still uses
// to encrypt its blob, and deleteKeys, so deleting an account also removes any keys
// blob an older app synced (keys:<uid>).

import { Env } from "./util";

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

export async function deleteKeys(env: Env, uid: string): Promise<void> {
  await env.KV.delete(`keys:${uid}`);
  await env.KV.delete(`keykey:${uid}`);
}
