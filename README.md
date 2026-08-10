# Email Agent

Search for people in plain English, get their profile and email address, and draft a cold email that references their actual work.

Academic search is the strong path: it runs on [OpenAlex](https://openalex.org), which is free, needs no API key, and has real coverage of university researchers.

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
| `GMAIL_USER` / `GMAIL_APP_PASSWORD` | Sending | Free — needed only to send |
| `DATABASE_URL` | SQLite file locally, Postgres/Supabase when deployed | Free tiers |

Exa is not used anywhere and needs no key.

**Gmail App Password**, not your account password. Turn on 2-Step Verification, then Google Account → Security → 2-Step Verification → App passwords. (OAuth is deliberately avoided: `gmail.send` is a restricted scope whose refresh tokens expire every 7 days outside a verified production app.)

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
- **Sending as you** — already handled by the Gmail App Password, and unaffected by whichever login you pick.

## Limits

- **Academic queries only.** Corporate ("engineers at McKinsey Toronto") and alumni ("ex-RBC interns from McMaster") queries are detected and rejected with a clear message rather than returning bad results. Those live in LinkedIn-shaped data, and no legal API for it survived the Proxycurl shutdown in 2026.
- **Serper's 2,500/month** is the throughput ceiling: roughly 40–80 searches/month.
- **~25–50 sends/day** on a personal Gmail. The cap is enforced, not advisory; change it in Settings.
- Addresses rendered as images aren't readable (would need OCR).
- Sending is one click per person. There is no bulk send, by design.

## Compliance

Canada's CASL exempts non-commercial messages, which covers academic and networking outreach, but include your real identity and honour opt-outs. `robots.txt` is respected and hosts are rate-limited to one request per second. LinkedIn is never scraped. GDPR applies if you email people in the EU.
