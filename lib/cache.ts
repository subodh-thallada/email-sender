import { createHash } from "node:crypto";
import { one, run } from "./db";

export const DAY = 86_400_000;

function hash(key: string): string {
  return createHash("sha256").update(key).digest("hex").slice(0, 40);
}

export async function cacheGet<T>(key: string): Promise<T | undefined> {
  const row = await one<{ value: string; fetched_at: number; ttl_ms: number }>(
    "SELECT value, fetched_at, ttl_ms FROM cache WHERE key = ?",
    [hash(key)],
  );
  if (!row) return undefined;
  if (Date.now() - Number(row.fetched_at) > Number(row.ttl_ms)) return undefined;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return undefined;
  }
}

export async function cacheSet(
  key: string,
  value: unknown,
  ttlMs: number,
): Promise<void> {
  await run(
    `INSERT INTO cache (key, value, fetched_at, ttl_ms) VALUES (?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value,
       fetched_at = excluded.fetched_at, ttl_ms = excluded.ttl_ms`,
    [hash(key), JSON.stringify(value), Date.now(), ttlMs],
  );
}

/**
 * Cache-through wrapper. Every external call goes through this so a repeat
 * search costs nothing.
 */
export async function cached<T>(
  key: string,
  ttlMs: number,
  fn: () => Promise<T>,
): Promise<T> {
  const hit = await cacheGet<T>(key);
  if (hit !== undefined) return hit;
  const value = await fn();
  await cacheSet(key, value, ttlMs);
  return value;
}
