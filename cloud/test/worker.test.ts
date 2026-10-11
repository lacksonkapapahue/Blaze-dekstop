import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import worker from "../src/index";
import { b64url, hashPassword, verifyPassword, loopbackRedirect, normEmail } from "../src/util";
import type { Env } from "../src/util";

// In-memory KV with TTLs, enough of the KVNamespace API for the Worker.
class FakeKV {
  m = new Map<string, { v: string; exp: number }>();
  writes = 0;
  async get(k: string, type?: string): Promise<any> {
    const e = this.m.get(k);
    if (!e || (e.exp && e.exp < Date.now())) return null;
    return type === "json" ? JSON.parse(e.v) : e.v;
  }
  async put(k: string, v: string, o?: { expirationTtl?: number }) {
    this.writes++;
    this.m.set(k, { v, exp: o && o.expirationTtl ? Date.now() + o.expirationTtl * 1000 : 0 });
  }
  async delete(k: string) {
    this.m.delete(k);
  }
  keys(prefix: string) {
    return [...this.m.keys()].filter(k => k.startsWith(prefix));
  }
}

const BASE = "https://blaze-auth.blaze-app.workers.dev";
let kv: FakeKV;
let env: Env;
let ipN = 0;

function call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const h: Record<string, string> = { "CF-Connecting-IP": headers.ip || `10.0.0.${ipN}`, ...headers };
  delete h.ip;
  if (body !== undefined) h["Content-Type"] = "application/json";
  return worker.fetch(new Request(BASE + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }), env);
}

async function pkce() {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  const verifier = b64url(b);
  const challenge = b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  return { verifier, challenge };
}

beforeEach(() => {
  kv = new FakeKV();
  ipN++;
  env = { KV: kv as unknown as KVNamespace, BASE_URL: BASE, PBKDF2_ITERATIONS: "10000" };
});
afterEach(() => vi.unstubAllGlobals());

describe("helpers", () => {
  it("hashes and verifies passwords", async () => {
    const h = await hashPassword("correct horse", 10000);
    expect(h.startsWith("pbkdf2$sha256$10000$")).toBe(true);
    expect(await verifyPassword("correct horse", h)).toBe(true);
    expect(await verifyPassword("wrong horse", h)).toBe(false);
  });
  it("only accepts loopback redirects", () => {
    expect(loopbackRedirect("http://127.0.0.1:43117/cb")).toBe("http://127.0.0.1:43117/cb");
    expect(loopbackRedirect("http://[::1]:5000/cb")).toBe("http://[::1]:5000/cb");
    for (const bad of ["https://127.0.0.1:43117/cb", "http://localhost:43117/cb", "http://127.0.0.1/cb", "http://127.0.0.1:80/cb",
      "http://evil.com:4000/cb", "http://127.0.0.1.evil.com:4000/", "http://user@127.0.0.1:4000/", "http://127.0.0.1:4000/cb?x=1", null])
      expect(loopbackRedirect(bad)).toBeNull();
  });
  it("normalises emails", () => {
    expect(normEmail("  Luke@Example.COM ")).toBe("luke@example.com");
    expect(normEmail("not-an-email")).toBeNull();
    expect(normEmail("a@b")).toBeNull();
  });
});

describe("health and discovery", () => {
  it("answers /health", async () => {
    const r = await call("GET", "/health");
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ ok: true, service: "blaze-auth" });
  });
  it("lists configured providers", async () => {
    env.GOOGLE_CLIENT_ID = "gid";
    env.GOOGLE_CLIENT_SECRET = "gsec";
    const d: any = await (await call("GET", "/v1/providers")).json();
    expect(d.login).toEqual({ email: true, google: true, github: false });
    expect(d.connectors).toEqual({ google: true, github: false, spotify: false, notion: false, slack: false });
  });
});

