/**
 * Pure-logic checks for the outreach features: peak scheduling, draft parsing,
 * the tracking pixel, and profile shape. Nothing here touches the network or
 * the database, so it runs anywhere.
 *
 *   npx tsx scripts/check-sema.ts
 */
import { describeSlot, nextPeakSlot, readOffset } from "../lib/send/peak";
import { parseEmail } from "../lib/ai/write-email";
import { ipPrefix, pixelUrl, trackingOrigin } from "../lib/send/tracking";
import { markdownToHtml } from "../lib/send/render";
import { buildMime } from "../lib/send/gmail";
import { linkList, profileIsUsable } from "../lib/profile";
import { DEPTHS, DEPTH_PROFILE } from "../lib/depth";
import type { Profile } from "../lib/types";

let fail = 0;
const check = (n: string, ok: boolean, extra = "") => {
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${n}${extra ? "  " + extra : ""}`);
  if (!ok) fail++;
};

const base: Profile = {
  full_name: "Subodh Thallada",
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

/* ------------------------------------------------------------ peak times -- */
console.log("\npeak scheduling");

// Saturday 2026-08-15 12:00 UTC, sender at UTC+0.
const sat = new Date("2026-08-15T12:00:00Z");
const slot = nextPeakSlot({ offsetMinutes: 0, now: sat });
check("weekend rolls forward to a weekday", [2, 3, 4].includes(slot.getUTCDay()),
  slot.toISOString());
check("lands mid-morning", slot.getUTCHours() >= 9 && slot.getUTCHours() < 11,
  `${slot.getUTCHours()}h`);
check("is in the future", slot.getTime() > sat.getTime());

// Tuesday 2026-08-18 15:00 UTC — past the window, so it must skip a day.
const tueAfternoon = new Date("2026-08-18T15:00:00Z");
const next = nextPeakSlot({ offsetMinutes: 0, now: tueAfternoon });
check("past today's window rolls to the next peak day",
  next.getTime() > tueAfternoon.getTime() && [2, 3, 4].includes(next.getUTCDay()),
  next.toISOString());

// Tuesday 2026-08-18 06:00 UTC — window still ahead, so it should be today.
const tueEarly = new Date("2026-08-18T06:00:00Z");
const today = nextPeakSlot({ offsetMinutes: 0, now: tueEarly });
check("before today's window uses today", today.getUTCDate() === 18,
  today.toISOString());

// Staggering must spread but stay inside the window.
const spread = [0, 1, 2, 3, 4, 5].map((index) =>
  nextPeakSlot({ offsetMinutes: 0, now: sat, index }),
);
check("stagger produces distinct times",
  new Set(spread.map((d) => d.getTime())).size === spread.length);
check("stagger stays inside the window",
  spread.every((d) => d.getUTCHours() >= 9 && d.getUTCHours() < 11));

// A non-UTC sender still gets their own mid-morning.
const ist = nextPeakSlot({ offsetMinutes: 330, now: sat });
const istLocal = new Date(ist.getTime() + 330 * 60_000);
check("respects the sender's offset (UTC+5:30)",
  istLocal.getUTCHours() >= 9 && istLocal.getUTCHours() < 11,
  describeSlot(ist, 330));

check("offset validation accepts real zones",
  readOffset(-480) === -480 && readOffset(330) === 330);
check("offset validation rejects nonsense",
  readOffset(99999) === null && readOffset("abc") === null && readOffset(null) === null);

/* ---------------------------------------------------------- draft parsing -- */
console.log("\ndraft parsing");

const clean = parseEmail("Subject: Rebuilding your storefront\n\nHi Ana,\n\nBody here.");
check("splits subject", clean.subject === "Rebuilding your storefront");
check("splits body", clean.body === "Hi Ana,\n\nBody here.");

const noBlank = parseEmail("Subject: One line\nStraight into the body.");
check("tolerates a missing blank line", noBlank.subject === "One line" &&
  noBlank.body === "Straight into the body.");

const fenced = parseEmail("```\nSubject: Fenced\n\nBody.\n```");
check("strips a code fence", fenced.subject === "Fenced" && fenced.body === "Body.");

const noSubject = parseEmail("Just a body with no subject line.");
check("keeps body when subject is missing",
  noSubject.subject === "" && noSubject.body.startsWith("Just a body"));

/* --------------------------------------------------------------- pixel ---- */
console.log("\nread receipts");

const html = markdownToHtml("Hello **there**.", "https://example.com/api/track/abc.gif");
check("pixel injected", html.includes('src="https://example.com/api/track/abc.gif"'));
check("pixel is 1x1", html.includes('width="1"') && html.includes('height="1"'));
check("pixel has empty alt", html.includes('alt=""'));

const noPixel = markdownToHtml("Hello **there**.");
check("no pixel when none supplied", !noPixel.includes("<img"));

// The sanitizer must still refuse images the draft itself asks for.
const injected = markdownToHtml("![x](https://evil.example/track.gif)");
check("markdown images stay stripped", !injected.includes("evil.example"));

const bothPixelAndMarkdownImage = markdownToHtml(
  "![x](https://evil.example/a.gif)",
  "https://example.com/api/track/ok.gif",
);
check("only the app's own pixel survives",
  bothPixelAndMarkdownImage.includes("api/track/ok.gif") &&
    !bothPixelAndMarkdownImage.includes("evil.example"));

check("ip coarsened to /24", ipPrefix("203.0.113.42") === "203.0.113.0/24");
check("ip takes the first forwarded hop",
  ipPrefix("203.0.113.42, 70.41.3.18") === "203.0.113.0/24");
check("ipv6 coarsened to /48", ipPrefix("2001:db8:1234:5678::1") === "2001:db8:1234::/48");
check("no ip yields null", ipPrefix(null) === null && ipPrefix("") === null);

const savedAppUrl = process.env.APP_URL;
process.env.APP_URL = "http://localhost:3000";
check("localhost is not a usable tracking origin", trackingOrigin() === null);
process.env.APP_URL = "https://mail.example.com/";
check("trailing slash trimmed", trackingOrigin() === "https://mail.example.com");
check("pixel url built", pixelUrl("tok") === "https://mail.example.com/api/track/tok.gif");
delete process.env.APP_URL;
check("no APP_URL means no pixel", pixelUrl("tok") === null);
if (savedAppUrl === undefined) delete process.env.APP_URL;
else process.env.APP_URL = savedAppUrl;

/* ----------------------------------------------------------------- mime --- */
/* Async, so it and everything after it live inside main(): tsx compiles this
   to CJS, where top-level await is not available. */
async function mimeChecks() {
  console.log("\nmime");

  const plainUntracked = Buffer.from(
    await buildMime({
      from: "me@example.com",
      to: "you@example.com",
      subject: "Hi",
      body: "A plain note with no formatting.",
    }),
    "base64url",
  ).toString("utf8");
  check("plain body stays text-only", !/Content-Type: text\/html/i.test(plainUntracked));

  const plainTracked = Buffer.from(
    await buildMime({
      from: "me@example.com",
      to: "you@example.com",
      subject: "Hi",
      body: "A plain note with no formatting.",
      pixelUrl: "https://mail.example.com/api/track/tok.gif",
    }),
    "base64url",
  ).toString("utf8");
  check("tracking forces an html part", /Content-Type: text\/html/i.test(plainTracked));
  check("tracked mail keeps a plain-text alternative",
    /Content-Type: text\/plain/i.test(plainTracked));
}

/* --------------------------------------------------------------- profile -- */
function remainingChecks() {
console.log("\nprofile");

check("empty profile is unusable", !profileIsUsable(base));
check("name plus long background is usable",
  profileIsUsable({ ...base, background: "x".repeat(41) }));
check("name plus offer and audience is usable",
  profileIsUsable({
    ...base,
    offer: "Shopify storefront rebuilds for skincare brands.",
    audience: "DTC founders",
  }));
check("offer alone is not enough",
  !profileIsUsable({ ...base, offer: "Shopify storefront rebuilds." }));

check("links split on newlines and commas",
  linkList({ ...base, links: "https://a.com\n https://b.com , https://c.com" }).length === 3);
check("blank link lines dropped",
  linkList({ ...base, links: "https://a.com\n\n\n" }).length === 1);

/* ----------------------------------------------------------------- depth -- */
console.log("\nresearch depth");

check("every tier has a profile", DEPTHS.every((d) => Boolean(DEPTH_PROFILE[d])));
check("depth increases pages read",
  DEPTH_PROFILE.basic.pagesPerPerson < DEPTH_PROFILE.deeper.pagesPerPerson &&
    DEPTH_PROFILE.deeper.pagesPerPerson < DEPTH_PROFILE.deepest.pagesPerPerson);
check("only the deepest tier supplements with Exa",
  !DEPTH_PROFILE.basic.exaSupplements &&
    !DEPTH_PROFILE.deeper.exaSupplements &&
    DEPTH_PROFILE.deepest.exaSupplements);
check("basic spends no Exa credits", DEPTH_PROFILE.basic.exaCalls === 0);
}

void (async () => {
  await mimeChecks();
  remainingChecks();
  console.log(fail ? `\n${fail} FAILED` : "\nAll outreach checks passed.");
  process.exit(fail ? 1 : 0);
})();
