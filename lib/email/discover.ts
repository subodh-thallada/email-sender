import { extractProfile } from "../ai/extract-profile";
import { fetchPage } from "../sources/fetch-page";
import { googleSearch, rankPersonPages } from "../sources/serper";
import { exaSearch } from "../sources/exa";
import { resolveDepth, sourceEnabled } from "../settings";
import { hunterFind } from "../sources/hunter";
import type { Candidate, Dossier, FoundEmail } from "../types";
import {
  extractEmails,
  extractLocalPartHints,
  isRoleAddress,
  isStub,
} from "./deobfuscate";
import { inferAddress, learnPattern, splitName } from "./patterns";
import { domainOf, verifyAddress } from "./verify";

/* Pages read per person now comes from the depth tier — see resolveDepth(). */

/** Two-label eTLD+1, widened for the ccSLDs universities actually use. */
const CC_SLDS = new Set([
  "ac.uk", "co.uk", "org.uk", "ac.jp", "co.jp", "ac.nz", "co.nz",
  "edu.au", "com.au", "org.au", "edu.cn", "ac.cn", "edu.sg", "ac.kr",
  "edu.hk", "ac.il", "edu.in", "ac.in", "edu.br", "com.br", "ac.za",
]);

export function registrableDomain(host: string): string {
  const labels = host.toLowerCase().replace(/^www\./, "").split(".");
  if (labels.length <= 2) return labels.join(".");
  const lastTwo = labels.slice(-2).join(".");
  if (CC_SLDS.has(lastTwo)) return labels.slice(-3).join(".");
  return lastTwo;
}

/**
 * Find the best address for one person.
 *
 * Ordered so that cheap, high-trust evidence wins and paid/guessed sources are
 * only reached when everything above them failed:
 *   1. addresses literally on their pages (mailto / regex / de-obfuscated)
 *   2. the LLM's read of those same pages (catches what regex can't)
 *   3. a bare `mailto:` local part + the site's mail domain
 *   4. a learned per-domain pattern
 *   5. Hunter.io (50/month — genuinely last)
 */
