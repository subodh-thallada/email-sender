import { addressesInText, discoverDirect } from "../lib/discover/direct";

const CASES = [
  "email tim.barfoot@utoronto.ca about SLAM",
  "reach out to Prof. Jane Doe (jane.doe [at] mit.edu) about her manipulation work",
  "j.smith@ox.ac.uk and a.patel@stanford.edu",
  "professors at University of Toronto who do robotics research",
];

async function main() {
  for (const q of CASES) {
    const found = addressesInText(q);
    console.log(`\nQ: ${q}\n   detected: ${found.length ? found.join(", ") : "none (falls through to search)"}`);
    if (!found.length) continue;
    const rows = await discoverDirect(q, () => {});
    for (const r of rows) {
      const e = r.emails[0];
      console.log(`   -> ${r.candidate.name} | ${e.address} | ${e.source}/${e.confidence} | mx=${e.mxOk}`);
    }
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
