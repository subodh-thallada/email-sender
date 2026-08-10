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
}

/** Builds RFC-2822 bytes. MailComposer is nodemailer's MIME builder, used here
 * without any transport — it handles encoding, folding and multipart/alternative
 * correctly, which is not worth reimplementing. */
export async function buildMime(input: SendInput): Promise<string> {
  const formatted = hasFormatting(input.body);

  const raw = await new MailComposer({
    from: input.fromName
      ? { name: input.fromName, address: input.from }
      : input.from,
    to: input.to,
    subject: input.subject,
    // Always send text/plain. Add the HTML part only when the body actually
    // uses formatting — a plain note sent as HTML looks more like bulk mail.
    text: formatted ? markdownToPlain(input.body) : input.body,
    ...(formatted ? { html: markdownToHtml(input.body) } : {}),
    replyTo: input.from,
  })
    .compile()
    .build();

  return raw.toString("base64url");
}

export async function sendMail(
  input: SendInput,
): Promise<{ messageId: string }> {
  const token = await tokenFor(input.from);

  const res = await fetch(SEND_ENDPOINT, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ raw: await buildMime(input) }),
  });

  const json = (await res.json().catch(() => ({}))) as {
    id?: string;
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
  // the message inside the mailbox.
  return { messageId: json.id ?? "" };
}
