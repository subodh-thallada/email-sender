import { NextResponse, type NextRequest } from "next/server";
import { exchangeCode } from "@/lib/google/oauth";
import { saveAccount } from "@/lib/google/accounts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATE_COOKIE = "g_oauth_state";

/** Where Google sends the user back after the consent screen. */
export async function GET(req: NextRequest) {
  const back = new URL("/settings", req.nextUrl.origin);

  const fail = (message: string) => {
    back.searchParams.set("gerror", message);
    const res = NextResponse.redirect(back);
    res.cookies.delete(STATE_COOKIE);
    return res;
  };

  const params = req.nextUrl.searchParams;
  const denied = params.get("error");
  if (denied) {
    return fail(
      denied === "access_denied"
        ? "You declined the permission, so nothing was connected."
        : denied,
    );
  }

  const code = params.get("code");
  if (!code) return fail("Google did not return an authorization code.");

  const state = params.get("state");
  const expected = req.cookies.get(STATE_COOKIE)?.value;
  if (!state || !expected || state !== expected) {
    return fail("The sign-in state did not match. Start again from Settings.");
  }

  try {
    const granted = await exchangeCode({ code, origin: req.nextUrl.origin });
    await saveAccount(granted);

    back.searchParams.set("gconnected", granted.email);
    const res = NextResponse.redirect(back);
    res.cookies.delete(STATE_COOKIE);
    return res;
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }
}
