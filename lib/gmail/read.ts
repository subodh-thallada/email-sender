import sanitizeHtml from "sanitize-html";
import { tokenFor } from "../google/accounts";

/**
 * The read half of the Gmail integration: pulling a conversation back out so
 * replies can be shown next to what was sent.
 *
 * Everything here needs the gmail.readonly grant. Callers are expected to have
 * checked `ConnectedAccount.canRead` first; if they have not, Google answers
 * 403 and `GmailReadError` says why in words the UI can show directly.
 */

const API = "https://gmail.googleapis.com/gmail/v1/users/me";

export class GmailReadError extends Error {
  constructor(
    message: string,
    /** True when the fix is "reconnect the account", not "try again". */
    readonly needsReconnect = false,
  ) {
    super(message);
  }
}

interface GmailHeader {
  name: string;
  value: string;
}

interface GmailPart {
  mimeType?: string;
  filename?: string;
  headers?: GmailHeader[];
  body?: { data?: string; size?: number; attachmentId?: string };
  parts?: GmailPart[];
}

interface GmailMessage {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;
  payload?: GmailPart;
}

async function get<T>(email: string, path: string): Promise<T> {
  const token = await tokenFor(email);
  const res = await fetch(`${API}${path}`, {
    headers: { authorization: `Bearer ${token}` },
  });

  if (res.ok) return (await res.json()) as T;

  const json = (await res.json().catch(() => ({}))) as {
    error?: { message?: string };
  };
  const detail = json.error?.message ?? `HTTP ${res.status}`;

  // 403 on a read is nearly always the missing scope rather than a real
  // permission problem, and the raw message ("Request had insufficient
  // authentication scopes") does not tell anyone what to do about it.
  if (res.status === 403) {
    throw new GmailReadError(
      `${email} has not granted permission to read mail. Reconnect it in Settings and leave the read checkbox ticked. (${detail})`,
      true,
    );
  }
  if (res.status === 401) {
    throw new GmailReadError(
      `Google rejected the credentials for ${email}. Reconnect it in Settings.`,
      true,
    );
  }
  throw new GmailReadError(`Gmail read failed: ${detail}`);
}

/** Case-insensitive header lookup — Gmail's casing is not guaranteed. */
function header(part: GmailPart | undefined, name: string): string {
  const found = part?.headers?.find(
    (h) => h.name.toLowerCase() === name.toLowerCase(),
  );
  return found?.value ?? "";
}

function decode(data: string | undefined): string {
  if (!data) return "";
  try {
    return Buffer.from(data, "base64url").toString("utf8");
  } catch {
    return "";
  }
}

/**
 * Depth-first walk for the first part of a given type.
 *
 * Attachments are skipped by filename rather than by disposition: an inline
 * image carries `Content-Disposition: inline` and would otherwise be mistaken
 * for the body of an HTML message.
 */
function findPart(part: GmailPart | undefined, mime: string): GmailPart | null {
  if (!part) return null;
  if (part.mimeType === mime && !part.filename) return part;
  for (const child of part.parts ?? []) {
    const hit = findPart(child, mime);
    if (hit) return hit;
  }
  return null;
}

/**
 * Reply HTML, made safe to drop into the dashboard.
 *
 * Images are stripped along with scripts and styles. A remote image in a reply
 * is a tracking pixel aimed back at the user — the same trick this app uses on
 * its own outgoing mail — and rendering it would report "read" to whoever sent
 * it the moment the dashboard loaded.
 */
export function sanitizeReplyHtml(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: [
      "p", "br", "strong", "b", "em", "i", "u", "s", "a", "ul", "ol", "li",
      "blockquote", "code", "pre", "h1", "h2", "h3", "h4", "hr", "span", "div",
      "table", "thead", "tbody", "tr", "td", "th",
    ],
    allowedAttributes: { a: ["href", "title", "target", "rel"] },
    allowedSchemes: ["http", "https", "mailto"],
    nonTextTags: ["style", "script", "textarea", "option", "noscript", "head"],
    transformTags: {
      a: (tagName, attribs) => ({
        tagName,
        attribs: { ...attribs, target: "_blank", rel: "noopener noreferrer" },
      }),
    },
  });
}

export interface ParsedAddress {
  name: string | null;
  address: string;
}

/** Splits `"Ada Lovelace" <ada@example.com>` into its two halves. */
export function parseAddress(raw: string): ParsedAddress {
  const match = raw.match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
  if (match) {
    const name = match[1].replace(/^["']|["']$/g, "").trim();
    return { name: name || null, address: match[2].trim().toLowerCase() };
  }
  return { name: null, address: raw.trim().toLowerCase() };
}

export interface ThreadMessage {
  gmailId: string;
  gmailThreadId: string;
  from: ParsedAddress;
  to: string;
  subject: string;
  snippet: string;
  text: string;
  html: string | null;
  /** RFC-2822 Message-ID. A follow-up cites this in In-Reply-To. */
  rfcMessageId: string | null;
  /** UTC 'YYYY-MM-DD HH:MM:SS', matching every other timestamp in the schema. */
  sentAt: string;
}

function stamp(internalDate: string | undefined, fallbackHeader: string): string {
  const ms = Number(internalDate);
  const date = Number.isFinite(ms) && ms > 0 ? new Date(ms) : new Date(fallbackHeader);
  const usable = Number.isNaN(date.getTime()) ? new Date() : date;
  return usable.toISOString().slice(0, 19).replace("T", " ");
}

function parseMessage(msg: GmailMessage): ThreadMessage {
  const payload = msg.payload;
  const plain = findPart(payload, "text/plain");
  const rich = findPart(payload, "text/html");

  // A single-part message has its body on the payload itself and no `parts`,
  // so findPart misses it — fall back to whatever the top level holds.
  const text =
    decode(plain?.body?.data) ||
    (payload?.mimeType === "text/plain" ? decode(payload.body?.data) : "");
  const html =
    decode(rich?.body?.data) ||
    (payload?.mimeType === "text/html" ? decode(payload.body?.data) : "");

  return {
    gmailId: msg.id,
    gmailThreadId: msg.threadId,
    from: parseAddress(header(payload, "From")),
    to: header(payload, "To"),
    subject: header(payload, "Subject"),
    snippet: decodeEntities(msg.snippet ?? ""),
    text,
    html: html ? sanitizeReplyHtml(html) : null,
    rfcMessageId: header(payload, "Message-ID") || null,
    sentAt: stamp(msg.internalDate, header(payload, "Date")),
  };
}

/** Gmail escapes a handful of entities in `snippet` and nothing else. */
function decodeEntities(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ");
}

/** Every message in one conversation, oldest first. */
export async function fetchThread(
  email: string,
  gmailThreadId: string,
): Promise<ThreadMessage[]> {
  const thread = await get<{ messages?: GmailMessage[] }>(
    email,
    `/threads/${encodeURIComponent(gmailThreadId)}?format=full`,
  );
  return (thread.messages ?? [])
    .map(parseMessage)
    .sort((a, b) => a.sentAt.localeCompare(b.sentAt));
}

/**
 * The thread a previously sent message belongs to.
 *
 * Only needed to backfill sends made before thread ids were recorded; new sends
 * get the id straight back from the send call.
 */
export async function fetchThreadIdFor(
  email: string,
  gmailMessageId: string,
): Promise<string | null> {
  const msg = await get<{ threadId?: string }>(
    email,
    `/messages/${encodeURIComponent(gmailMessageId)}?format=minimal`,
  );
  return msg.threadId ?? null;
}
