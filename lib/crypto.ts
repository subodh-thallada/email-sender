import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  createHash,
} from "node:crypto";

/**
 * AES-256-GCM for secrets that have to live in the database.
 *
 * A Google refresh token does not expire on its own — whoever holds it can send
 * mail as the user until the grant is revoked by hand. That is a much worse
 * thing to leak than a session cookie, so it never touches the DB in plaintext.
 *
 * Format: v1.<iv>.<authTag>.<ciphertext>, all base64url. The version prefix
 * leaves room to rotate the scheme later without guessing at old rows.
 */

const PREFIX = "v1";

export function encryptionConfigured(): boolean {
  return Boolean(process.env.TOKEN_ENCRYPTION_KEY);
}

/**
 * Accepts either 32 raw bytes as base64/hex, or any passphrase (hashed to 32
 * bytes). Hashing means a short passphrase still produces a valid key rather
 * than throwing at send time, which would be a confusing place to discover it.
 */
function key(): Buffer {
  const raw = process.env.TOKEN_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "TOKEN_ENCRYPTION_KEY is not set. Generate one with:\n" +
        '  node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"',
    );
  }
  for (const enc of ["base64", "hex"] as const) {
    const buf = Buffer.from(raw, enc);
    if (buf.length === 32) return buf;
  }
  return createHash("sha256").update(raw).digest();
}

export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [
    PREFIX,
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    body.toString("base64url"),
  ].join(".");
}

export function decrypt(payload: string): string {
  const [version, iv, tag, body] = payload.split(".");
  if (version !== PREFIX || !iv || !tag || !body) {
    throw new Error("Stored token is not in the expected encrypted format.");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key(),
    Buffer.from(iv, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(body, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}
