import { createClient, type Client, type InValue } from "@libsql/client";
import { readFile, mkdir } from "node:fs/promises";
import path from "node:path";

let clientPromise: Promise<Client> | null = null;

async function init(): Promise<Client> {
  const url = process.env.DATABASE_URL ?? "file:./data/app.db";

  // libsql won't create the directory for a file: URL — do it ourselves.
  if (url.startsWith("file:")) {
    const filePath = url.slice("file:".length);
    await mkdir(path.dirname(path.resolve(filePath)), { recursive: true });
  }

  const client = createClient({
    url,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });

  const schema = await readFile(
    path.join(process.cwd(), "lib", "db", "schema.sql"),
    "utf8",
  );
  // executeMultiple runs the whole schema in one round trip.
  await client.executeMultiple(schema);
  await client.execute(
    "INSERT OR IGNORE INTO profile (id) VALUES (1)",
  );

  return client;
}

export function db(): Promise<Client> {
  clientPromise ??= init();
  return clientPromise;
}

/** Query helper returning typed rows. */
export async function all<T = Record<string, unknown>>(
  sql: string,
  args: InValue[] = [],
): Promise<T[]> {
  const client = await db();
  const rs = await client.execute({ sql, args });
  return rs.rows as unknown as T[];
}

export async function one<T = Record<string, unknown>>(
  sql: string,
  args: InValue[] = [],
): Promise<T | undefined> {
  const rows = await all<T>(sql, args);
  return rows[0];
}

export async function run(sql: string, args: InValue[] = []): Promise<void> {
  const client = await db();
  await client.execute({ sql, args });
}

export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
}
