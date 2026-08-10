import { all, run } from "../lib/db";
async function main() {
  const rows = await all<{ id: string }>(
    "SELECT id FROM searches WHERE query LIKE '%University of Toronto who do robotics%'",
  );
  for (const r of rows) {
    await run("DELETE FROM emails WHERE person_id IN (SELECT id FROM people WHERE search_id = ?)", [r.id]);
    await run("DELETE FROM people WHERE search_id = ?", [r.id]);
    await run("DELETE FROM searches WHERE id = ?", [r.id]);
  }
  console.log(`cleared ${rows.length} seeded search(es)`);
}
main().catch((e) => { console.error(e); process.exit(1); });
