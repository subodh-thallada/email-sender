/**
 * Shapes shared between the dashboard's server page and its client components.
 *
 * Deliberately free of imports: a client component that reached these through
 * lib/threads/store would pull the database driver into the browser bundle.
 */

export type LabelKind = "folder" | "tag";

/** Muted enough to sit beside the app's single green accent without competing. */
export const LABEL_COLORS = {
  slate: "#6e7480",
  green: "#1f5f4f",
  blue: "#2f5d8a",
  amber: "#9a6b1f",
  rose: "#9c3f52",
  violet: "#5f4a8a",
  teal: "#2c6f6b",
} as const;

export type LabelColor = keyof typeof LABEL_COLORS;

export const LABEL_COLOR_KEYS = Object.keys(LABEL_COLORS) as LabelColor[];

export function colorHex(color: string): string {
  return LABEL_COLORS[color as LabelColor] ?? LABEL_COLORS.slate;
}

export interface LabelView {
  id: string;
  kind: LabelKind;
  name: string;
  color: string;
}

export interface MessageView {
  id: string;
  direction: "outgoing" | "incoming";
  fromName: string | null;
  fromAddress: string;
  toAddress: string;
  subject: string;
  snippet: string;
  text: string;
  html: string | null;
  sentAt: string;
}

/** A queued message that has not gone out yet. */
export interface PendingView {
  id: string;
  subject: string;
  body: string;
  scheduledAt: string;
  error: string | null;
}

export interface ThreadView {
  id: string;
  gmailThreadId: string | null;
  personId: string | null;
  contactName: string | null;
  contactEmail: string;
  subject: string;
  folderId: string | null;
  archived: boolean;
  replyCount: number;
  lastSentAt: string | null;
  lastReplyAt: string | null;
  syncedAt: string | null;
  tagIds: string[];
  /** Pixel loads across every message in the thread. Weak evidence — see
   *  lib/send/tracking.ts for exactly how weak. */
  openCount: number;
  firstOpenedAt: string | null;
  sendCount: number;
  errorCount: number;
  scheduledCount: number;
  nextScheduledAt: string | null;
  /** Snippet of the most recent message, for the collapsed row. */
  preview: string;
  previewDirection: "outgoing" | "incoming" | null;
}

/** The full conversation, loaded only when a row is expanded. */
export interface ThreadDetail {
  thread: ThreadView;
  messages: MessageView[];
  pending: PendingView[];
}

/**
 * The one state a row is in, in priority order: a failure outranks a queued
 * message, which outranks a reply, which outranks silence. Pure, so the client
 * can recompute it after an optimistic edit without a round trip.
 */
export type ThreadState = "error" | "scheduled" | "replied" | "opened" | "awaiting";

export function threadState(t: ThreadView): ThreadState {
  if (t.errorCount > 0 && t.sendCount === 0) return "error";
  if (t.scheduledCount > 0) return "scheduled";
  if (t.replyCount > 0) return "replied";
  if (t.openCount > 0) return "opened";
  return "awaiting";
}

/**
 * The subject a follow-up must carry.
 *
 * Exactly one "Re:" — Gmail only files a message into a thread when the subject
 * matches, and "Re: Re: Re:" both fails that match and looks like a mail loop.
 * Lives here rather than beside the follow-up prompt so the composer can show
 * the same subject the server will send, without importing the AI stack.
 */
export function followupSubject(original: string): string {
  const stripped = original.replace(/^\s*(re\s*:\s*)+/i, "").trim();
  return stripped ? `Re: ${stripped}` : "Re:";
}

export const STATE_LABEL: Record<ThreadState, string> = {
  error: "Failed",
  scheduled: "Scheduled",
  replied: "Replied",
  opened: "Opened",
  awaiting: "No reply",
};
