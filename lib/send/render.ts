import { marked } from "marked";
import sanitizeHtml from "sanitize-html";

/**
 * Drafts are authored as markdown and sent as multipart: an HTML part for
 * clients that render it, and the original markdown as the plain-text
 * alternative. That keeps links and formatting without producing the
 * tag-soup that hurts deliverability.
 */

marked.setOptions({ gfm: true, breaks: true });

/** Conservative allowlist. Anything a cold email legitimately needs, nothing else. */
const ALLOWED_TAGS = [
  "p", "br", "strong", "b", "em", "i", "u", "s",
  "a", "ul", "ol", "li", "blockquote", "code", "pre",
  "h1", "h2", "h3", "h4", "hr", "span", "div",
];

export function markdownToHtml(md: string): string {
  const raw = marked.parse(md, { async: false });

  const clean = sanitizeHtml(raw, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: {
      // target/rel must be allowed here or transformTags' additions get
      // stripped straight back out by the attribute allowlist.
      a: ["href", "title", "target", "rel"],
      span: ["style"],
      div: ["style"],
      p: ["style"],
    },
    // No javascript:, no data: — only real links.
    allowedSchemes: ["http", "https", "mailto"],
    allowedStyles: {
      "*": {
        color: [/^#[0-9a-f]{3,6}$/i],
        "font-weight": [/^(bold|normal|\d{3})$/],
        "text-align": [/^(left|right|center)$/],
      },
    },
    transformTags: {
      // Open in a new tab, and never leak the referrer.
      a: (tagName, attribs) => ({
        tagName,
        attribs: { ...attribs, target: "_blank", rel: "noopener noreferrer" },
      }),
    },
  });

  return wrap(clean);
}

/**
 * Inline styles only — Gmail and Outlook strip <style> blocks. System font
 * stack so it matches whatever the reader's client already uses.
 */
function wrap(body: string): string {
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;padding:0;background:#ffffff;">
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.55;color:#14161a;max-width:600px;">
${body}
</div>
</body></html>`;
}

/**
 * The text/plain alternative. Markdown is already close to plain text; strip
 * the syntax that reads as noise and turn links into "text (url)".
 */
export function markdownToPlain(md: string): string {
  return md
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/(\*\*|__)(.*?)\1/g, "$2")
    .replace(/(\*|_)(.*?)\1/g, "$2")
    .replace(/^\s*>\s?/gm, "")
    .replace(/`{1,3}([^`]*)`{1,3}/g, "$1")
    .replace(/^\s*[-*+]\s+/gm, "- ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** True when the body uses any markdown worth rendering as HTML. */
export function hasFormatting(md: string): boolean {
  return /\[[^\]]+\]\([^)]+\)|(\*\*|__).+?\1|^#{1,6}\s|^\s*[-*+]\s|^\s*\d+\.\s|`/m.test(
    md,
  );
}
