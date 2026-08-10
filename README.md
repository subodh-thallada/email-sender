# Email Agent

Search for people in plain English, get their profile and email address, and draft a cold email that references their actual work.

Academic search is the strong path: it runs on [OpenAlex](https://openalex.org), which is free, needs no API key, and has real coverage of university researchers.

## Setup

```bash
npm install
cp .env.example .env.local   # then fill in the keys
npm run dev
```

Open http://localhost:3000.

### Keys

| Variable | Needed for | Cost |
|---|---|---|
| `ANTHROPIC_API_KEY` | Query parsing, page extraction, email drafting | Pay per use (~$0.60–2.50 per search, see below) |
| `SERPER_API_KEY` | Finding faculty/homepages | 2,500 searches/month free — [serper.dev](https://serper.dev) |
| `OPENALEX_MAILTO` | Politeness header for OpenAlex | Free, no signup |
| `HUNTER_API_KEY` | Last-resort email lookup | 50/month free — optional |
| `EXA_API_KEY` | Reserved for corporate/alumni routes | $10 free credits/month — optional |
| `GMAIL_USER` / `GMAIL_APP_PASSWORD` | Sending | Free — needed only to send |

**Gmail App Password**, not your account password. Turn on 2-Step Verification, then Google Account → Security → 2-Step Verification → App passwords. (OAuth is deliberately avoided: `gmail.send` is a restricted scope whose refresh tokens expire every 7 days outside a verified production app.)

Fill in your profile on **Settings** before drafting — the writer uses your background to make emails specific, and refuses to draft without it.

## Cost

The expensive step is reading fetched pages. One switch controls it, in `lib/ai/models.ts`:

| `EXTRACTION_MODEL` | Per ~20-person search |
|---|---|
| unset (Claude Opus 5, default) | ~$2.50 |
| `claude-haiku-4-5` | ~$0.60 |

Query parsing and email drafting stay on Opus 5 either way — they are single small calls where quality matters most.

Every external call (OpenAlex, Serper, page fetches, LLM extraction) is cached in SQLite, so re-running a search costs nothing.

## How a search works

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
npx tsx --env-file=.env.local scripts/check-academic.ts     # OpenAlex discovery on a real query
npx tsx scripts/check-deobfuscate.ts                        # 19 patterns + 3 live faculty pages
npx tsx --env-file=.env.local scripts/check-waterfall.ts    # scrape → learn → infer → verify
npx tsx --env-file=.env.local scripts/check-db.ts           # schema + profile round-trip
```

## Limits

- **Academic queries only.** Corporate ("engineers at McKinsey Toronto") and alumni ("ex-RBC interns from McMaster") queries are detected and rejected with a clear message rather than returning bad results. Those live in LinkedIn-shaped data, and no legal API for it survived the Proxycurl shutdown in 2026.
- **Serper's 2,500/month** is the throughput ceiling: roughly 40–80 searches/month.
- **~25–50 sends/day** on a personal Gmail. The cap is enforced, not advisory; change it in Settings.
- Addresses rendered as images aren't readable (would need OCR).
- Sending is one click per person. There is no bulk send, by design.

## Compliance

Canada's CASL exempts non-commercial messages, which covers academic and networking outreach, but include your real identity and honour opt-outs. `robots.txt` is respected and hosts are rate-limited to one request per second. LinkedIn is never scraped. GDPR applies if you email people in the EU.
