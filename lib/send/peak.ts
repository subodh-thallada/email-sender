/**
 * "Schedule for peak engagement" — picking a send time rather than making the
 * user pick one.
 *
 * The rule of thumb this encodes, from published cold-outreach open-rate data:
 * mid-week mornings do best. Monday competes with the weekend backlog, Friday
 * afternoon is a write-off, and anything landing overnight is buried by the
 * time it is read. Tuesday to Thursday, shortly after the start of the working
 * day, is the consensus window.
 *
 * Honest limits: the window is computed in the *sender's* timezone, because
 * nothing in the pipeline reliably establishes the recipient's. For outreach
 * within one country that is close enough; across continents it is not, and
 * the manual datetime picker remains the right tool.
 */

/** Tue, Wed, Thu. JS weekday numbering, Sunday = 0. */
const PEAK_DAYS = [2, 3, 4];

/** Local wall-clock window. Landing just after inbox triage starts. */
const WINDOW_START_MIN = 9 * 60 + 30;
const WINDOW_END_MIN = 11 * 60;

/** Never schedule so close to now that the cron tick misses it. */
const MIN_LEAD_MS = 20 * 60_000;

export interface PeakOptions {
  /** Minutes to add to UTC to get the sender's wall clock, i.e.
   *  `-new Date().getTimezoneOffset()` in the browser. */
  offsetMinutes: number;
  now?: Date;
  /** Stagger for bulk scheduling: the nth message is pushed later. */
  index?: number;
}

/**
 * The next peak instant, as a real UTC Date.
 *
 * Shifting by the offset lets the UTC getters be read as local wall clock,
 * which avoids pulling in a timezone library for what is a fixed-offset
 * calculation. A DST boundary inside the search window can move the result by
 * an hour; for a scheduling heuristic that is not worth a dependency.
 */
export function nextPeakSlot({
  offsetMinutes,
  now = new Date(),
  index = 0,
}: PeakOptions): Date {
  const offsetMs = offsetMinutes * 60_000;
  const earliest = now.getTime() + MIN_LEAD_MS;

  // Messages go out spaced apart rather than in one burst: a hundred
  // identical timestamps is a pattern, and the cron tick would serialise them
  // anyway. Wrapping at 6 keeps a large batch from sliding out of the window.
  const stagger = (index % 6) * 12 * 60_000;

  for (let dayOffset = 0; dayOffset <= 14; dayOffset++) {
    const local = new Date(now.getTime() + offsetMs + dayOffset * 86_400_000);
    if (!PEAK_DAYS.includes(local.getUTCDay())) continue;

    const startOfDay = Date.UTC(
      local.getUTCFullYear(),
      local.getUTCMonth(),
      local.getUTCDate(),
    );
    const slotLocal = startOfDay + (WINDOW_START_MIN + 5) * 60_000 + stagger;

    // Guard the tail of the window: a big stagger must not push a message
    // past 11am into the dead part of the morning.
    if (slotLocal > startOfDay + WINDOW_END_MIN * 60_000) continue;

    const slotUtc = slotLocal - offsetMs;
    if (slotUtc >= earliest) return new Date(slotUtc);
  }

  // Unreachable in practice — two weeks always contains a Tuesday.
  return new Date(earliest);
}

/** Human summary of a chosen slot, in the sender's own timezone. */
export function describeSlot(when: Date, offsetMinutes: number): string {
  const local = new Date(when.getTime() + offsetMinutes * 60_000);
  const day = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][
    local.getUTCDay()
  ];
  const hh = local.getUTCHours();
  const mm = String(local.getUTCMinutes()).padStart(2, "0");
  const suffix = hh < 12 ? "am" : "pm";
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  return `${day} ${h12}:${mm}${suffix} your time`;
}

/**
 * Valid-looking browser offset, or null.
 *
 * The explicit type check is load-bearing: `Number(null)` and `Number("")` are
 * both 0, so a request that simply omitted the field would otherwise pass as a
 * confident "UTC" and schedule someone's peak slot in the wrong timezone.
 * A missing offset has to be indistinguishable from a bad one.
 */
export function readOffset(raw: unknown): number | null {
  if (typeof raw !== "number" && typeof raw !== "string") return null;
  if (typeof raw === "string" && raw.trim() === "") return null;

  const n = Number(raw);
  // Real offsets span UTC-12 to UTC+14.
  if (!Number.isFinite(n) || n < -720 || n > 840) return null;
  return Math.round(n);
}
