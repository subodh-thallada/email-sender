import { createClient, type Client, type InValue } from "@libsql/client";
import postgres from "postgres";
import { readFile, mkdir } from "node:fs/promises";
import path from "node:path";

/**
 * Two backends behind one interface.
 *
 *   file:./data/app.db          -> libsql (local dev)
 *   postgres://... (Supabase)   -> postgres.js
 *
 * Vercel's filesystem is ephemeral and read-only, so a file: URL cannot be used
 * once deployed — Postgres is required there, not optional.
 *
 * Queries are written once in SQLite style with `?` placeholders. The Postgres
 * path rewrites placeholders to $1..$n and `INSERT OR IGNORE` to
 * `ON CONFLICT DO NOTHING`. Everything else is kept dialect-neutral on purpose:
 * timestamps are passed in from JS rather than using datetime('now'), and date
 * comparisons use substr(), which both engines support.
 */

export type Dialect = "sqlite" | "postgres";

const url = () => process.env.DATABASE_URL ?? "file:./data/app.db";

export function dialect(): Dialect {
  return /^postgres(ql)?:\/\//.test(url()) ? "postgres" : "sqlite";
}

/** ISO-ish UTC timestamp matching the schema's TEXT columns. */
export function nowStamp(): string {
  return new Date().toISOString().slice(0, 19).replace("T", " ");
}

export function todayStamp(): string {
  return new Date().toISOString().slice(0, 10);
}

type Sqlite = { kind: "sqlite"; client: Client };
type Postgres = { kind: "postgres"; sql: postgres.Sql };
type Conn = Sqlite | Postgres;

let connPromise: Promise<Conn> | null = null;

function toPg(sql: string): string {
  let out = sql.replace(
    /INSERT\s+OR\s+IGNORE\s+INTO/gi,
    "INSERT INTO",
  );
  const hadIgnore = out !== sql;

  let i = 0;
  out = out.replace(/\?/g, () => `$${++i}`);

  if (hadIgnore && !/ON CONFLICT/i.test(out)) {
    out = out.trimEnd().replace(/;?$/, " ON CONFLICT DO NOTHING");
  }
  return out;
}

/**
 * Columns added after the first release. `CREATE TABLE IF NOT EXISTS` is a
 * no-op on a database that already has the table, so every later column has to
 * arrive as its own ALTER — listed here rather than scattered through init()
 * so the set is auditable in one place.
 *
 * Each entry must be idempotent in effect: Postgres gets IF NOT EXISTS, and
 * the SQLite path swallows the duplicate-column error.
 */
const ADDED_COLUMNS: [table: string, column: string, type: string][] = [
  ["outbox", "from_email", "TEXT"],
  ["profile", "offer", "TEXT NOT NULL DEFAULT ''"],
  ["profile", "audience", "TEXT NOT NULL DEFAULT ''"],
  ["profile", "links", "TEXT NOT NULL DEFAULT ''"],
  ["profile", "instructions", "TEXT NOT NULL DEFAULT ''"],
  ["sends", "track_token", "TEXT"],
  ["sends", "open_count", "INTEGER NOT NULL DEFAULT 0"],
  ["sends", "first_opened_at", "TEXT"],
  ["sends", "last_opened_at", "TEXT"],
];

/**
 * Indexes over columns from ADDED_COLUMNS. They cannot live in the schema
 * files: those run first, and on an older database the column they index does
 * not exist yet — which aborts the entire schema batch under libsql.
 */
const ADDED_INDEXES: string[] = [
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_sends_token ON sends(track_token)",
];

async function init(): Promise<Conn> {
  const target = url();

  if (/^postgres(ql)?:\/\//.test(target)) {
    const sql = postgres(target, {
      // Supabase requires TLS; its certs are not in Node's default store.
      ssl: target.includes("localhost") ? false : { rejectUnauthorized: false },
      max: 5,
      prepare: false, // Supabase's transaction pooler does not support it.
    });
    const schema = await readFile(
      path.join(process.cwd(), "lib", "db", "schema.postgres.sql"),
      "utf8",
    );
    await sql.unsafe(schema);
    for (const [table, column, type] of ADDED_COLUMNS) {
      await sql.unsafe(
        `ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${column} ${type}`,
      );
    }
    for (const stmt of ADDED_INDEXES) await sql.unsafe(stmt);
    await sql.unsafe(
      "INSERT INTO profile (id) VALUES (1) ON CONFLICT DO NOTHING",
    );
    return { kind: "postgres", sql };
  }

  const filePath = target.slice("file:".length);
  await mkdir(path.dirname(path.resolve(filePath)), { recursive: true });

  const client = createClient({
    url: target,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });
  const schema = await readFile(
    path.join(process.cwd(), "lib", "db", "schema.sql"),
    "utf8",
  );
  await client.executeMultiple(schema);
  // SQLite has no ADD COLUMN IF NOT EXISTS, and executeMultiple aborts the
  // whole batch on error, so run each alone and swallow the duplicate-column
  // case. Anything else is a real failure and is left to surface on first query.
  for (const [table, column, type] of ADDED_COLUMNS) {
    try {
      await client.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
    } catch {
      // Already there.
    }
  }
  for (const stmt of ADDED_INDEXES) await client.execute(stmt);
  await client.execute("INSERT OR IGNORE INTO profile (id) VALUES (1)");
  return { kind: "sqlite", client };
}

function conn(): Promise<Conn> {
  connPromise ??= init();
  return connPromise;
}

export async function all<T = Record<string, unknown>>(
  sql: string,
  args: InValue[] = [],
): Promise<T[]> {
  const c = await conn();
  if (c.kind === "postgres") {
    const rows = await c.sql.unsafe(toPg(sql), args as never[]);
    return rows as unknown as T[];
  }
  const rs = await c.client.execute({ sql, args });
  return rs.rows as unknown as T[];
}

export async function one<T = Record<string, unknown>>(
  sql: string,
  args: InValue[] = [],
): Promise<T | undefined> {
  return (await all<T>(sql, args))[0];
}

export async function run(sql: string, args: InValue[] = []): Promise<void> {
  await all(sql, args);
}

export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
}
