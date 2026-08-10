/**
 * Direct Google OAuth for the gmail.send grant.
 *
 * Deliberately separate from the Supabase login in lib/auth.ts. Two reasons:
 *
 *   - Login should not ask for permission to send mail. Bundling the scopes
 *     means the very first sign-in shows a scary consent screen, and anyone who
 *     declines cannot even get in.
 *   - Supabase hands back provider_refresh_token exactly once, on the callback,
 *     and never refreshes Google tokens for you. Local dev has no Supabase
 *     configured at all, so sending would be impossible there.
 *
 * Owning the flow means the refresh token is ours to store and exchange, and
 * the cron runner — which has no session — can use it.
 */

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const REVOKE_ENDPOINT = "https://oauth2.googleapis.com/revoke";

/**
 * gmail.send is Google's narrowest mail scope: it can send, and it cannot read
 * the mailbox. It is "sensitive" rather than "restricted", which means app
 * verification but no third-party security assessment.
 */
export const SCOPES = [
  "https://www.googleapis.com/auth/gmail.send",
  "openid",
  "email",
  "profile",
] as const;

export function oauthConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET,
  );
}

function credentials(): { id: string; secret: string } {
  const id = process.env.GOOGLE_CLIENT_ID;
  const secret = process.env.GOOGLE_CLIENT_SECRET;
  if (!id || !secret) {
    throw new Error(
      "GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are not set. Create an OAuth client at console.cloud.google.com > APIs & Services > Credentials.",
    );
  }
  return { id, secret };
}

/**
 * Must be byte-identical between the consent redirect and the code exchange, or
 * Google returns redirect_uri_mismatch. APP_URL wins so a deployment behind a
 * proxy doesn't derive an internal origin.
 */
export function redirectUri(origin: string): string {
  const base = (process.env.APP_URL || origin).replace(/\/+$/, "");
  return `${base}/api/google/callback`;
}

export function authUrl(opts: { origin: string; state: string }): string {
  const { id } = credentials();
  const params = new URLSearchParams({
    client_id: id,
    redirect_uri: redirectUri(opts.origin),
    response_type: "code",
    scope: SCOPES.join(" "),
    // Without offline + consent Google returns an access token only, and the
    // cron job would stop being able to send an hour later.
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state: opts.state,
  });
  return `${AUTH_ENDPOINT}?${params}`;
}

interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
  id_token?: string;
}

async function tokenRequest(
  body: Record<string, string>,
): Promise<TokenResponse> {
  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const detail =
      (json.error_description as string) ||
      (json.error as string) ||
      `HTTP ${res.status}`;
    throw new Error(`Google token exchange failed: ${detail}`);
  }
  return json as unknown as TokenResponse;
}

export interface GrantedAccount {
  email: string;
  name: string | null;
  picture: string | null;
  refreshToken: string;
  scope: string;
}

/** Trades the one-time consent code for a long-lived refresh token. */
export async function exchangeCode(opts: {
  code: string;
  origin: string;
}): Promise<GrantedAccount> {
  const { id, secret } = credentials();
  const token = await tokenRequest({
    code: opts.code,
    client_id: id,
    client_secret: secret,
    redirect_uri: redirectUri(opts.origin),
    grant_type: "authorization_code",
  });

  if (!token.refresh_token) {
    throw new Error(
      "Google did not return a refresh token. Revoke this app at myaccount.google.com/permissions and connect again.",
    );
  }
  if (!token.scope?.includes("gmail.send")) {
    throw new Error(
      "The permission to send mail was not granted. Connect again and leave the send checkbox ticked.",
    );
  }

  const claims = idTokenClaims(token.id_token);
  if (!claims.email) {
    throw new Error("Google did not return an email address for this account.");
  }

  return {
    email: claims.email.toLowerCase(),
    name: claims.name ?? null,
    picture: claims.picture ?? null,
    refreshToken: token.refresh_token,
    scope: token.scope ?? "",
  };
}

/**
 * The id_token arrived over TLS straight from Google's token endpoint in
 * response to a request carrying our client secret, so the payload is read
 * without verifying the signature — there is no untrusted hop to defend against.
 */
function idTokenClaims(idToken: string | undefined): {
  email?: string;
  name?: string;
  picture?: string;
} {
  if (!idToken) return {};
  const payload = idToken.split(".")[1];
  if (!payload) return {};
  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return {};
  }
}

/**
 * Access tokens last an hour. Cached in module memory so a burst of sends costs
 * one refresh rather than one per message; the 60s margin covers clock skew and
 * the time the send itself takes.
 */
const cache = new Map<string, { token: string; expiresAt: number }>();

export async function accessToken(
  email: string,
  refreshToken: string,
): Promise<string> {
  const hit = cache.get(email);
  if (hit && hit.expiresAt > Date.now()) return hit.token;

  const { id, secret } = credentials();
  const token = await tokenRequest({
    client_id: id,
    client_secret: secret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });

  cache.set(email, {
    token: token.access_token,
    expiresAt: Date.now() + (token.expires_in - 60) * 1000,
  });
  return token.access_token;
}

export function forgetAccessToken(email: string): void {
  cache.delete(email);
}

/** Best-effort: tells Google to drop the grant so it also disappears from the
 * user's account permissions page, not just our database. */
export async function revoke(refreshToken: string): Promise<void> {
  await fetch(REVOKE_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token: refreshToken }),
  }).catch(() => {});
}