describe("email + password accounts", () => {
  it("signs up, signs in, reads /v1/me, logs out and deletes", async () => {
    let r = await call("POST", "/v1/auth/signup", { email: "Luke@Example.com", password: "hunter2hunter2", name: "Luke" });
    expect(r.status).toBe(201);
    const s: any = await r.json();
    expect(s.token).toMatch(/^bz_/);
    expect(s.user).toMatchObject({ email: "luke@example.com", name: "Luke", has_password: true, email_verified: false });
    expect(JSON.stringify([...kv.m.values()])).not.toContain(s.token); // only the hash is stored

    r = await call("POST", "/v1/auth/signup", { email: "luke@example.com", password: "another-password" });
    expect(r.status).toBe(409);

    r = await call("POST", "/v1/auth/login", { email: "luke@example.com", password: "hunter2hunter2" });
    expect(r.status).toBe(200);
    const l: any = await r.json();

    r = await call("GET", "/v1/me", undefined, { Authorization: `Bearer ${l.token}` });
    expect(r.status).toBe(200);
    expect(((await r.json()) as any).user.email).toBe("luke@example.com");

    r = await call("POST", "/v1/logout", undefined, { Authorization: `Bearer ${l.token}` });
    expect(r.status).toBe(200);
    r = await call("GET", "/v1/me", undefined, { Authorization: `Bearer ${l.token}` });
    expect(r.status).toBe(401);

    r = await call("POST", "/v1/account/delete", {}, { Authorization: `Bearer ${s.token}` });
    expect(r.status).toBe(400);
    r = await call("POST", "/v1/account/delete", { confirm: "delete" }, { Authorization: `Bearer ${s.token}` });
    expect(r.status).toBe(200);
    expect(kv.keys("user:").length + kv.keys("email:").length + kv.keys("sess:").length).toBe(0);
    r = await call("POST", "/v1/auth/login", { email: "luke@example.com", password: "hunter2hunter2" });
    expect(r.status).toBe(401);
  });

  it("validates input", async () => {
    expect((await call("POST", "/v1/auth/signup", { email: "nope", password: "hunter2hunter2" })).status).toBe(400);
    expect((await call("POST", "/v1/auth/signup", { email: "a@b.co", password: "short" })).status).toBe(400);
    const bad = await worker.fetch(new Request(BASE + "/v1/auth/login", { method: "POST", body: "{not json", headers: { "Content-Type": "application/json" } }), env);
    expect(bad.status).toBe(400);
    expect((await call("GET", "/v1/me", undefined, { Authorization: "Bearer junk" })).status).toBe(401);
  });

  it("rate-limits failed sign-ins per email", async () => {
    await call("POST", "/v1/auth/signup", { email: "rl@example.com", password: "hunter2hunter2" });
    const codes: number[] = [];
    for (let i = 0; i < 10; i++) codes.push((await call("POST", "/v1/auth/login", { email: "rl@example.com", password: "wrong-password" }, { ip: `10.9.${i}.1` })).status);
    expect(codes.slice(0, 8).every(c => c === 401)).toBe(true);
    expect(codes[8]).toBe(429);
    // Even the right password waits out the window.
    expect((await call("POST", "/v1/auth/login", { email: "rl@example.com", password: "hunter2hunter2" }, { ip: "10.9.99.1" })).status).toBe(429);
  });
});

describe("CORS", () => {
  it("refuses unknown browser origins and allows configured ones", async () => {
    let r = await call("POST", "/v1/auth/login", { email: "a@b.co", password: "x" }, { Origin: "https://evil.example" });
    expect(r.status).toBe(403);
    r = await call("OPTIONS", "/v1/me", undefined, { Origin: "https://evil.example" });
    expect(r.status).toBe(403);
    env.ALLOWED_ORIGINS = "wails://wails";
    r = await call("OPTIONS", "/v1/me", undefined, { Origin: "wails://wails" });
    expect(r.status).toBe(204);
    expect(r.headers.get("Access-Control-Allow-Origin")).toBe("wails://wails");
  });
});

