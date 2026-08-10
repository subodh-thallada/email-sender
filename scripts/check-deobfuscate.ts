/**
 * Runs the deobfuscator against synthetic patterns AND the three real faculty
 * pages that motivated it.  npx tsx scripts/check-deobfuscate.ts
 */
import { extractEmails, extractLocalPartHints, isStub } from "../lib/email/deobfuscate";

let pass = 0;
let fail = 0;

function check(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? "  ok  " : "  FAIL"}  ${name}`);
  if (!ok) console.log(`        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`);
  ok ? pass++ : fail++;
}

function first(text: string, html?: string): string | null {
  return extractEmails(text, html)[0]?.address ?? null;
}

console.log("\nObfuscation patterns");
check("[at]", first("tim.barfoot [at] utoronto.ca"), "tim.barfoot@utoronto.ca");
check("(at) (dot)", first("jane (at) cs (dot) ubc (dot) ca"), "jane@cs.ubc.ca");
check("{at}", first("bob {at} mit.edu"), "bob@mit.edu");
check("word at/dot", first("alice at example2 dot org"), "alice@example2.org");
check("-at- -dot-", first("carl-at-uwaterloo-dot-ca"), "carl@uwaterloo.ca");
check("_at_", first("dana_at_stanford.edu"), "dana@stanford.edu");
check("html entity &#64;", first("", "erin&#64;berkeley.edu"), "erin@berkeley.edu");
check("hex entity &#x40;", first("", "finn&#x40;ethz.ch"), "finn@ethz.ch");
check("spaced @", first("gil @ mcgill . ca"), "gil@mcgill.ca");
check("mailto href", first("", '<a href="mailto:Hal.Smith@utoronto.ca">mail</a>'), "hal.smith@utoronto.ca");
check("plain", first("Contact: ivy@ualberta.ca."), "ivy@ualberta.ca");

console.log("\nStub rejection (the cs.toronto.edu failure mode)");
check("x@", isStub("x@cs.toronto.edu"), true);
check("email@", isStub("email@dept.edu"), true);
check("firstname.lastname@", isStub("firstname.lastname@utoronto.ca"), true);
check("john.doe@", isStub("john.doe@site.edu"), true);
check("@example.com", isStub("real.person@example.com"), true);
check("asset url", isStub("logo@2x.png"), true);
check("real address kept", isStub("tim.barfoot@utoronto.ca"), false);

console.log("\nBare mailto local part (the dynsyslab.org failure mode)");
check(
  "mailto without domain",
  extractLocalPartHints('<a href="mailto:schoellig">email</a>'),
  ["schoellig"],
);

async function live() {
  const pages: [string, string][] = [
    ["asrl.utias.utoronto.ca (obfuscated [at])", "http://asrl.utias.utoronto.ca/~tdb/"],
    ["cs.toronto.edu/~florian (stub x@)", "https://www.cs.toronto.edu/~florian/"],
    ["dynsyslab.org (bare mailto)", "https://www.dynsyslab.org/prof-angela-schoellig/"],
  ];

  console.log("\nLive pages");
  for (const [label, url] of pages) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; email-agent/0.1)" },
        signal: AbortSignal.timeout(20000),
      });
      const html = await res.text();
      const text = html.replace(/<[^>]+>/g, " ");
      const hits = extractEmails(text, html, url);
      const hints = extractLocalPartHints(html);
      console.log(
        `  ${label}\n` +
          `     emails: ${hits.length ? hits.map((h) => `${h.address} (${h.method})`).join(", ") : "none"}\n` +
          `     local-part hints: ${hints.length ? hints.join(", ") : "none"}`,
      );
    } catch (e) {
      console.log(`  ${label}\n     fetch failed: ${e instanceof Error ? e.message : e}`);
    }
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}

live();
