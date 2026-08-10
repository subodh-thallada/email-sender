/**
 * Exercises the email waterfall's mechanics end-to-end against real pages,
 * without needing Serper or Anthropic keys.
 *
 *   npx tsx --env-file=.env.local scripts/check-waterfall.ts
 */
import { fetchPage } from "../lib/sources/fetch-page";
import { extractEmails, extractLocalPartHints } from "../lib/email/deobfuscate";
import {
  detectPattern,
  getPattern,
  inferAddress,
  learnPattern,
  splitName,
} from "../lib/email/patterns";
import { verifyAddress } from "../lib/email/verify";
import { registrableDomain } from "../lib/email/discover";

let fail = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${name}${detail ? `  → ${detail}` : ""}`);
  if (!ok) fail++;
}

async function main() {
  console.log("\n1. Scrape a real obfuscated page");
  const page = await fetchPage("http://asrl.utias.utoronto.ca/~tdb/");
  check("page fetched (robots allowed)", page.ok && !page.blockedByRobots);
  const hits = extractEmails(page.text, page.html, page.url);
  const barfoot = hits.find((h) => h.address.includes("barfoot"));
  check(
    "recovered tim.barfoot@utoronto.ca from '[at]'",
    barfoot?.address === "tim.barfoot@utoronto.ca",
    barfoot?.address ?? "not found",
  );

  console.log("\n2. Pattern learning is strict about nicknames");
  check(
    "'Timothy D. Barfoot' + tim.barfoot@ is NOT learned",
    detectPattern("Timothy D. Barfoot", "tim.barfoot@utoronto.ca") === null,
    "nickname would poison the domain pattern",
  );
  const parts = splitName("Timothy D. Barfoot");
  check(
    "initials dropped from name split",
    parts?.first === "timothy" && parts?.last === "barfoot",
    `${parts?.first}/${parts?.last}`,
  );

  console.log("\n3. Pattern learning on an exact match");
  await learnPattern("Sanja Fidler", "sanja.fidler@utoronto.ca");
  const learned = await getPattern("utoronto.ca");
  check(
    "utoronto.ca learned {first}.{last}",
    learned?.pattern === "{first}.{last}",
    learned?.pattern ?? "none",
  );
  const inferred = await inferAddress("Steven L. Waslander", "utoronto.ca");
  check(
    "applies to a new person at that domain",
    inferred?.address === "steven.waslander@utoronto.ca",
    inferred?.address ?? "none",
  );

  console.log("\n4. Bare mailto + institution domain (the dynsyslab case)");
  const lab = await fetchPage("https://www.dynsyslab.org/prof-angela-schoellig/");
  const hint = extractLocalPartHints(lab.html)[0];
  check("local-part hint recovered", hint === "schoellig", hint ?? "none");
  const fromHint = await inferAddress("Angela P. Schoellig", "utoronto.ca", hint);
  check(
    "hint + institution domain, not the lab domain",
    fromHint?.address === "schoellig@utoronto.ca",
    fromHint?.address ?? "none",
  );
  check(
    "lab host would have been wrong",
    registrableDomain("www.dynsyslab.org") === "dynsyslab.org",
  );

  console.log("\n5. Verification");
  const good = await verifyAddress("tim.barfoot@utoronto.ca");
  check("utoronto.ca has MX", good.ok && good.mxOk);
  const bad = await verifyAddress("someone@definitely-not-a-real-domain-xyz.com");
  check("nonexistent domain rejected", !bad.ok, bad.reason ?? "");
  const malformed = await verifyAddress("not-an-email");
  check("malformed rejected", !malformed.ok, malformed.reason ?? "");

  console.log("\n6. ccSLD handling");
  check("ac.uk keeps three labels", registrableDomain("www.cs.ox.ac.uk") === "ox.ac.uk");
  check("plain .edu keeps two", registrableDomain("www.cs.stanford.edu") === "stanford.edu");

  console.log(fail === 0 ? "\nAll waterfall checks passed.\n" : `\n${fail} FAILED\n`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
