import { getProfile, saveProfile, profileIsUsable } from "../lib/profile";
import { all } from "../lib/db";

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
  const tables = await all<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
  );
  console.log("tables:", tables.map((t) => t.name).join(", "));
  await saveProfile({ full_name: "", background: "", goal: "", daily_send_cap: 25 });
  console.log("reset: ok");
}
main().catch((e) => { console.error(e); process.exit(1); });
