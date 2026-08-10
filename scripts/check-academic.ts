/**
 * Verifies the OpenAlex half of the academic route without spending any LLM
 * tokens: hand-built intent -> discoverAcademic -> real candidates.
 *
 *   npx tsx scripts/check-academic.ts
 */
import { discoverAcademic } from "../lib/discover/academic";
import type { ParsedQuery } from "../lib/types";

const intent: ParsedQuery = {
  route: "academic",
  institutions: ["University of Toronto"],
  topics: ["robotics"],
  titles: ["professor"],
  companies: [],
  pastEmployers: [],
  location: null,
  limit: 20,
  rationale: "fixture",
};

async function main() {
  const t0 = Date.now();
  const people = await discoverAcademic(intent, (m) => console.log(`  · ${m}`));

  console.log(`\n${people.length} candidates in ${Date.now() - t0}ms\n`);
  for (const p of people.slice(0, 15)) {
    const paper = p.recentPapers[0];
    console.log(
      `${p.name}\n` +
        `   ${p.org} | works ${p.worksCount} | cited ${p.citedBy} | fit ${(p.score * 100).toFixed(0)}%\n` +
        `   topics: ${p.topics.slice(0, 3).join(", ")}\n` +
        `   latest: ${paper ? `${paper.year} ${paper.title.slice(0, 70)}` : "none"}\n`,
    );
  }

  const names = people.map((p) => p.name.toLowerCase());
  const expected = ["barfoot", "schoellig", "waslander"];
  const hits = expected.filter((e) => names.some((n) => n.includes(e)));
  console.log(
    `Known UofT robotics faculty found: ${hits.length}/${expected.length} (${hits.join(", ") || "none"})`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
