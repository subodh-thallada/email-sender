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
