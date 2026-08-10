import { all, nowStamp, one, run } from "../db";
import { decrypt, encrypt, encryptionConfigured } from "../crypto";
import {
  accessToken,
  forgetAccessToken,
  oauthConfigured,
  revoke,
  type GrantedAccount,
} from "./oauth";

/**
 * The connected Gmail accounts, and the token plumbing on top of them.
 *
 * Rows are keyed by the address mail goes out as. Nothing here assumes a single
 * account — the send paths pass an explicit address — so the same store works
 * unchanged when the app grows past one user.
 */

export interface AccountRow {
  email: string;
  name: string | null;
  picture: string | null;
  refresh_token: string;
  scope: string;
  connected_at: string;
  updated_at: string;
}

export interface ConnectedAccount {
  email: string;
  name: string | null;
  picture: string | null;
  connectedAt: string;
}

function publicView(row: AccountRow): ConnectedAccount {
  return {
    email: row.email,
    name: row.name,
    picture: row.picture,
    connectedAt: row.connected_at,
  };
}

export async function saveAccount(granted: GrantedAccount): Promise<void> {
  const stamp = nowStamp();
  const secret = encrypt(granted.refreshToken);

  // Reconnecting the same address replaces the token rather than adding a row —
  // the old refresh token is dead the moment Google issues a new one. Written as
  // check-then-write instead of an upsert because the two dialects spell
  // ON CONFLICT ... DO UPDATE differently enough to not be worth abstracting.
  const existing = await one<{ email: string }>(
    "SELECT email FROM google_accounts WHERE email = ?",
    [granted.email],
  );

  if (existing) {
    await run(
      `UPDATE google_accounts
          SET name = ?, picture = ?, refresh_token = ?, scope = ?, updated_at = ?
        WHERE email = ?`,
      [
        granted.name,
        granted.picture,
        secret,
        granted.scope,
        stamp,
        granted.email,
      ],
    );
  } else {
    await run(
      `INSERT INTO google_accounts
         (email, name, picture, refresh_token, scope, connected_at, updated_at)
       VALUES (?,?,?,?,?,?,?)`,
      [
        granted.email,
        granted.name,
        granted.picture,
        secret,
        granted.scope,
        stamp,
        stamp,
      ],
    );
  }
  forgetAccessToken(granted.email);
}

export async function listAccounts(): Promise<ConnectedAccount[]> {
  const rows = await all<AccountRow>(
    "SELECT * FROM google_accounts ORDER BY connected_at",
  );
  return rows.map(publicView);
}

/** The account new mail is sent from. One connected account today; when there
 * are several, the oldest wins so the choice is stable across restarts. */
export async function defaultAccount(): Promise<ConnectedAccount | null> {
  const row = await one<AccountRow>(
    "SELECT * FROM google_accounts ORDER BY connected_at LIMIT 1",
  );
  return row ? publicView(row) : null;
}

export async function disconnect(email: string): Promise<void> {
  const row = await one<AccountRow>(
    "SELECT * FROM google_accounts WHERE email = ?",
    [email],
  );
  if (!row) return;
  try {
    await revoke(decrypt(row.refresh_token));
  } catch {
    // An undecryptable or already-revoked token still gets removed locally.
  }
  forgetAccessToken(email);
  await run("DELETE FROM google_accounts WHERE email = ?", [email]);
}

/** True when this deployment could send at all, ignoring whether anyone has
 * actually connected yet. */
export function sendingConfigured(): boolean {
  return oauthConfigured() && encryptionConfigured();
}

export class NotConnectedError extends Error {}

/** A fresh access token for `email`, refreshing through Google if needed. */
export async function tokenFor(email: string): Promise<string> {
  const row = await one<AccountRow>(
    "SELECT * FROM google_accounts WHERE email = ?",
    [email],
  );
  if (!row) {
    throw new NotConnectedError(
      `${email} is not connected. Connect it again in Settings.`,
    );
  }

  try {
    return await accessToken(email, decrypt(row.refresh_token));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // invalid_grant means the user revoked access, changed their password, or
    // the token aged out unused. Nothing here can recover it — drop the row so
    // the UI shows "not connected" instead of failing every send forever.
    if (/invalid_grant/i.test(message)) {
      await run("DELETE FROM google_accounts WHERE email = ?", [email]);
      forgetAccessToken(email);
      throw new NotConnectedError(
        `Google revoked access for ${email}. Reconnect it in Settings.`,
      );
    }
    throw err;
  }
}
