import * as cheerio from "cheerio";
import { cached, DAY } from "../cache";

const UA = "Mozilla/5.0 (compatible; email-agent/0.1; +personal research tool)";
const MAX_BYTES = 1_500_000;
const TIMEOUT_MS = 20_000;

export interface Page {
  url: string;
  ok: boolean;
  status: number;
  title: string;
  text: string;
  html: string;
  blockedByRobots: boolean;
}

/* ------------------------------- robots.txt ------------------------------- */

interface Robots {
  disallow: string[];
  crawlDelayMs: number;
}

async function robotsFor(origin: string): Promise<Robots> {
  return cached<Robots>(`robots:${origin}`, 3 * DAY, async () => {
    const empty: Robots = { disallow: [], crawlDelayMs: 1000 };
    try {
      const res = await fetch(`${origin}/robots.txt`, {
        headers: { "User-Agent": UA },
        signal: AbortSignal.timeout(8000),
      });
      // No robots.txt (or an error page) means no restrictions.
      if (!res.ok) return empty;

      const body = (await res.text()).slice(0, 200_000);
      const disallow: string[] = [];
      let crawlDelayMs = 1000;
      let applies = false;

      for (const rawLine of body.split(/\r?\n/)) {
        const line = rawLine.split("#")[0].trim();
        if (!line) continue;
        const idx = line.indexOf(":");
        if (idx === -1) continue;
        const field = line.slice(0, idx).trim().toLowerCase();
        const value = line.slice(idx + 1).trim();

        if (field === "user-agent") {
          applies = value === "*" || value.toLowerCase().includes("email-agent");
        } else if (applies && field === "disallow" && value) {
          disallow.push(value);
        } else if (applies && field === "crawl-delay") {
          const secs = Number(value);
          if (Number.isFinite(secs)) {
            crawlDelayMs = Math.min(Math.max(secs * 1000, 1000), 10_000);
          }
        }
      }
      return { disallow, crawlDelayMs };
    } catch {
      return empty;
    }
  });
}

function pathAllowed(robots: Robots, pathname: string): boolean {
  return !robots.disallow.some((rule) => {
    if (rule === "/") return true;
    return pathname.startsWith(rule);
  });
}

/* ---------------------------- per-host throttle ---------------------------- */

const lastHit = new Map<string, number>();

async function throttle(host: string, delayMs: number): Promise<void> {
  const prev = lastHit.get(host) ?? 0;
  const wait = prev + delayMs - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastHit.set(host, Date.now());
}

/* --------------------------------- fetch ---------------------------------- */

/** Strip chrome so the LLM sees contact/bio text, not nav and scripts. */
export function htmlToText(html: string): { title: string; text: string } {
  const $ = cheerio.load(html);
  $("script, style, noscript, svg, iframe, nav, footer, header").remove();
  const title = $("title").first().text().trim();
  const text = $("body")
    .text()
    .replace(/[ \t ]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { title, text };
}

export async function fetchPage(url: string): Promise<Page> {
  const miss: Page = {
    url,
    ok: false,
    status: 0,
    title: "",
    text: "",
    html: "",
    blockedByRobots: false,
  };

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return miss;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return miss;

  return cached<Page>(`page:${url}`, 14 * DAY, async () => {
    const robots = await robotsFor(parsed.origin);
    if (!pathAllowed(robots, parsed.pathname)) {
      return { ...miss, blockedByRobots: true };
    }

    await throttle(parsed.host, robots.crawlDelayMs);

    try {
      const res = await fetch(url, {
        headers: { "User-Agent": UA, Accept: "text/html,*/*" },
        signal: AbortSignal.timeout(TIMEOUT_MS),
        redirect: "follow",
      });

      const type = res.headers.get("content-type") ?? "";
      if (!res.ok || !type.includes("html")) {
        return { ...miss, status: res.status };
      }

      const buf = await res.arrayBuffer();
      const html = new TextDecoder("utf-8", { fatal: false }).decode(
        buf.byteLength > MAX_BYTES ? buf.slice(0, MAX_BYTES) : buf,
      );
      const { title, text } = htmlToText(html);

      return {
        url: res.url || url,
        ok: true,
        status: res.status,
        title,
        text,
        html,
        blockedByRobots: false,
      };
    } catch {
      return miss;
    }
  });
}
