import { NextResponse, type NextRequest } from "next/server";
import { randomBytes } from "node:crypto";
import { authUrl, oauthConfigured } from "@/lib/google/oauth";
import { encryptionConfigured } from "@/lib/crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATE_COOKIE = "g_oauth_state";

/** Starts the Gmail consent flow. Redirects to Google. */
export async function GET(req: NextRequest) {
  const back = new URL("/settings", req.nextUrl.origin);

  if (!oauthConfigured()) {
    back.searchParams.set(
      "gerror",
      "Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET first.",
    );
    return NextResponse.redirect(back);
  }
  if (!encryptionConfigured()) {
    back.searchParams.set(
      "gerror",
      "Set TOKEN_ENCRYPTION_KEY first — refresh tokens are not stored unencrypted.",
    );
    return NextResponse.redirect(back);
  }

  // CSRF: the value goes to Google in `state` and to the browser in a cookie.
  // The callback only proceeds when the two match, so a consent redirect the
  // user did not initiate here cannot attach an account.
  const state = randomBytes(16).toString("base64url");

  const res = NextResponse.redirect(
    authUrl({ origin: req.nextUrl.origin, state }),
  );
  res.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 600,
  });
  return res;
}
