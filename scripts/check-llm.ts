import { configuredProviders, defaultModel } from "../lib/ai/models";
import { resolveTask, getSettings } from "../lib/settings";
import { parseQuery } from "../lib/ai/parse-query";
import { streamMessages } from "../lib/ai/provider";

async function drain(s: ReadableStream<Uint8Array>) {
  const r = s.getReader(); const d = new TextDecoder(); let out = "";
  for (;;) { const { done, value } = await r.read(); if (done) break; out += d.decode(value, { stream: true }); }
  return out;
}

async function main() {
  console.log("providers:", configuredProviders().join(", ") || "(none)");
  for (const t of ["parse", "write", "chat"] as const) {
    const r = await resolveTask(t);
    console.log(`  ${t.padEnd(6)} ${r.provider}/${r.model}`);
  }

  console.log("\n1. Structured output (parse)");
  const t0 = Date.now();
  const intent = await parseQuery("professors at University of Toronto who do robotics research");
  console.log(`   ${Date.now() - t0}ms  route=${intent.route}`);
  console.log(`   institutions: ${JSON.stringify(intent.institutions)}`);
  console.log(`   topics:       ${JSON.stringify(intent.topics)}`);
  console.log(`   limit:        ${intent.limit}`);
  const ok = intent.route === "academic"
    && intent.institutions.some(i => /toronto/i.test(i))
    && intent.topics.some(t => /robot/i.test(t));
  console.log(`   ${ok ? "ok  " : "FAIL"} parsed correctly`);

  console.log("\n2. Streaming (chat)");
  const t1 = Date.now();
  const text = await drain(streamMessages("chat", [
    { role: "system", content: "Reply with exactly the word: PONG" },
    { role: "user", content: "ping" },
  ], 200));
  console.log(`   ${Date.now() - t1}ms  -> ${JSON.stringify(text.trim().slice(0, 80))}`);
  console.log(`   ${/pong/i.test(text) ? "ok  " : "FAIL"} stream returned content`);
  process.exit(ok && /pong/i.test(text) ? 0 : 1);
}
main().catch((e) => { console.error("ERROR:", e.message ?? e); process.exit(1); });
