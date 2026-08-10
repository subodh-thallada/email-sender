# Email Agent

Search for people in plain English, get their profile and email address, and draft a cold email that references their actual work.

Academic search is the strong path: it runs on [OpenAlex](https://openalex.org), which is free, needs no API key, and has real coverage of university researchers.

## The Outreach dashboard

Everything you have sent, at `/dashboard`. One row per conversation: who, the
subject, whether they replied, whether the pixel fired, and what is still queued.
Rows collapse to a line and open into the whole exchange.

**Replies.** Pulled from Gmail on demand with *Check for replies*, which asks for
the conversations it already knows about rather than reading your inbox at
large. Needs the `gmail.readonly` grant; without it the rest of the page works
unchanged and says so. Reply HTML is stripped of scripts, styles and images
before it is ever stored — a remote image in a reply is a tracking pixel aimed
back at you, and rendering it would report "read" to the sender.

**Follow-ups.** Open a conversation and draft the next message from inside it.
The model gets the thread, not a blank page, and switches prompt depending on
whether they wrote back: a nudge is under 70 words and banned from "just
following up", a reply answers what they actually said and accepts a no in one
sentence without re-pitching. Send it now, at a time, or at the next peak slot.
It goes out inside the original conversation — same Gmail thread,
`In-Reply-To` and `References` set — so it threads in their client too, and the
subject is forced to exactly one `Re:`. Follow-ups count against the same daily
cap as first contact.

**Folders and tags.** A conversation lives in one folder and carries any number
of tags. Both are created inline, filter the list, and can be applied in bulk to
a multi-selection. Deleting a folder or tag never deletes conversations. Archive
takes finished threads out of the default view, and a compact toggle drops the
preview line when the list gets long.

## Outreach features

All configured under **Settings**.

**Memory profile.** Describe your business once — what you offer, who you serve,
what you have done — and it fills in the structured fields every later draft is
written from. It only fills blanks, never overwrites what you typed, and never
saves without you pressing Save: these values end up in mail sent to strangers
under your name. Filling in both *offer* and *audience* switches the writer from
academic outreach to a client pitch.

**Personalize.** Standing instructions ("never open with a question", "only
target people in Canada", "keep it under 100 words"). They outrank the built-in
rules everywhere — drafting, revising, and deciding who is worth writing to. The
one thing they cannot do is authorise inventing a fact.

**Bulk drafting.** Select people on a results page and draft them in one click.
Each draft is written and saved independently, so one failure costs one person
rather than the batch, and drafts survive a reload. The per-click ceiling and the
concurrency are both settings — concurrency is deliberately low, since a burst of
twenty is the fastest way to get rate-limited on every one of them.

**Read receipts.** A 1×1 pixel per message, recorded on load. Off by default, and
skipped entirely unless `APP_URL` points at a real deployed origin. Read the
numbers loosely: Gmail proxies and caches the image, Apple Mail Privacy
Protection loads it on delivery whether or not anyone looked, and a recipient
with images off never registers at all. Enabling it also forces an HTML part on
every message, which reads slightly more like bulk mail than plain text does.

**Peak-time scheduling.** "Send at the next peak time" picks the next Tuesday–
Thursday mid-morning slot and queues it, staggering a batch rather than firing it
all at once. The window is computed in *your* timezone, because nothing in the
pipeline establishes the recipient's — for outreach across continents, use the
manual time picker instead.

**Research depth.** Basic / deeper / deepest, controlling pages read per person,
candidates pulled before filtering, and whether Exa runs alongside Serper. Every
tier costs strictly more than the one below it. The `exaMaxPerSearch` cap still
applies on top, and the lower of the two wins.

## Setup

```bash
npm install
cp .env.example .env   # then fill in the keys
npm run dev
```

Open http://localhost:3000.

### Keys

| Variable | Needed for | Cost |
|---|---|---|
| `ANTHROPIC_API_KEY` **or** `OPENAI_API_KEY` | Query parsing, page extraction, drafting | Pay per use (see Cost) |
| `AI_PROVIDER` | `anthropic` / `openai`. Omit to auto-pick | — |
| `SERPER_API_KEY` | Finding faculty pages. **Unused when your query already has an address** | 2,500/month free — [serper.dev](https://serper.dev) |
| `OPENALEX_MAILTO` | Politeness header for OpenAlex | Free, no signup |
| `HUNTER_API_KEY` | Last-resort email lookup | 50/month free — optional |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Sending — you connect Gmail from Settings | Free |
| `TOKEN_ENCRYPTION_KEY` | Encrypts stored Google refresh tokens | Free |
| `DATABASE_URL` | SQLite file locally, Postgres/Supabase when deployed | Free tiers |

Exa is not used anywhere and needs no key.

### Connecting Gmail

No password is stored anywhere. At [console.cloud.google.com](https://console.cloud.google.com):

1. **APIs & Services → Library** → enable **Gmail API**.
2. **OAuth consent screen** → External.
3. **Credentials → Create OAuth client ID → Web application**, with these authorized redirect URIs:
   - `http://localhost:3000/api/google/callback`
   - `https://<your-domain>/api/google/callback`

Then generate the encryption key and connect from **Settings → Sending**:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Two scopes are requested: `gmail.send` to send as you, and `gmail.readonly` so
the Outreach dashboard can show replies. Nothing is ever deleted or modified in
your mailbox. You can untick the read one on Google's consent screen — sending,
scheduling and filing all still work, only the reply timeline goes away. Revoke
either from Settings or at
[myaccount.google.com/permissions](https://myaccount.google.com/permissions).

Add `gmail.readonly` to the consent screen's scope list before connecting. An
account that is already connected keeps whatever it was granted and will not
pick up the new scope on its own — Settings flags it as send-only with a
reconnect prompt.

**Set the publishing status to "In production", not "Testing".** While an OAuth
consent screen sits in Testing, Google expires every refresh token after 7 days,
so sending would silently break each week and need reconnecting. Publishing
without verification is fine — you get the "Google hasn't verified this app"
interstitial (Advanced → Go to … ) and a 100-user ceiling. `gmail.send` is a
*sensitive* scope and `gmail.readonly` is a *restricted* one; both work
unverified under that ceiling. Lifting it needs Google's app verification, and
for the restricted scope a third-party security assessment on top — a real
expense, and pointless for a tool serving one mailbox. Stay under 100 users.

Fill in your profile on **Settings** before drafting — the writer uses your background to make emails specific, and refuses to draft without it.

## Cost

The expensive step is reading fetched pages. One switch controls it, in `lib/ai/models.ts`:

| Provider | Default | `EXTRACTION_MODEL=` |
|---|---|---|
| Anthropic | `claude-opus-5` — ~$2.50 | `claude-haiku-4-5` — ~$0.60 |
| OpenAI | `gpt-5.6` (Sol) — ~$2.50 | `gpt-5.6-luna` — ~$0.10 |

It only swaps the page-extraction step. Parsing and drafting stay on the flagship either way — they are single small calls where quality matters most.

**Cheapest path of all:** paste the address into the query. That skips search and extraction entirely.

Every external call (OpenAlex, Serper, page fetches, LLM extraction) is cached in SQLite, so re-running a search costs nothing.

## How a search works

**If your query already contains an email address, none of this runs.** The address is de-obfuscated (`jane [at] mit.edu` works), MX-checked, and you go straight to drafting. No OpenAlex, no Serper, no page fetches — one small LLM call to pull out the name and any context you typed, and even that degrades gracefully if it fails. Addresses you supply are trusted: the placeholder blocklist that rejects `x@` and `jane.doe@` on scraped pages does not apply to your own input.

Otherwise:

1. **Parse** — your sentence becomes structured filters.
2. **Discover** — OpenAlex: institution → research topics → authors.
3. **Rerank** — drops stale affiliations and grad students. OpenAlex's "last known institution" is often wrong, and prolific PhD students outrank faculty on raw citations, so this step is load-bearing.
4. **Enrich** — Google their name, fetch their top pages, extract a profile.
5. **Email waterfall**, best evidence first:
   1. addresses literally on the page (`mailto:`, plain, or de-obfuscated)
   2. the model's read of the same pages
   3. a bare `mailto:surname` + the institution's mail domain
   4. a learned per-domain pattern
   5. Hunter.io
6. **Verify** — syntax, MX record, disposable-domain check.
7. **Draft** — streaming, editable, never auto-sent.

### Why the de-obfuscation step exists

Real pages, measured while building this:

| Page | Raw | Result |
|---|---|---|
| `asrl.utias.utoronto.ca/~tdb/` | `tim.barfoot [at] utoronto.ca` | recovered |
| `cs.toronto.edu/~florian/` | `x@cs.toronto.edu` | rejected as a template stub |
| `dynsyslab.org/prof-angela-schoellig/` | `href="mailto:schoellig"` | local part kept, domain supplied |

A plain email regex gets zero of these right.

### Confidence labels

Nothing is labelled **verified** unless a real verification service is wired in — MX only proves the *domain* accepts mail, not that the mailbox exists. Scraped addresses top out at **found on page**; anything generated from a domain pattern is **guessed from domain pattern** and flagged in the UI before you send.

## Verification scripts

No API keys required:

```bash
npx tsx --env-file=.env scripts/check-academic.ts     # OpenAlex discovery on a real query
npx tsx scripts/check-deobfuscate.ts                        # 19 patterns + 3 live faculty pages
npx tsx --env-file=.env scripts/check-waterfall.ts    # scrape → learn → infer → verify
npx tsx --env-file=.env scripts/check-db.ts           # schema + profile round-trip
npx tsx scripts/check-sema.ts                               # peak times, pixel, draft parsing, depth
npx tsx scripts/check-threads.ts                            # dashboard store, threading, follow-up prompts
```

## Deploying to Vercel

Two things must change:

1. **Database.** Vercel's filesystem is ephemeral and read-only, so `file:./data/app.db` cannot work. Point `DATABASE_URL` at Supabase (Project Settings → Database → Connection string → **Transaction pooler**). The Postgres schema is applied automatically on first connect from `lib/db/schema.postgres.sql`.
2. **Auth.** There is none. See below.

## Auth — currently none

Locally that is fine: only you can reach `localhost`.

**Deployed publicly it is not.** Anyone who finds the URL can spend your API keys and send email from your Gmail. Before deploying, either keep it private (Vercel password protection / preview-only) or add real login.

Note these are two separate things:

- **Logging into this app** — none today. Supabase Auth email+password works fine and needs no Google setup. Google OAuth is optional polish, not a requirement.
- **Sending as you** — the Google OAuth grant above, independent of whichever login you pick. Nothing is sent until an account is connected in Settings.

## Limits

- **Academic queries only.** Corporate ("engineers at McKinsey Toronto") and alumni ("ex-RBC interns from McMaster") queries are detected and rejected with a clear message rather than returning bad results. Those live in LinkedIn-shaped data, and no legal API for it survived the Proxycurl shutdown in 2026.
- **Serper's 2,500/month** is the throughput ceiling: roughly 40–80 searches/month.
- **~25–50 sends/day** on a personal Gmail. The cap is enforced, not advisory; change it in Settings.
- Addresses rendered as images aren't readable (would need OCR).
- Sending is one click per person. There is no bulk send, by design.

## Compliance

Canada's CASL exempts non-commercial messages, which covers academic and networking outreach, but include your real identity and honour opt-outs. `robots.txt` is respected and hosts are rate-limited to one request per second. LinkedIn is never scraped. GDPR applies if you email people in the EU.