describe("connector broker", () => {
  it("returns not_configured without secrets", async () => {
    const { challenge } = await pkce();
    const r = await call("GET", `/oauth/spotify/start?state=${"s".repeat(24)}&code_challenge=${challenge}&redirect=${encodeURIComponent("http://127.0.0.1:5555/cb")}`);
    expect(r.status).toBe(503);
    expect(await r.json()).toMatchObject({ error: "not_configured" });
    expect((await call("POST", "/oauth/spotify/refresh", { refresh_token: "x" })).status).toBe(503);
  });

  it("rejects non-loopback redirects and bad scopes", async () => {
    env.GOOGLE_CLIENT_ID = "gid";
    env.GOOGLE_CLIENT_SECRET = "gsec";
    const { challenge } = await pkce();
    let r = await call("GET", `/oauth/google/start?state=${"s".repeat(24)}&code_challenge=${challenge}&redirect=${encodeURIComponent("https://evil.example/cb")}`);
    expect(r.status).toBe(400);
    r = await call("GET", `/oauth/google/start?state=${"s".repeat(24)}&code_challenge=${challenge}&redirect=${encodeURIComponent("http://127.0.0.1:5555/cb")}&scope=${encodeURIComponent("https://www.googleapis.com/auth/cloud-platform")}`);
    expect(r.status).toBe(400);
    expect(await r.json()).toMatchObject({ error: "invalid_scope" });
  });

  it("runs start -> callback -> redeem with PKCE, then refresh", async () => {
    env.GOOGLE_CLIENT_ID = "gid";
    env.GOOGLE_CLIENT_SECRET = "gsec";
    const seen: any[] = [];
    vi.stubGlobal("fetch", async (u: string, init: RequestInit) => {
      const body = Object.fromEntries(new URLSearchParams(String(init.body)));
      seen.push({ u, body });
      if (body.grant_type === "refresh_token") return new Response(JSON.stringify({ access_token: "ya29.new", expires_in: 3599, token_type: "Bearer" }));
      return new Response(JSON.stringify({ access_token: "ya29.abc", refresh_token: "1//rt", expires_in: 3599, scope: "openid https://www.googleapis.com/auth/gmail.readonly", token_type: "Bearer" }));
    });
    const { verifier, challenge } = await pkce();
    const ds = "desktop-state-123456";
    let r = await call("GET", `/oauth/google/start?state=${ds}&code_challenge=${challenge}&redirect=${encodeURIComponent("http://127.0.0.1:5555/cb")}&scope=${encodeURIComponent("openid https://www.googleapis.com/auth/gmail.readonly")}`);
    expect(r.status).toBe(302);
    const auth = new URL(r.headers.get("Location") as string);
    expect(auth.origin + auth.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(auth.searchParams.get("redirect_uri")).toBe(BASE + "/oauth/google/callback");
    expect(auth.searchParams.get("access_type")).toBe("offline");
    expect(auth.searchParams.get("client_secret")).toBeNull();
    const st = auth.searchParams.get("state") as string;
    expect(st).not.toBe(ds);
    expect(kv.keys("oauthstate:").length).toBe(1);

    r = await call("GET", `/oauth/google/callback?state=${st}&code=4/provider-code`);
    expect(r.status).toBe(302);
    const loop = new URL(r.headers.get("Location") as string);
    expect(loop.origin + loop.pathname).toBe("http://127.0.0.1:5555/cb");
    expect(loop.searchParams.get("state")).toBe(ds);
    expect(loop.searchParams.get("flow")).toBe("connect");
    expect(loop.search).not.toContain("ya29");
    expect(seen[0].body).toMatchObject({ code: "4/provider-code", client_secret: "gsec", redirect_uri: BASE + "/oauth/google/callback" });
    // The state is single use.
    expect((await call("GET", `/oauth/google/callback?state=${st}&code=again`)).status).toBe(400);

    const code = loop.searchParams.get("code") as string;
    // The tokens wait in KV for 2 minutes at most (Worker 0.5.1; was 5).
    const held = kv.m.get(kv.keys("oauthcode:")[0] as string);
    expect(held && held.exp - Date.now()).toBeLessThanOrEqual(120_000);
    const wrong = (await pkce()).verifier;
    expect((await call("POST", "/oauth/redeem", { code, code_verifier: wrong })).status).toBe(400);
    r = await call("POST", "/oauth/redeem", { code, code_verifier: verifier });
    expect(r.status).toBe(200);
    const d: any = await r.json();
    expect(d).toMatchObject({ kind: "tokens", provider: "google", tokens: { access_token: "ya29.abc", refresh_token: "1//rt", expires_in: 3599 } });
    expect((await call("POST", "/oauth/redeem", { code, code_verifier: verifier })).status).toBe(400); // one-time
    expect(kv.keys("oauthcode:").length + kv.keys("oauthstate:").length).toBe(0);

    r = await call("POST", "/oauth/google/refresh", { refresh_token: "1//rt" });
    expect(await r.json()).toMatchObject({ kind: "tokens", tokens: { access_token: "ya29.new" } });
  });

  it("hands provider errors back to the desktop", async () => {
    env.SPOTIFY_CLIENT_ID = "sid";
    env.SPOTIFY_CLIENT_SECRET = "ssec";
    const { challenge } = await pkce();
    let r = await call("GET", `/oauth/spotify/start?state=${"d".repeat(20)}&code_challenge=${challenge}&redirect=${encodeURIComponent("http://127.0.0.1:6000/cb")}`);
    const st = new URL(r.headers.get("Location") as string).searchParams.get("state");
    r = await call("GET", `/oauth/spotify/callback?state=${st}&error=access_denied`);
    const loop = new URL(r.headers.get("Location") as string);
    expect(loop.searchParams.get("error")).toBe("access_denied");
    expect(loop.searchParams.get("code")).toBeNull();
  });

  it("normalises Slack user tokens", async () => {
    env.SLACK_CLIENT_ID = "x";
    env.SLACK_CLIENT_SECRET = "y";
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ ok: true, team: { name: "Acme" }, authed_user: { access_token: "xoxp-1", scope: "chat:write,users:read", token_type: "user" } })));
    const { verifier, challenge } = await pkce();
    let r = await call("GET", `/oauth/slack/start?state=${"e".repeat(20)}&code_challenge=${challenge}&redirect=${encodeURIComponent("http://127.0.0.1:6001/cb")}`);
    const auth = new URL(r.headers.get("Location") as string);
    expect(auth.searchParams.get("user_scope")).toContain("chat:write");
    r = await call("GET", `/oauth/slack/callback?state=${auth.searchParams.get("state")}&code=c`);
    const code = new URL(r.headers.get("Location") as string).searchParams.get("code");
    const d: any = await (await call("POST", "/oauth/redeem", { code, code_verifier: verifier })).json();
    expect(d.tokens).toMatchObject({ access_token: "xoxp-1", account: "Acme" });
    expect(d.scopes).toEqual(["chat:write", "users:read"]);
  });
});

