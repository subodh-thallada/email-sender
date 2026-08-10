import MailComposer from "nodemailer/lib/mail-composer";
import { tokenFor } from "../google/accounts";
import { hasFormatting, markdownToHtml, markdownToPlain } from "./render";

/**
 * Sends through the Gmail API on behalf of a connected account.
 *
 * Replaces SMTP with an app password. An app password is a permanent
 * full-mailbox credential typed into a config file; the gmail.send grant can
 * only send, is revocable from the user's Google account page, and belongs to
 * whoever signed in rather than to whoever deployed the app.
 *
 * Gmail files anything sent this way into the account's Sent folder, same as
 * SMTP submission did, so there is no separate IMAP APPEND to do.
 */

const SEND_ENDPOINT =
  "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";

export interface SendInput {
  /** Connected Google account to send as. */
  from: string;
  to: string;
  subject: string;
  /** Markdown. Rendered to an HTML part with a plain-text alternative. */
  body: string;
  fromName?: string;
  /**
   * Read-receipt pixel. Its presence forces an HTML part even for a plain
   * body — there is nowhere else to hang an image.
   */
  pixelUrl?: string | null;
  /**
   * Gmail conversation to append to. Set on follow-ups so the message lands
   * inside the original thread rather than starting a new one. Gmail only
   * honours it when the subject also matches the thread's, which is why
   * follow-up subjects are built as "Re: <original>".
   */
  threadId?: string | null;
  /** RFC-2822 Message-ID of the message being replied to. */
  inReplyTo?: string | null;
  /** Full References chain, oldest first, space separated. */
  references?: string | null;
}

/** Builds RFC-2822 bytes. MailComposer is nodemailer's MIME builder, used here
 * without any transport — it handles encoding, folding and multipart/alternative
 * correctly, which is not worth reimplementing. */
export async function buildMime(input: SendInput): Promise<string> {
  // A plain note sent as HTML looks more like bulk mail, so the HTML part is
  // normally opt-in on formatting. Tracking overrides that: the pixel is an
  // image, and an image needs somewhere to live.
  const html = hasFormatting(input.body) || Boolean(input.pixelUrl);

  const raw = await new MailComposer({
    from: input.fromName
      ? { name: input.fromName, address: input.from }
      : input.from,
    to: input.to,
    subject: input.subject,
    // Always send text/plain.
    text: html ? markdownToPlain(input.body) : input.body,
    ...(html ? { html: markdownToHtml(input.body, input.pixelUrl) } : {}),
    replyTo: input.from,
    // Threading headers. Gmail's own threadId groups the copy in *our* mailbox;
    // these are what make the recipient's client group it too.
    ...(input.inReplyTo ? { inReplyTo: input.inReplyTo } : {}),
    ...(input.references ? { references: input.references } : {}),
  })
    .compile()
    .build();

  return raw.toString("base64url");
}

export async function sendMail(
  input: SendInput,
): Promise<{ messageId: string; threadId: string | null }> {
  const token = await tokenFor(input.from);

  const res = await fetch(SEND_ENDPOINT, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      raw: await buildMime(input),
      ...(input.threadId ? { threadId: input.threadId } : {}),
    }),
  });

  const json = (await res.json().catch(() => ({}))) as {
    id?: string;
    threadId?: string;
    error?: { message?: string; status?: string };
  };

  if (!res.ok) {
    const detail = json.error?.message ?? `HTTP ${res.status}`;
    // 403 with no other explanation is almost always the API being switched
    // off, which is invisible from the error text alone.
    if (res.status === 403 && /disabled|not been used|accessNotConfigured/i.test(detail)) {
      throw new Error(
        `${detail} — enable the Gmail API for your Google Cloud project.`,
      );
    }
    throw new Error(`Gmail rejected the message: ${detail}`);
  }

  // Gmail's own message id, not the RFC Message-ID header: it is what identifies
  // the message inside the mailbox. threadId comes back on every send, including
  // the first — that is how a conversation gets its id in the first place.
  return { messageId: json.id ?? "", threadId: json.threadId ?? null };
}
