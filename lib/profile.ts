import { one, run } from "./db";
import type { Profile } from "./types";

const EMPTY: Profile = {
  full_name: "",
  headline: "",
  background: "",
  goal: "",
  tone: "warm-professional",
  signature: "",
  daily_send_cap: 25,
};

export async function getProfile(): Promise<Profile> {
  const row = await one<Profile>(
    `SELECT full_name, headline, background, goal, tone, signature, daily_send_cap
     FROM profile WHERE id = 1`,
  );
  return row ? { ...EMPTY, ...row } : EMPTY;
}

export async function saveProfile(p: Partial<Profile>): Promise<void> {
  const current = await getProfile();
  const next = { ...current, ...p };
  await run(
    `UPDATE profile SET full_name = ?, headline = ?, background = ?, goal = ?,
       tone = ?, signature = ?, daily_send_cap = ?, updated_at = datetime('now')
     WHERE id = 1`,
    [
      next.full_name,
      next.headline,
      next.background,
      next.goal,
      next.tone,
      next.signature,
      next.daily_send_cap,
    ],
  );
}

/** True when there's enough context for the email writer to be useful. */
export function profileIsUsable(p: Profile): boolean {
  return p.full_name.trim().length > 0 && p.background.trim().length > 40;
}