describe("sign in with GitHub / Google", () => {
  function stubGitHub(email: string) {
    vi.stubGlobal("fetch", async (u: string) => {
      if (u.includes("access_token")) return new Response(JSON.stringify({ access_token: "gho_x", token_type: "bearer", scope: "read:user,user:email" }));
      if (u.endsWith("/user")) return new Response(JSON.stringify({ id: 42, login: "lacksonkapapahue", name: "Lackson", avatar_url: "https://a/x.png" }));
      if (u.endsWith("/user/emails")) return new Response(JSON.stringify([{ email, primary: true, verified: true }]));
      return new Response("{}", { status: 404 });
    });
  }
  async function githubLogin() {
    const { verifier, challenge } = await pkce();
    let r = await call("GET", `/v1/auth/github/start?state=${"g".repeat(20)}&code_challenge=${challenge}&redirect=${encodeURIComponent("http://127.0.0.1:7000/cb")}`);
    expect(r.status).toBe(302);
    const auth = new URL(r.headers.get("Location") as string);
    expect(auth.searchParams.get("redirect_uri")).toBe(BASE + "/oauth/github/callback"); // same callback as the connector
    expect(auth.searchParams.get("scope")).toBe("read:user user:email");
    r = await call("GET", `/oauth/github/callback?state=${auth.searchParams.get("state")}&code=c`);
    const loop = new URL(r.headers.get("Location") as string);
    expect(loop.searchParams.get("flow")).toBe("login");
    r = await call("POST", "/v1/auth/redeem", { code: loop.searchParams.get("code"), code_verifier: verifier });
    expect(r.status).toBe(200);
    return (await r.json()) as any;
  }

  it("creates an account, then signs in to the same one", async () => {
    env.GITHUB_CLIENT_ID = "x";
    env.GITHUB_CLIENT_SECRET = "y";
    stubGitHub("luke@example.com");
    const a = await githubLogin();
    expect(a).toMatchObject({ kind: "session", user: { email: "luke@example.com", providers: ["github"], email_verified: true, has_password: false } });
    const b = await githubLogin();
    expect(b.user.id).toBe(a.user.id);
    const me: any = await (await call("GET", "/v1/me", undefined, { Authorization: `Bearer ${b.token}` })).json();
    expect(me.user.name).toBe("Lackson");
  });

  it("a verified provider email takes over an unverified password account", async () => {
    env.GITHUB_CLIENT_ID = "x";
    env.GITHUB_CLIENT_SECRET = "y";
    const pre: any = await (await call("POST", "/v1/auth/signup", { email: "victim@example.com", password: "attacker-pass" })).json();
    stubGitHub("victim@example.com");
    const a = await githubLogin();
    expect(a.user.id).toBe(pre.user.id);
    expect(a.user.has_password).toBe(false);
    expect((await call("GET", "/v1/me", undefined, { Authorization: `Bearer ${pre.token}` })).status).toBe(401);
    expect((await call("POST", "/v1/auth/login", { email: "victim@example.com", password: "attacker-pass" })).status).toBe(401);
  });

  it("does not offer sign-in for connector-only providers", async () => {
    env.SPOTIFY_CLIENT_ID = "x";
    env.SPOTIFY_CLIENT_SECRET = "y";
    const { challenge } = await pkce();
    expect((await call("GET", `/v1/auth/spotify/start?state=${"g".repeat(20)}&code_challenge=${challenge}&redirect=${encodeURIComponent("http://127.0.0.1:7000/cb")}`)).status).toBe(404);
  });
});

