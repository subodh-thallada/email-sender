import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * Google login via Supabase Auth, plus an email allowlist.
 *
 * Two separate things, easily confused:
 *   - This gates who may USE the app (and therefore spend your API credits).
 *   - Sending mail as you is still the Gmail App Password, untouched by this.
 */

export function authConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}

/**
 * Deploying without auth would leave your keys open to anyone with the URL, so
 * production refuses to serve rather than silently running unprotected.
 * Local development stays open — nobody else can reach localhost.
 */
export function authRequired(): boolean {
  return process.env.NODE_ENV === "production";
}

/** Empty allowlist means "any Google account that logs in", which is rarely what you want. */
export function allowedEmails(): string[] {
  return (process.env.ALLOWED_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export function isAllowed(email: string | null | undefined): boolean {
  if (!email) return false;
  const list = allowedEmails();
  if (list.length === 0) return true;
  return list.includes(email.toLowerCase());
}

export async function supabaseServer() {
  const store = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => store.getAll(),
        setAll: (list) => {
          try {
            for (const { name, value, options } of list) {
              store.set(name, value, options);
            }
          } catch {
            // Called from a Server Component — the middleware refreshes instead.
          }
        },
      },
    },
  );
}

export interface SessionUser {
  email: string;
  name: string | null;
  avatar: string | null;
}

/** The signed-in, allowlisted user — or null. */
export async function currentUser(): Promise<SessionUser | null> {
  if (!authConfigured()) return null;
  const supabase = await supabaseServer();
  // getUser() revalidates with Supabase; getSession() trusts the cookie alone.
  const { data } = await supabase.auth.getUser();
  const user = data.user;
  if (!user?.email || !isAllowed(user.email)) return null;
  return {
    email: user.email,
    name: (user.user_metadata?.full_name as string) ?? null,
    avatar: (user.user_metadata?.avatar_url as string) ?? null,
  };
}

/**
 * Guard for route handlers. Returns a Response to short-circuit with, or null
 * when the caller may proceed.
 */
export async function requireUser(): Promise<Response | null> {
  if (!authRequired() && !authConfigured()) return null;
  if (!authConfigured()) {
    return Response.json(
      {
        ok: false,
        error:
          "Auth is not configured but this is a production deployment. Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY and ALLOWED_EMAILS.",
      },
      { status: 503 },
    );
  }
  const user = await currentUser();
  if (!user) {
    return Response.json({ ok: false, error: "Not signed in." }, { status: 401 });
  }
  return null;
}
