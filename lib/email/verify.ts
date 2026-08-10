import { resolveMx } from "node:dns/promises";
import { cached, DAY } from "../cache";

/**
 * Free, local verification only: syntax + a real MX record + a disposable-domain
 * check. This proves the domain can receive mail; it cannot prove the mailbox
 * exists. SMTP RCPT probing would, but it is unreliable from a residential IP
 * and risks your sending reputation, so it is deliberately not done here.
 *
 * Consequence: nothing is labelled "verified" unless a real verification
 * service is wired in. The best a scraped address gets is "high".
 */

const SYNTAX = /^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/i;

const DISPOSABLE = new Set([
  "mailinator.com", "guerrillamail.com", "10minutemail.com", "tempmail.com",
  "throwaway.email", "yopmail.com", "trashmail.com", "sharklasers.com",
  "getnada.com", "temp-mail.org", "dispostable.com", "maildrop.cc",
]);

export function syntaxOk(address: string): boolean {
  if (!SYNTAX.test(address)) return false;
  const [local, domain] = address.split("@");
  if (local.length > 64 || address.length > 254) return false;
  if (local.startsWith(".") || local.endsWith(".") || local.includes("..")) {
    return false;
  }
  const tld = domain.split(".").pop() ?? "";
  return tld.length >= 2 && /^[a-z]+$/i.test(tld);
}

export function domainOf(address: string): string {
  return address.toLowerCase().split("@")[1] ?? "";
}

export function isDisposable(address: string): boolean {
  return DISPOSABLE.has(domainOf(address));
}

export async function hasMx(domain: string): Promise<boolean> {
  if (!domain) return false;
  return cached<boolean>(`mx:${domain}`, 7 * DAY, async () => {
    try {
      const records = await resolveMx(domain);
      return records.length > 0;
    } catch {
      return false;
    }
  });
}

export interface VerifyResult {
  ok: boolean;
  mxOk: boolean;
  reason: string | null;
}

export async function verifyAddress(address: string): Promise<VerifyResult> {
  const addr = address.trim().toLowerCase();
  if (!syntaxOk(addr)) {
    return { ok: false, mxOk: false, reason: "malformed address" };
  }
  if (isDisposable(addr)) {
    return { ok: false, mxOk: false, reason: "disposable domain" };
  }
  const mxOk = await hasMx(domainOf(addr));
  return {
    ok: mxOk,
    mxOk,
    reason: mxOk ? null : "domain has no MX record",
  };
}
