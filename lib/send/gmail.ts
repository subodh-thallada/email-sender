import nodemailer, { type Transporter } from "nodemailer";
import { hasFormatting, markdownToHtml, markdownToPlain } from "./render";

let transporter: Transporter | null = null;

export function gmailConfigured(): boolean {
  return Boolean(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD);
}

function transport(): Transporter {
  if (!gmailConfigured()) {
    throw new Error(
      "GMAIL_USER and GMAIL_APP_PASSWORD are not set. Add them to .env.local and restart.",
    );
  }
  transporter ??= nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_APP_PASSWORD,
    },
  });
  return transporter;
}

export interface SendInput {
  to: string;
  subject: string;
  /** Markdown. Rendered to an HTML part with a plain-text alternative. */
  body: string;
  fromName?: string;
}

/**
 * Send one message through Gmail's SMTP submission service.
 *
 * Gmail copies anything sent through smtp.gmail.com into the account's Sent
 * folder automatically, so no separate IMAP APPEND is needed.
 */
export async function sendMail(
  input: SendInput,
): Promise<{ messageId: string }> {
  const user = process.env.GMAIL_USER!;
  const formatted = hasFormatting(input.body);

  const info = await transport().sendMail({
    from: input.fromName ? `"${input.fromName}" <${user}>` : user,
    to: input.to,
    subject: input.subject,
    // Always send text/plain. Add the HTML part only when the body actually
    // uses formatting — a plain note sent as HTML looks more like bulk mail.
    text: formatted ? markdownToPlain(input.body) : input.body,
    ...(formatted ? { html: markdownToHtml(input.body) } : {}),
    replyTo: user,
  });
  return { messageId: info.messageId };
}

export async function verifyTransport(): Promise<void> {
  await transport().verify();
}
