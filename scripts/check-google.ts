import { encrypt, decrypt } from "../lib/crypto";
import { authUrl, redirectUri, SCOPES } from "../lib/google/oauth";
import { buildMime } from "../lib/send/gmail";

let fail = 0;
const check = (n: string, ok: boolean, extra = "") => {
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${n}${extra ? "  " + extra : ""}`);
  if (!ok) fail++;
};

async function main() {
  // Fixed values so the script is self-contained and does not depend on .env.
  process.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  process.env.GOOGLE_CLIENT_ID = "test-client-id";
  process.env.GOOGLE_CLIENT_SECRET = "test-secret";
  delete process.env.APP_URL;

  const token = "1//0gLONG-refresh-token_with.punctuation";
  const sealed = encrypt(token);
  check("ciphertext is not the plaintext", !sealed.includes(token));
  check("round-trips", decrypt(sealed) === token);
  check("versioned", sealed.startsWith("v1."));
  check("nonce differs per call", encrypt(token) !== encrypt(token));

  let tampered = false;
  try {
    const parts = sealed.split(".");
    parts[3] = Buffer.from("evil").toString("base64url");
    decrypt(parts.join("."));
  } catch {
    tampered = true;
  }
  check("tampering is rejected", tampered);

  const url = new URL(authUrl({ origin: "http://localhost:3000", state: "xyz" }));
  check("offline access requested", url.searchParams.get("access_type") === "offline");
  check("consent forced, so a refresh token comes back",
    url.searchParams.get("prompt") === "consent");
  check("state passed through", url.searchParams.get("state") === "xyz");
  check("asks for gmail.send",
    (url.searchParams.get("scope") ?? "").includes("gmail.send"));
  check("does not ask to read mail",
    !SCOPES.some((s) => /readonly|modify|mail\.google\.com/.test(s)));
  check("redirect matches the route path",
    redirectUri("http://localhost:3000") === "http://localhost:3000/api/google/callback");

  const plain = await buildMime({
    from: "me@example.com",
    to: "them@example.com",
    subject: "Hello",
    body: "Just a plain line.",
    fromName: "Me Myself",
  });
  const decoded = Buffer.from(plain, "base64url").toString("utf8");
  check("base64url, not standard base64", !/[+/=]/.test(plain));
  check("From carries the display name", /From: .*Me Myself.*me@example\.com/.test(decoded));
  check("To is set", /To: them@example\.com/.test(decoded));
  check("plain body stays single-part", !/multipart\/alternative/.test(decoded));

  const rich = await buildMime({
    from: "me@example.com",
    to: "them@example.com",
    subject: "Hello",
    body: "A line with **bold** in it.",
  });
  const richDecoded = Buffer.from(rich, "base64url").toString("utf8");
  check("formatted body gets an HTML alternative",
    /multipart\/alternative/.test(richDecoded));

  console.log(fail ? `\n${fail} FAILED` : "\nAll Google/send checks passed.");
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
