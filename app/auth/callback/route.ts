import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { isAllowed } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** Exchanges the OAuth code for a session, then enforces the allowlist. */
export async function GET(req: NextRequest) {
  const url = req.nextUrl;
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next") || "/";
  const oauthError = url.searchParams.get("error_description");

  const fail = (message: string) => {
    const to = url.clone();
    to.pathname = "/login";
    to.search = `?error=${encodeURIComponent(message)}`;
    return NextResponse.redirect(to);
  };

  if (oauthError) return fail(oauthError);
  if (!code) return fail("No authorization code returned by Google.");

  let res = NextResponse.redirect(new URL(next, url.origin));

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => req.cookies.getAll(),
        setAll: (list) => {
          for (const { name, value, options } of list) {
            res.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return fail(error.message);

  if (!isAllowed(data.user?.email)) {
    // Don't leave a usable session behind for an account we just rejected.
    await supabase.auth.signOut();
    const to = url.clone();
    to.pathname = "/login";
    to.search = "?denied=1";
    return NextResponse.redirect(to);
  }

  return res;
}