describe("model key sync", () => {
  async function session(email: string) {
    const r = await call("POST", "/v1/auth/signup", { email, password: "hunter2hunter2" });
    return ((await r.json()) as { token: string }).token;
  }
  const blob = btoa("x".repeat(60));

  it("stores one encrypted blob per account with a revision check", async () => {
    const a = await session("keys-a@example.com");
    const b = await session("keys-b@example.com");
    const A = { Authorization: `Bearer ${a}` };
    expect((await call("GET", "/v1/keys")).status).toBe(401);

    let r = await call("GET", "/v1/keys", undefined, A);
    expect(r.status).toBe(200);
    const g = (await r.json()) as { rev: number; blob: string; key: string };
    expect(g.rev).toBe(0);
    expect(g.blob).toBe("");
    expect(atob(g.key).length).toBe(32);
    const again = (await (await call("GET", "/v1/keys", undefined, A)).json()) as { key: string };
    expect(again.key).toBe(g.key); // stable per account

    r = await call("POST", "/v1/keys", { rev: 0, blob }, A);
    expect(r.status).toBe(200);
    expect(((await r.json()) as { rev: number }).rev).toBe(1);
    r = await call("POST", "/v1/keys", { rev: 0, blob }, A);
    expect(r.status).toBe(409);
    expect(await r.json()).toMatchObject({ error: "conflict", rev: 1 });

    for (const bad of [{ rev: 1, blob: "not base64!" }, { rev: 1, blob: "" }, { rev: 1, blob: "A".repeat(66000) }, { rev: -1, blob }, { blob }])
      expect((await call("POST", "/v1/keys", bad, A)).status).toBe(400);

    // Another account sees nothing of it and gets its own key.
    const other = (await (await call("GET", "/v1/keys", undefined, { Authorization: `Bearer ${b}` })).json()) as { rev: number; key: string };
    expect(other.rev).toBe(0);
    expect(other.key).not.toBe(g.key);

    const got = (await (await call("GET", "/v1/keys", undefined, A)).json()) as { rev: number; blob: string };
    expect(got).toMatchObject({ rev: 1, blob });

    expect((await call("POST", "/v1/account/delete", { confirm: "delete" }, A)).status).toBe(200);
    expect(kv.m.has(`keys:${(await kvUser("keys-a@example.com"))}`)).toBe(false);
    expect(kv.keys("keykey:").length).toBe(1); // only b's key is left
  });

  async function kvUser(email: string) {
    return kv.m.get(`email:${email}`)?.v ?? "deleted";
  }
});
