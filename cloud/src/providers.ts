// The OAuth providers the broker knows. One callback per provider, shared by Blaze
// account sign-in and connector linking: <BASE_URL>/oauth/<provider>/callback.

import { Env, HttpError } from "./util";

export type ProviderId = "google" | "github" | "spotify" | "notion" | "slack";

export interface Provider {
  id: ProviderId;
  name: string;
  authUrl: string;
  tokenUrl: string;
  /** Query parameter the scopes go in ("" = the provider has no scopes). */
  scopeParam: "scope" | "user_scope" | "";
  scopeSep: string;
  /** Connector scopes a desktop may ask for. */
  allowed: string[];
  /** Asked for when the desktop sends none. */
  defaults: string[];
  /** Scopes for "Sign in with ..." (only google and github sign in to Blaze). */
  login?: string[];
  authParams?: Record<string, string>;
  /** How the client authenticates at the token endpoint. */
  clientAuth: "body" | "basic";
  /** Notion wants a JSON body. */
  jsonBody?: boolean;
}

const G = "https://www.googleapis.com/auth/";

export const PROVIDERS: Record<ProviderId, Provider> = {
  google: {
    id: "google", name: "Google",
    authUrl: "https://accounts.google.com/o/oauth2/v2/auth", tokenUrl: "https://oauth2.googleapis.com/token",
    scopeParam: "scope", scopeSep: " ",
    allowed: ["openid", "email", "profile", G + "userinfo.email", G + "userinfo.profile",
      G + "gmail.readonly", G + "gmail.compose", G + "gmail.send", G + "gmail.modify",
      G + "calendar.events.readonly", G + "calendar.events", G + "calendar.readonly",
      G + "drive.readonly", G + "drive.file", G + "contacts.readonly"],
    defaults: ["openid", "email", G + "gmail.readonly", G + "calendar.events.readonly", G + "drive.readonly"],
    login: ["openid", "email", "profile"],
    authParams: { access_type: "offline", prompt: "consent", include_granted_scopes: "true" },
    clientAuth: "body",
  },
  github: {
    id: "github", name: "GitHub",
    authUrl: "https://github.com/login/oauth/authorize", tokenUrl: "https://github.com/login/oauth/access_token",
    scopeParam: "scope", scopeSep: " ",
    allowed: ["repo", "public_repo", "read:user", "user:email", "notifications", "read:org", "gist"],
    defaults: ["repo", "read:user", "notifications"],
    login: ["read:user", "user:email"],
    authParams: { allow_signup: "true" },
    clientAuth: "body",
  },
  spotify: {
    id: "spotify", name: "Spotify",
    authUrl: "https://accounts.spotify.com/authorize", tokenUrl: "https://accounts.spotify.com/api/token",
    scopeParam: "scope", scopeSep: " ",
    allowed: ["user-read-playback-state", "user-modify-playback-state", "user-read-currently-playing", "user-read-email",
      "user-read-private", "playlist-read-private", "user-library-read", "user-read-recently-played"],
    defaults: ["user-read-playback-state", "user-modify-playback-state", "user-read-currently-playing"],
    clientAuth: "basic",
  },
  notion: {
    id: "notion", name: "Notion",
    authUrl: "https://api.notion.com/v1/oauth/authorize", tokenUrl: "https://api.notion.com/v1/oauth/token",
    scopeParam: "", scopeSep: " ", allowed: [], defaults: [],
    authParams: { owner: "user" },
    clientAuth: "basic", jsonBody: true,
  },
  slack: {
    id: "slack", name: "Slack",
    authUrl: "https://slack.com/oauth/v2/authorize", tokenUrl: "https://slack.com/api/oauth.v2.access",
    scopeParam: "user_scope", scopeSep: ",",
    allowed: ["channels:read", "channels:history", "groups:read", "groups:history", "im:read", "im:history",
      "mpim:read", "mpim:history", "chat:write", "users:read", "users:read.email", "search:read"],
    defaults: ["channels:read", "channels:history", "groups:read", "groups:history", "chat:write", "users:read"],
    clientAuth: "body",
  },
};

export function provider(id: string): Provider {
  const p = (PROVIDERS as Record<string, Provider>)[id];
  if (!p) throw new HttpError(404, "unknown_provider");
  return p;
}

export function credentials(env: Env, id: ProviderId): { id: string; secret: string } | null {
  const k = id.toUpperCase();
  const e = env as unknown as Record<string, string | undefined>;
  const cid = (e[`${k}_CLIENT_ID`] || "").trim();
  const sec = (e[`${k}_CLIENT_SECRET`] || "").trim();
  return cid && sec ? { id: cid, secret: sec } : null;
}

export function callbackURL(env: Env, id: ProviderId): string {
  return `${env.BASE_URL.replace(/\/+$/, "")}/oauth/${id}/callback`;
}

