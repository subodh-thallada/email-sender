-- Postgres / Supabase schema. Mirrors schema.sql exactly in column names and
-- types so the same queries run against both. Timestamps stay TEXT so the
-- driver returns strings, not Date objects.

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
  updated_at     TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD HH24:MI:SS'))
);

CREATE TABLE IF NOT EXISTS searches (
  id          TEXT PRIMARY KEY,
  query       TEXT NOT NULL,
  intent      TEXT,                          -- JSON: parsed ParsedQuery
  route       TEXT,                          -- academic | corporate | alumni
  status      TEXT NOT NULL DEFAULT 'running', -- running | done | error
  error       TEXT,
  created_at  TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD HH24:MI:SS'))
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
  score        DOUBLE PRECISION NOT NULL DEFAULT 0,      -- rerank relevance 0..1
  rank         INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD HH24:MI:SS'))
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
  created_at  TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD HH24:MI:SS')),
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
  created_at  TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD HH24:MI:SS')),
  updated_at  TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD HH24:MI:SS'))
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
  sent_at     TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD HH24:MI:SS'))
);
CREATE INDEX IF NOT EXISTS idx_sends_day ON sends(sent_at);

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
  updated_at  TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD HH24:MI:SS'))
);

-- Dashboard-editable config. Overrides env defaults.
CREATE TABLE IF NOT EXISTS app_settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_at  TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD HH24:MI:SS'))
);

-- Queued / scheduled sends. A row here is a promise to send later.
CREATE TABLE IF NOT EXISTS outbox (
  id            TEXT PRIMARY KEY,
  person_id     TEXT,
  to_address    TEXT NOT NULL,
  subject       TEXT NOT NULL,
  body          TEXT NOT NULL,
  scheduled_at  TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending',
  attempts      INTEGER NOT NULL DEFAULT 0,
  error         TEXT,
  message_id    TEXT,
  sent_at       TEXT,
  created_at    TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD HH24:MI:SS'))
);
CREATE INDEX IF NOT EXISTS idx_outbox_due ON outbox(status, scheduled_at);
