import { NextResponse, type NextRequest } from "next/server";
import { disconnect } from "@/lib/google/accounts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST-only: disconnecting revokes a grant, and a GET would let an <img> tag on
 * any page do it.
 */
export async function POST(req: NextRequest) {
  const form = await req.formData().catch(() => null);
  const email = String(form?.get("email") ?? "").toLowerCase();

  const back = new URL("/settings", req.nextUrl.origin);
  if (!email) {
    back.searchParams.set("gerror", "No account given.");
    return NextResponse.redirect(back, { status: 303 });
  }

  await disconnect(email);
  back.searchParams.set("gdisconnected", email);
  return NextResponse.redirect(back, { status: 303 });
}
