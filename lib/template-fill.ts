/**
 * Placeholder substitution for saved templates.
 *
 * Shared by both sides: the browser fills a template into the draft editor the
 * moment one is picked, and the server fills the same template before handing
 * it to the writer model. Deliberately free of any database import — the person
 * card is a client component, and reaching lib/db from here would drag the
 * SQLite and Postgres drivers into the browser bundle.
 */

import type { Profile } from "./types";

/** A template as everything outside the database needs it. */
export interface TemplateSummary {
  id: string;
  name: string;
  subject: string;
  body: string;
  /** Freeform guidance handed to the writer model alongside the text. */
  notes: string;
}

/** Every name a template may address, resolved for one recipient. */
export interface TemplateVars {
  name: string;
  first_name: string;
  last_name: string;
  title: string;
  org: string;
  dept: string;
  email: string;
  my_name: string;
  my_headline: string;
  my_goal: string;
  signature: string;
}

/** The half of the variables that comes from the profile rather than the person. */
export type TemplateSender = Pick<
  TemplateVars,
  "my_name" | "my_headline" | "my_goal" | "signature"
>;

/** Documentation for the templates page. Order is the order they are listed. */
export const PLACEHOLDERS: { key: keyof TemplateVars; what: string }[] = [
  { key: "first_name", what: "Jane" },
  { key: "name", what: "Jane Smith" },
  { key: "last_name", what: "Smith" },
  { key: "title", what: "Associate Professor" },
  { key: "org", what: "University of Toronto" },
  { key: "dept", what: "Computer Science" },
  { key: "email", what: "the address it will be sent to" },
  { key: "my_name", what: "your name, from Settings" },
  { key: "my_headline", what: "your headline" },
  { key: "my_goal", what: "what you want, from your profile" },
  { key: "signature", what: "your signature" },
];

const TOKEN = /\{\{\s*([a-z_]+)\s*\}\}/gi;

/** "Dr. Jane Smith" is a name the app was given, not one to greet someone by. */
const HONORIFIC = /^(dr|prof|professor|mr|mrs|ms|mx)\.?\s+/i;

/**
 * Replaces every `{{placeholder}}` this app knows about.
 *
 * A name it does not know is left standing rather than blanked: an unrecognised
 * token is far more likely to be a typo than a deliberate literal, and leaving
 * it visible in the draft is what makes the typo findable before it is sent.
 */
export function fillTemplate(
  text: string,
  vars: Partial<TemplateVars>,
): string {
  const filled = text.replace(TOKEN, (whole, key: string) => {
    const value = vars[key.toLowerCase() as keyof TemplateVars];
    return value === undefined ? whole : value;
  });

  // A recipient with no title or department leaves a double space where the
  // placeholder was. Collapsing runs of spaces hides that; \n is excluded so
  // paragraph breaks and indented markdown lists survive intact.
  return filled.replace(/[^\S\n]{2,}/g, " ");
}

/** True if any `{{token}}` is still standing — i.e. one this app cannot fill. */
export function unfilledTokens(text: string): string[] {
  return [...new Set(text.match(TOKEN) ?? [])];
}

/** The sender half of the variables, read off the memory profile. */
export function senderVars(profile: Profile): TemplateSender {
  return {
    my_name: profile.full_name.trim(),
    my_headline: profile.headline.trim(),
    my_goal: profile.goal.trim(),
    signature: profile.signature.trim(),
  };
}

export function templateVars(
  person: {
    name: string;
    title?: string | null;
    org?: string | null;
    dept?: string | null;
    email?: string | null;
  },
  sender: TemplateSender,
): TemplateVars {
  const parts = person.name.replace(HONORIFIC, "").trim().split(/\s+/);
  return {
    name: person.name.trim(),
    first_name: parts[0] ?? "",
    last_name: parts.length > 1 ? parts[parts.length - 1] : "",
    title: person.title?.trim() ?? "",
    org: person.org?.trim() ?? "",
    dept: person.dept?.trim() ?? "",
    email: person.email?.trim() ?? "",
    ...sender,
  };
}

/** One template with its placeholders already resolved for this recipient. */
export function fillFor(
  template: TemplateSummary,
  vars: TemplateVars,
): { subject: string; body: string } {
  return {
    subject: fillTemplate(template.subject, vars),
    body: fillTemplate(template.body, vars),
  };
}