export async function discoverPerson(
  candidate: Candidate,
  searchId = "adhoc",
): Promise<{ dossier: Dossier; emails: FoundEmail[] }> {
  const queryOrg = candidate.org ?? "";
  const query = `"${candidate.name}" ${queryOrg} email contact`;
  const depth = await resolveDepth();

  // Serper first; Exa when Serper is switched off, came back empty, or the
  // deepest tier asks for both.
  let hits = (await sourceEnabled("serper"))
    ? await googleSearch(query, depth.searchResults).catch(() => [])
    : [];
  if (hits.length === 0 || depth.exaSupplements) {
    const extra = await exaSearch(query, searchId, depth.searchResults).catch(
      () => [],
    );
    // Dedupe by URL — the two engines agree on the obvious pages, and paying
    // to fetch the same homepage twice is the whole cost of this tier.
    const seenLinks = new Set(hits.map((h) => h.link));
    hits = [...hits, ...extra.filter((h) => !seenLinks.has(h.link))];
  }

  const pages = (
    await Promise.all(
      rankPersonPages(hits, candidate.org)
        .slice(0, depth.pagesPerPerson)
        .map((h) => fetchPage(h.link)),
    )
  ).filter((p) => p.ok && p.text.length > 200);

  /* --- 1. what's literally on the page ---------------------------------- */
  const scraped = pages.flatMap((p) => extractEmails(p.text, p.html, p.url));
  const localHints = pages.flatMap((p) => extractLocalPartHints(p.html));

  /* --- 2. the LLM's read of the same pages ------------------------------ */
  const profile = await extractProfile(
    candidate.name,
    candidate.org,
    pages.map((p) => ({ url: p.url, title: p.title, text: p.text })),
  ).catch(() => null);

  const dossier: Dossier = {
    title: profile?.title ?? candidate.title,
    dept: profile?.dept ?? candidate.dept,
    lab: profile?.lab ?? null,
    researchAreas:
      profile?.researchAreas?.length ? profile.researchAreas : candidate.topics,
    papers: candidate.recentPapers,
    homepage: profile?.homepage ?? pages[0]?.url ?? null,
    location: profile?.location ?? candidate.location,
    notes: profile?.notes ?? [],
    sources: pages.map((p) => p.url),
  };

  // The mail domain: prefer one attested by a real address on their own pages.
  const mailDomain = pickMailDomain(
    scraped.map((s) => s.address),
    pages.map((p) => p.url),
    candidate.orgDomain,
  );

  const found: FoundEmail[] = [];
  const seen = new Set<string>();
  const push = (e: FoundEmail) => {
    if (seen.has(e.address)) return;
    seen.add(e.address);
    found.push(e);
  };

  // The LLM's answer outranks raw scraping: it knows which address on a
  // department page is actually this person's.
  if (profile?.isCorrectPerson && profile.email && !isStub(profile.email)) {
    push({
      address: profile.email.toLowerCase(),
      source: "llm",
      confidence: "high",
      mxOk: null,
      evidence: profile.emailEvidence
        ? `"${profile.emailEvidence}" on ${dossier.homepage ?? "their page"}`
        : (dossier.homepage ?? null),
    });
  }

  // A scraped address only counts if the surname appears in the local part —
  // otherwise it's a colleague's or an admin's address that shared the page.
  const surname = splitName(candidate.name)?.last;
  for (const hit of scraped) {
    if (isRoleAddress(hit.address)) continue;
    const local = hit.address.split("@")[0];
    if (surname && surname.length > 2 && !local.includes(surname.slice(0, 4))) {
      continue;
    }
    push({
      address: hit.address,
      source: hit.method,
      confidence: "high",
      mxOk: null,
      evidence: hit.evidence,
    });
  }

  /* --- 3/4. inference, only if nothing was actually found ---------------- */
  if (found.length === 0 && mailDomain) {
    const hint = localHints[0];
    const guess = await inferAddress(candidate.name, mailDomain, hint);
    if (guess) {
      push({
        address: guess.address,
        source: "pattern",
        confidence: "inferred",
        mxOk: null,
        evidence: guess.basis,
      });
    }
  }

  /* --- 5. Hunter, genuinely last ---------------------------------------- */
  if (found.length === 0 && mailDomain && (await sourceEnabled("hunter"))) {
    const h = await hunterFind(candidate.name, mailDomain);
    if (h) {
      push({
        address: h.address,
        source: "hunter",
        confidence: h.score >= 80 ? "high" : "inferred",
        mxOk: null,
        evidence: `Hunter.io confidence ${h.score}`,
      });
    }
  }

  /* --- verification + learning ------------------------------------------ */
  const verified: FoundEmail[] = [];
  for (const e of found) {
    const v = await verifyAddress(e.address);
    if (!v.ok && !v.mxOk) {
      // Domain can't receive mail at all — keep it visible but call it unknown.
      verified.push({
        ...e,
        confidence: "unknown",
        mxOk: false,
        evidence: [e.evidence, v.reason].filter(Boolean).join(" · "),
      });
      continue;
    }
    verified.push({ ...e, mxOk: v.mxOk });

    // Feed confirmed addresses back so the next person at this domain can be
    // inferred even when their own page hides everything.
    if (e.source !== "pattern" && e.source !== "hunter") {
      await learnPattern(candidate.name, e.address).catch(() => {});
    }
  }

  verified.sort((a, b) => rank(b) - rank(a));
  return { dossier, emails: verified };
}

const CONFIDENCE_RANK = { verified: 3, high: 2, inferred: 1, unknown: 0 };
const SOURCE_RANK = {
  provided: 7, llm: 6, mailto: 5, deobfuscated: 4, regex: 3, hunter: 2, pattern: 1,
};

function rank(e: FoundEmail): number {
  return CONFIDENCE_RANK[e.confidence] * 10 + SOURCE_RANK[e.source];
}

/**
 * Pick the domain to build guesses on, best evidence first:
 *   1. a real address already seen on their own pages
 *   2. the institution's own domain (from OpenAlex)
 *   3. the host of a page we fetched
 *
 * Order matters. A lab site at dynsyslab.org that exposes only a bare
 * `mailto:schoellig` would otherwise produce schoellig@dynsyslab.org instead
 * of the correct university domain.
 */
function pickMailDomain(
  addresses: string[],
  pageUrls: string[],
  orgDomain: string | null,
): string {
  const counts = new Map<string, number>();
  for (const a of addresses) {
    if (isStub(a)) continue;
    const d = domainOf(a);
    if (d) counts.set(d, (counts.get(d) ?? 0) + 1);
  }
  const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  if (best) return best[0];

  if (orgDomain) return orgDomain;

  for (const u of pageUrls) {
    try {
      const d = registrableDomain(new URL(u).host);
      if (d && !/(github|wordpress|wixsite|weebly|squarespace|google)\./.test(d)) {
        return d;
      }
    } catch {
      /* ignore */
    }
  }
  return "";
}
