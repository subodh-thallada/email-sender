import { newId, run } from "../lib/db";

const PEOPLE = [
  { n: "Timothy D. Barfoot", t: "Professor", d: "Institute for Aerospace Studies",
    areas: ["mobile robotics", "state estimation", "visual navigation"],
    papers: [["Sliding Sensors: Configurable Confidence in State Estimation", 2026],
             ["Into Darkness: Visual Navigation Based on a Lidar-Intensity-Image Pipeline", 2023]],
    e: [["tim.barfoot@utoronto.ca", "deobfuscated", "high", "\"tim.barfoot [at] utoronto.ca\" on asrl.utias.utoronto.ca"]] },
  { n: "Angela P. Schoellig", t: "Associate Professor", d: "Institute for Aerospace Studies",
    areas: ["safe learning control", "aerial robotics", "multi-robot systems"],
    papers: [["Data and Learning Where it Matters for Contact-Rich Manipulation", 2026]],
    e: [["schoellig@utoronto.ca", "pattern", "inferred", "local part \"schoellig\" from a mailto: link, domain from utoronto.ca"]] },
  { n: "Steven L. Waslander", t: "Professor", d: "Institute for Aerospace Studies",
    areas: ["autonomous driving", "3D perception", "SLAM"],
    papers: [["Certifiable Object Pose Estimation for Autonomous Vehicles", 2025]],
    e: [["steven.waslander@utoronto.ca", "llm", "high", "listed on the TRAILab contact page"]] },
  { n: "Scott Sanner", t: "Associate Professor", d: "Mechanical & Industrial Engineering",
    areas: ["reinforcement learning", "planning", "recommender systems"],
    papers: [["Hybrid Planning under Continuous Uncertainty", 2024]],
    e: [] },
];

async function main() {
  const sid = newId("s");
  await run("INSERT INTO searches (id, query, route, status) VALUES (?,?,?,?)",
    [sid, "professors at University of Toronto who do robotics research", "academic", "done"]);

  for (let i = 0; i < PEOPLE.length; i++) {
    const p = PEOPLE[i];
    const pid = newId("p");
    const dossier = {
      title: p.t, dept: p.d, lab: null, researchAreas: p.areas,
      papers: p.papers.map(([title, year]) => ({ title, year, venue: null, citations: null, url: null })),
      homepage: "https://example.edu/", location: "Toronto, Canada", notes: [], sources: [],
    };
    await run(
      `INSERT INTO people (id, search_id, name, title, org, dept, homepage, dossier, score, rank)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [pid, sid, p.n, p.t, "University of Toronto", p.d, "https://example.edu/", JSON.stringify(dossier), 0.8, i]);
    for (const [addr, src, conf, ev] of p.e) {
      await run(`INSERT INTO emails (id, person_id, address, source, confidence, mx_ok, evidence)
                 VALUES (?,?,?,?,?,1,?)`, [newId("e"), pid, addr, src, conf, ev]);
    }
  }
  console.log(`seeded /results/${sid}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