/** Picks the connector scopes: the defaults when none are asked for, else only allowed ones. */
export function pickScopes(p: Provider, raw: string | null): string[] {
  if (!p.scopeParam) return [];
  const asked = (raw || "").split(/[\s,]+/).filter(Boolean);
  if (!asked.length) return p.defaults.slice();
  if (asked.length > 30) throw new HttpError(400, "invalid_scope");
  const bad = asked.filter(s => !p.allowed.includes(s));
  if (bad.length) throw new HttpError(400, "invalid_scope", { scopes: bad });
  return [...new Set(asked)];
}

/** What the desktop gets back: the provider's tokens, normalised. */
export interface Tokens {
  access_token: string;
  refresh_token?: string;
  token_type?: string;
  scope?: string;
  expires_in?: number;
  /** A display hint such as the Notion workspace or Slack team name. */
  account?: string;
}

export async function tokenRequest(p: Provider, creds: { id: string; secret: string }, params: Record<string, string>): Promise<Tokens> {
  const headers: Record<string, string> = { Accept: "application/json" };
  const body: Record<string, string> = { ...params };
  if (p.clientAuth === "basic") headers.Authorization = "Basic " + btoa(`${creds.id}:${creds.secret}`);
  else {
    body.client_id = creds.id;
    body.client_secret = creds.secret;
  }
  let payload: string;
  if (p.jsonBody) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  } else {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    payload = new URLSearchParams(body).toString();
  }
  let res: Response;
  try {
    res = await fetch(p.tokenUrl, { method: "POST", headers, body: payload });
  } catch {
    throw new HttpError(502, "provider_unreachable");
  }
  const text = await res.text();
  let d: Record<string, any> = {};
  try {
    d = JSON.parse(text);
  } catch {
    d = Object.fromEntries(new URLSearchParams(text));
  }
  // Slack puts the user token under authed_user and answers 200 with ok:false on errors.
  if (p.id === "slack") {
    if (d.ok === false) throw new HttpError(400, "provider_error", { provider_error: String(d.error || "unknown") });
    if (d.authed_user && d.authed_user.access_token) {
      const u = d.authed_user;
      return clean({ access_token: u.access_token, refresh_token: u.refresh_token, token_type: u.token_type || "user", scope: u.scope, expires_in: u.expires_in, account: d.team && d.team.name });
    }
  }
  if (!res.ok || d.error || !d.access_token) {
    throw new HttpError(400, "provider_error", { provider_error: String(d.error || `http_${res.status}`), description: d.error_description ? String(d.error_description).slice(0, 200) : undefined });
  }
  return clean({
    access_token: d.access_token, refresh_token: d.refresh_token, token_type: d.token_type, scope: d.scope,
    expires_in: d.expires_in != null ? Number(d.expires_in) : undefined,
    account: p.id === "notion" ? d.workspace_name : undefined,
  });
}

function clean(t: Record<string, any>): Tokens {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(t)) if (v !== undefined && v !== null && v !== "") out[k] = k === "expires_in" ? Number(v) : typeof v === "number" ? v : String(v);
  return out as Tokens;
}

/** The signed-in person, for Blaze account sign-in. */
export interface Profile {
  subject: string;
  email: string | null;
  emailVerified: boolean;
  name: string;
  avatar: string;
}

export async function fetchProfile(id: ProviderId, accessToken: string): Promise<Profile> {
  const hdr = { Authorization: `Bearer ${accessToken}`, Accept: "application/json", "User-Agent": "blaze-auth" };
  if (id === "google") {
    const r = await fetch("https://openidconnect.googleapis.com/v1/userinfo", { headers: hdr });
    if (!r.ok) throw new HttpError(502, "profile_failed");
    const d: any = await r.json();
    if (!d.sub) throw new HttpError(502, "profile_failed");
    return { subject: String(d.sub), email: d.email ? String(d.email) : null, emailVerified: d.email_verified === true || d.email_verified === "true", name: String(d.name || ""), avatar: String(d.picture || "") };
  }
  if (id === "github") {
    const r = await fetch("https://api.github.com/user", { headers: hdr });
    if (!r.ok) throw new HttpError(502, "profile_failed");
    const d: any = await r.json();
    let email: string | null = null;
    let verified = false;
    const er = await fetch("https://api.github.com/user/emails", { headers: hdr });
    if (er.ok) {
      const list: any[] = await er.json();
      const pri = Array.isArray(list) ? list.find(e => e.primary && e.verified) || list.find(e => e.verified) : null;
      if (pri) {
        email = String(pri.email);
        verified = true;
      }
    }
    return { subject: String(d.id), email, emailVerified: verified, name: String(d.name || d.login || ""), avatar: String(d.avatar_url || "") };
  }
  throw new HttpError(400, "login_not_supported");
}
