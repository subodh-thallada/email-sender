import { getProfile, saveProfile, profileIsUsable } from "../lib/profile";
import { all, dialect } from "../lib/db";

async function main() {
  await saveProfile({
    full_name: "Test User",
    background: "Third-year engineering student with projects in SLAM and ROS2 navigation stacks.",
    goal: "A summer research position.",
    daily_send_cap: 30,
  });
  const p = await getProfile();
  console.log("round-trip:", p.full_name === "Test User" && p.daily_send_cap === 30 ? "ok" : "FAIL");
  console.log("profileIsUsable:", profileIsUsable(p) ? "ok" : "FAIL");
  // sqlite_master has no Postgres equivalent, so the catalog query is the one
  // place this script cannot stay dialect-neutral.
  const tables = await all<{ name: string }>(
    dialect() === "postgres"
      ? `SELECT table_name AS name FROM information_schema.tables
         WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
         ORDER BY table_name`
      : "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
  );
  console.log("tables:", tables.map((t) => t.name).join(", "));
  await saveProfile({ full_name: "", background: "", goal: "", daily_send_cap: 25 });
  console.log("reset: ok");
}
// The Postgres pool holds the process open once the checks are done.
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
