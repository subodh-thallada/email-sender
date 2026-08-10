import { pixelResponse, recordOpen } from "@/lib/send/tracking";

export const runtime = "nodejs";
/** Recipients are strangers on the internet; this is the one open endpoint. */
export const dynamic = "force-dynamic";

/**
 * The read-receipt pixel.
 *
 * Always returns the same GIF, in every case: unknown token, malformed token,
 * database down. A recipient must not be able to tell a live token from a dead
 * one, and a mail client must never render a broken image because our database
 * was briefly unavailable.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  try {
    const { token } = await params;
    // The URL ends in .gif so it reads as an image to clients and proxies that
    // sniff the extension; the token itself is the part before it.
    const clean = token.replace(/\.gif$/i, "");

    if (/^[a-f0-9]{16,64}$/i.test(clean)) {
      await recordOpen(clean, {
        userAgent: req.headers.get("user-agent"),
        ip:
          req.headers.get("x-forwarded-for") ??
          req.headers.get("x-real-ip"),
      });
    }
  } catch (err) {
    // Never let a logging failure cost the recipient a rendered image.
    console.error("open tracking failed:", err);
  }

  return pixelResponse();
}
