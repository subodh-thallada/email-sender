/**
 * Academic pages almost never expose a plain address. Real examples measured
 * while building this:
 *   asrl.utias.utoronto.ca/~tdb/   -> "tim.barfoot [at] utoronto.ca"
 *   cs.toronto.edu/~florian/       -> "x@cs.toronto.edu"      (template stub)
 *   dynsyslab.org/prof-schoellig/  -> href="mailto:schoellig" (domain stripped)
 *
 * So: decode entities, unmask separators, and aggressively reject stubs.
 */

export interface RawHit {
  address: string;
  method: "mailto" | "regex" | "deobfuscated";
  evidence: string;
}

const ADDR = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

/** Local parts that are documentation stubs, not people. */
const STUB_LOCALS = new Set([
  "x", "xx", "xxx", "y", "z", "abc", "aaa", "foo", "bar", "baz",
  "email", "e-mail", "mail", "name", "yourname", "your-name", "username",
  "user", "firstname", "lastname", "first", "last", "first.last",
  "firstname.lastname", "f.last", "someone", "somebody", "anyone",
  "test", "testing", "example", "sample", "demo", "placeholder",
  // Only the compound forms — a bare "john@" or "jane@" is a plausible real
  // address at a university and must not be rejected.
  "john.doe", "jane.doe", "johndoe", "janedoe", "j.doe",
]);

/** Real but non-personal; keep them, just never treat them as a person's address. */
const ROLE_LOCALS = new Set([
  "info", "contact", "admin", "webmaster", "postmaster", "hostmaster",
  "noreply", "no-reply", "donotreply", "do-not-reply", "mailer-daemon",
  "support", "help", "sales", "marketing", "press", "media",
  "privacy", "abuse", "security", "legal", "billing",
]);

const STUB_DOMAINS = [
  "example.com", "example.org", "example.net", "domain.com", "email.com",
  "yourdomain.com", "site.com", "test.com", "sentry.io", "wixpress.com",
  "schema.org", "w3.org", "googlegroups.com",
];

/** File extensions that regex-match the email shape inside asset URLs. */
const ASSET_TAIL =
  /\.(png|jpe?g|gif|svg|webp|css|js|mjs|json|woff2?|ttf|eot|ico|pdf|zip|mp4|webm)$/i;

export function isStub(address: string): boolean {
  const [local, domain] = address.toLowerCase().split("@");
  if (!local || !domain) return true;
  if (STUB_LOCALS.has(local)) return true;
  if (STUB_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`))) return true;
  if (ASSET_TAIL.test(address)) return true;
  // "2x@3x" style image descriptors, version strings, hashes.
  if (/^\d+x?$/.test(local)) return true;
  if (/^[0-9a-f]{16,}$/.test(local)) return true;
  return false;
}

export function isRoleAddress(address: string): boolean {
  const local = address.toLowerCase().split("@")[0] ?? "";
  return ROLE_LOCALS.has(local);
}

function decodeEntities(s: string): string {
  return s
    .replace(/&#0*64;|&#x0*40;|&commat;|&AT;/gi, "@")
    .replace(/&#0*46;|&#x0*2e;|&period;/gi, ".")
    .replace(/&amp;/gi, "&")
    .replace(/&nbsp;|&#0*160;/gi, " ");
}

/**
 * Rewrite masked separators into real ones.
 *
 * DOT rules run first: the word-boundary AT rule only fires when what follows
 * already looks like a domain, so "alice at example dot org" needs its "dot"
 * resolved before "at" can be recognised.
 */
function unmask(s: string): string {
  let out = s;
  const AT = [
    /\s*[\[({<]\s*(?:at|@|AT)\s*[\])}>]\s*/g,
    /\s+(?:at|AT|At)\s+(?=[A-Za-z0-9-]+\s*(?:[\[({<]\s*(?:dot|\.)\s*[\])}>]|\.)\s*[A-Za-z]{2,})/g,
    /\s*_at_\s*/gi,
    /\s*-at-\s*/gi,
    /\s*\bETA\b\s*/g,
  ];
  const DOT = [
    /\s*[\[({<]\s*(?:dot|punto|\.)\s*[\])}>]\s*/gi,
    /\s+(?:dot|DOT|Dot)\s+/g,
    /\s*_dot_\s*/gi,
    /\s*-dot-\s*/gi,
  ];
  for (const re of DOT) out = out.replace(re, ".");
  for (const re of AT) out = out.replace(re, "@");
  // "name @ domain . ca" -> tighten spacing around the separators we now have.
  out = out.replace(/\s*@\s*/g, "@").replace(/\s+\.\s+/g, ".");
  return out;
}

function collect(text: string, method: RawHit["method"], evidence: string): RawHit[] {
  const hits: RawHit[] = [];
  for (const m of text.matchAll(ADDR)) {
    const address = m[0].replace(/[.,;:)\]}>'"]+$/, "").toLowerCase();
    if (!isStub(address)) hits.push({ address, method, evidence });
  }
  return hits;
}

/**
 * Pull every address out of a page. `html` is optional but lets us read
 * mailto: hrefs, which survive most obfuscation.
 */
export function extractEmails(
  text: string,
  html?: string,
  sourceUrl = "",
): RawHit[] {
  const seen = new Map<string, RawHit>();
  const add = (h: RawHit) => {
    if (!seen.has(h.address)) seen.set(h.address, h);
  };

  if (html) {
    const decoded = decodeEntities(html);
    for (const m of decoded.matchAll(/mailto:([^"'`\s>?&]+)/gi)) {
      const raw = decodeURIComponent(m[1]).toLowerCase();
      if (raw.includes("@")) {
        for (const h of collect(raw, "mailto", sourceUrl)) add(h);
      }
    }
    for (const h of collect(decoded, "regex", sourceUrl)) add(h);
    for (const h of collect(unmask(decoded), "deobfuscated", sourceUrl)) add(h);
  }

  const decodedText = decodeEntities(text);
  for (const h of collect(decodedText, "regex", sourceUrl)) add(h);
  for (const h of collect(unmask(decodedText), "deobfuscated", sourceUrl)) add(h);

  return [...seen.values()];
}

/**
 * A `mailto:` with no domain (the dynsyslab.org case). The local part is real
 * and worth keeping — the domain gets supplied by pattern inference later.
 */
export function extractLocalPartHints(html: string): string[] {
  const out = new Set<string>();
  for (const m of decodeEntities(html).matchAll(/mailto:([^"'`\s>?&]+)/gi)) {
    const raw = decodeURIComponent(m[1]).toLowerCase().trim();
    if (!raw.includes("@") && /^[a-z0-9._%+-]{2,40}$/.test(raw)) out.add(raw);
  }
  return [...out];
}
