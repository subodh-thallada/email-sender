import { nowStamp, one, run } from "./db";
import type { Profile } from "./types";

const EMPTY: Profile = {
  full_name: "",
  headline: "",
  background: "",
  goal: "",
  tone: "warm-professional",
  signature: "",
  daily_send_cap: 25,
  offer: "",
  audience: "",
  links: "",
  instructions: "",
};

export async function getProfile(): Promise<Profile> {
  const row = await one<Profile>(
    `SELECT full_name, headline, background, goal, tone, signature,
            daily_send_cap, offer, audience, links, instructions
     FROM profile WHERE id = 1`,
  );
  // Columns added by migration read back as NULL on rows written before them,
  // and a null would defeat the spread. Coalesce each one to its empty default.
  if (!row) return EMPTY;
  return {
    ...EMPTY,
    ...Object.fromEntries(
      Object.entries(row).filter(([, v]) => v !== null && v !== undefined),
    ),
  } as Profile;
}

export async function saveProfile(p: Partial<Profile>): Promise<void> {
  const current = await getProfile();
  const next = { ...current, ...p };
  await run(
    `UPDATE profile SET full_name = ?, headline = ?, background = ?, goal = ?,
       tone = ?, signature = ?, daily_send_cap = ?, offer = ?, audience = ?,
       links = ?, instructions = ?, updated_at = ?
     WHERE id = 1`,
    [
      next.full_name,
      next.headline,
      next.background,
      next.goal,
      next.tone,
      next.signature,
      next.daily_send_cap,
      next.offer,
      next.audience,
      next.links,
      next.instructions,
      nowStamp(),
    ],
  );
}

/**
 * True when there's enough context for the email writer to be useful.
 *
 * Either half of the profile can carry a draft on its own: a freelancer who
 * filled in offer + audience needs no resume, and a student with a pasted
 * background needs no pitch. Requiring both would lock out both of them.
 */
export function profileIsUsable(p: Profile): boolean {
  if (!p.full_name.trim()) return false;
  const hasBackground = p.background.trim().length > 40;
  const hasBusiness =
    p.offer.trim().length > 15 && p.audience.trim().length > 5;
  return hasBackground || hasBusiness;
}

/** Non-empty links, one per line, as a clean list. */
export function linkList(p: Profile): string[] {
  return p.links
    .split(/[\n,]/)
    .map((l) => l.trim())
    .filter(Boolean);
}
