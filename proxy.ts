import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Gates every page and API route.
 *
 * Local dev with no Supabase env stays open — only you can reach localhost.
 * A production deployment without auth configured is blocked outright rather
 * than served unprotected, because an open URL means anyone can spend your API
 * credits and send mail from your Gmail.
 */

const PUBLIC = ["/login", "/auth/callback", "/auth/signout"];

function configured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}

function allowed(email: string | undefined): boolean {
  if (!email) return false;
  const list = (process.env.ALLOWED_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return list.length === 0 || list.includes(email.toLowerCase());
}

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // The cron runner authenticates with CRON_SECRET, not a session.
  if (pathname.startsWith("/api/cron/")) return NextResponse.next();

  // Read-receipt pixels are fetched by the recipient's mail client, which has
  // no session and never will. The token in the path is the only credential,
  // and it grants nothing beyond recording that one message was opened.
  // (The static-asset matcher below already lets these through by extension —
  // this makes it deliberate rather than a side effect of ending in .gif.)
  if (pathname.startsWith("/api/track/")) return NextResponse.next();

  if (PUBLIC.some((p) => pathname.startsWith(p))) return NextResponse.next();

  if (!configured()) {
    if (process.env.NODE_ENV !== "production") return NextResponse.next();
    return new NextResponse(
      "Auth is not configured. Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY and ALLOWED_EMAILS before deploying.",
      { status: 503 },
    );
  }

  let res = NextResponse.next({ request: req });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => req.cookies.getAll(),
        setAll: (list) => {
          for (const { name, value } of list) req.cookies.set(name, value);
          res = NextResponse.next({ request: req });
          for (const { name, value, options } of list) {
            res.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // Must be getUser(), not getSession() — getSession trusts the cookie without
  // revalidating, which is forgeable.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || !allowed(user.email)) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        { ok: false, error: "Not signed in." },
        { status: 401 },
      );
    }
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    if (user) url.searchParams.set("denied", "1");
    return NextResponse.redirect(url);
  }

  return res;
}

export const config = {
  matcher: [
    // Everything except Next internals and static assets.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
