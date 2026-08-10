-- Single-user cold email agent. All timestamps are ISO-8601 UTC strings.

CREATE TABLE IF NOT EXISTS profile (
  id             INTEGER PRIMARY KEY CHECK (id = 1),
  full_name      TEXT NOT NULL DEFAULT '',
  headline       TEXT NOT NULL DEFAULT '',   -- "3rd-year CS undergrad at McMaster"
  background     TEXT NOT NULL DEFAULT '',   -- resume text / bio, pasted
  goal           TEXT NOT NULL DEFAULT '',   -- "looking for a summer research position"
  tone           TEXT NOT NULL DEFAULT 'warm-professional',
  signature      TEXT NOT NULL DEFAULT '',
  daily_send_cap INTEGER NOT NULL DEFAULT 25,
  -- Memory profile. Filled either by hand or by lib/ai/build-profile.ts from a
  -- freeform description, and reused by every draft from then on.
  offer          TEXT NOT NULL DEFAULT '',   -- what you sell / do
  audience       TEXT NOT NULL DEFAULT '',   -- who you serve
  links          TEXT NOT NULL DEFAULT '',   -- one URL per line: site, portfolio
  -- Persistent user directives. Outrank everything else in every prompt.
  instructions   TEXT NOT NULL DEFAULT '',
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS searches (
  id          TEXT PRIMARY KEY,
  query       TEXT NOT NULL,
  intent      TEXT,                          -- JSON: parsed ParsedQuery
  route       TEXT,                          -- academic | corporate | alumni
  status      TEXT NOT NULL DEFAULT 'running', -- running | done | error
  error       TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS people (
  id           TEXT PRIMARY KEY,
  search_id    TEXT NOT NULL REFERENCES searches(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  title        TEXT,
  org          TEXT,
  dept         TEXT,
  location     TEXT,
  homepage     TEXT,
  openalex_id  TEXT,
  orcid        TEXT,
  works_count  INTEGER,
  cited_by     INTEGER,
  dossier      TEXT,                         -- JSON: Dossier (research areas, papers, notes)
  score        REAL NOT NULL DEFAULT 0,      -- rerank relevance 0..1
  rank         INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_people_search ON people(search_id, rank);

CREATE TABLE IF NOT EXISTS emails (
  id          TEXT PRIMARY KEY,
  person_id   TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  address     TEXT NOT NULL,
  source      TEXT NOT NULL,                 -- mailto | regex | deobfuscated | llm | pattern | hunter
  confidence  TEXT NOT NULL,                 -- verified | high | inferred | unknown
  mx_ok       INTEGER,                       -- 0/1/null
  evidence    TEXT,                          -- URL or snippet it came from
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(person_id, address)
);
CREATE INDEX IF NOT EXISTS idx_emails_person ON emails(person_id);

CREATE TABLE IF NOT EXISTS drafts (
  id          TEXT PRIMARY KEY,
  person_id   TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  subject     TEXT NOT NULL DEFAULT '',
  body        TEXT NOT NULL DEFAULT '',
  model       TEXT,
  edited      INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_drafts_person ON drafts(person_id);

CREATE TABLE IF NOT EXISTS sends (
  id          TEXT PRIMARY KEY,
  draft_id    TEXT NOT NULL REFERENCES drafts(id) ON DELETE CASCADE,
  person_id   TEXT NOT NULL,
  to_address  TEXT NOT NULL,
  subject     TEXT NOT NULL,
  message_id  TEXT,
  status      TEXT NOT NULL,                 -- sent | error
  error       TEXT,
  -- Read receipts. track_token addresses the pixel and is unguessable, so the
  -- send id is never exposed in outgoing mail.
  track_token     TEXT,
  open_count      INTEGER NOT NULL DEFAULT 0,
  first_opened_at TEXT,
  last_opened_at  TEXT,
  sent_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_sends_day ON sends(sent_at);
CREATE INDEX IF NOT EXISTS idx_sends_person ON sends(person_id);
-- idx_sends_token lives in ADDED_INDEXES (lib/db/index.ts), not here: on a
-- database predating track_token this file runs before the ALTER that adds the
-- column, and indexing a missing column aborts the whole schema batch.

-- One row per pixel load. Kept separate from the counter on sends so a
-- reopened email shows a timeline rather than just a number.
CREATE TABLE IF NOT EXISTS email_opens (
  id         TEXT PRIMARY KEY,
  send_id    TEXT NOT NULL REFERENCES sends(id) ON DELETE CASCADE,
  opened_at  TEXT NOT NULL DEFAULT (datetime('now')),
  user_agent TEXT,
  -- Truncated /24 (or /48) prefix, never the full address: enough to tell a
  -- Gmail proxy prefetch from a real reader, not enough to locate anyone.
  ip_prefix  TEXT
);
CREATE INDEX IF NOT EXISTS idx_opens_send ON email_opens(send_id, opened_at);

-- Cache over every external call (OpenAlex, Serper, page fetches, LLM extraction).
CREATE TABLE IF NOT EXISTS cache (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,                 -- JSON
  fetched_at  INTEGER NOT NULL,              -- epoch ms
  ttl_ms      INTEGER NOT NULL
);

-- Learned per-domain email format, e.g. utoronto.ca -> "{first}.{last}".
CREATE TABLE IF NOT EXISTS domain_patterns (
  domain      TEXT PRIMARY KEY,
  pattern     TEXT NOT NULL,
  samples     INTEGER NOT NULL DEFAULT 1,
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Dashboard-editable config. Overrides env defaults.
CREATE TABLE IF NOT EXISTS app_settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Reusable email templates, picked from a dropdown while drafting. The text
-- carries {{placeholders}} (see lib/template-fill.ts) which are filled in for
-- whoever the card is about.
CREATE TABLE IF NOT EXISTS templates (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  subject     TEXT NOT NULL DEFAULT '',
  body        TEXT NOT NULL DEFAULT '',
  notes       TEXT NOT NULL DEFAULT '',      -- extra guidance for the writer model
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Google accounts that have granted gmail.send, keyed by the address mail is
-- sent from. refresh_token is AES-256-GCM ciphertext, never plaintext: a leaked
-- backup would otherwise let the reader send mail as the user indefinitely.
CREATE TABLE IF NOT EXISTS google_accounts (
  email         TEXT PRIMARY KEY,
  name          TEXT,
  picture       TEXT,
  refresh_token TEXT NOT NULL,
  scope         TEXT NOT NULL DEFAULT '',
  connected_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Queued / scheduled sends. A row here is a promise to send later.
CREATE TABLE IF NOT EXISTS outbox (
  id            TEXT PRIMARY KEY,
  person_id     TEXT,
  from_email    TEXT,                        -- google_accounts.email at queue time
  to_address    TEXT NOT NULL,
  subject       TEXT NOT NULL,
  body          TEXT NOT NULL,
  scheduled_at  TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending',
  attempts      INTEGER NOT NULL DEFAULT 0,
  error         TEXT,
  message_id    TEXT,
  sent_at       TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_outbox_due ON outbox(status, scheduled_at);
