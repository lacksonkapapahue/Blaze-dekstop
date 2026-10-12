// Skill sync for Blaze accounts: the user's own skills (the ones Blaze learned or they wrote,
// not the bundled library) follow the account across Blaze Android, Desktop and CLI.
//
//   GET  /v1/skills  (Bearer session) -> {rev, blob, key, updated_at}
//   POST /v1/skills  {rev, blob}      -> {rev}; 409 {error:"conflict", rev} when another device wrote first
//
// Same shape and the same per-account blob key as /v1/keys (keys.ts), with a larger limit,
// because skills carry text files. The Worker only ever sees ciphertext:
//
//   blob      = base64(nonce[12] || AES-256-GCM(gzip(json), aad "blaze-skills-v1"))
//   json      = {"v":1,"skills":{"<name>":{"t":<unix ms>,"files":{"SKILL.md":"…","assets/x.html":"…"}}}}
//
// An empty "files" with a "t" is a deletion. Per skill the newer "t" wins.
// KV: skills:<uid> = {rev, blob, updated_at}. One write per change, nothing on reads.

import { Env, HttpError, json, readJSON } from "./util";
import type { User } from "./accounts";
import { blobKey } from "./keys";

export const MAX_SKILLS_BLOB = 2 * 1024 * 1024; // base64 chars (~1.5 MB of gzip): hundreds of skills
const B64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

interface Stored {
  rev: number;
  blob: string;
  updated_at: number;
}

export async function getSkills(env: Env, u: User): Promise<Response> {
  const s = (await env.KV.get<Stored>(`skills:${u.id}`, "json")) || { rev: 0, blob: "", updated_at: 0 };
  return json({ rev: s.rev, blob: s.blob, updated_at: s.updated_at, key: await blobKey(env, u.id) }, 200, { "Cache-Control": "no-store" });
}

export async function putSkills(env: Env, u: User, req: Request): Promise<Response> {
  const b = await readJSON(req, MAX_SKILLS_BLOB + 1024);
  const blob = typeof b.blob === "string" ? b.blob : "";
  const rev = typeof b.rev === "number" && Number.isInteger(b.rev) && b.rev >= 0 ? b.rev : -1;
  if (rev < 0) throw new HttpError(400, "invalid_rev");
  if (!blob || blob.length > MAX_SKILLS_BLOB || blob.length < 40 || !B64_RE.test(blob)) throw new HttpError(400, "invalid_blob");
  const k = `skills:${u.id}`;
  const cur = (await env.KV.get<Stored>(k, "json")) || { rev: 0, blob: "", updated_at: 0 };
  if (cur.rev !== rev) throw new HttpError(409, "conflict", { rev: cur.rev });
  const next: Stored = { rev: cur.rev + 1, blob, updated_at: Math.floor(Date.now() / 1000) };
  await env.KV.put(k, JSON.stringify(next));
  return json({ rev: next.rev, updated_at: next.updated_at });
}

export async function deleteSkills(env: Env, uid: string): Promise<void> {
  await env.KV.delete(`skills:${uid}`);
}
