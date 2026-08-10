import { enqueue, flushDue, pending, cancel, toStamp } from "../lib/send/outbox";
import { all, run } from "../lib/db";

let fail = 0;
const check = (n: string, ok: boolean, extra = "") => {
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${n}${extra ? "  " + extra : ""}`);
  if (!ok) fail++;
};

async function main() {
  await run("DELETE FROM outbox WHERE to_address LIKE '%@outbox-test.invalid'");

  const past = new Date(Date.now() - 60_000);
  const future = new Date(Date.now() + 86_400_000);

  const dueId = await enqueue({ to: "due@outbox-test.invalid", from: "tester@outbox-test.invalid", subject: "s", body: "b", scheduledAt: past });
  const laterId = await enqueue({ to: "later@outbox-test.invalid", from: "tester@outbox-test.invalid", subject: "s", body: "b", scheduledAt: future });
  const cancelId = await enqueue({ to: "cancel@outbox-test.invalid", from: "tester@outbox-test.invalid", subject: "s", body: "b", scheduledAt: past });

  const q = await pending();
  check("three queued", q.filter(r => r.to_address.endsWith("outbox-test.invalid")).length === 3);

  await cancel(cancelId);
  const afterCancel = await all<{status:string}>("SELECT status FROM outbox WHERE id = ?", [cancelId]);
  check("cancel works", afterCancel[0]?.status === "canceled");

  // No Gmail account is connected in tests, so flushDue must leave the queue
  // intact rather than throw or burn the retry budget.
  const res = await flushDue();
  check("flush is safe with no account connected", res.sent === 0, JSON.stringify(res));
  const attempts = await all<{attempts:number}>("SELECT attempts FROM outbox WHERE id = ?", [dueId]);
  check("a missing grant does not count as an attempt", Number(attempts[0]?.attempts ?? -1) === 0);

  const stillPending = await all<{id:string}>(
    "SELECT id FROM outbox WHERE status = 'pending' AND to_address LIKE '%@outbox-test.invalid'");
  check("future item still pending", stillPending.some(r => r.id === laterId));
  check("due item not lost", stillPending.some(r => r.id === dueId));

  check("stamp format is UTC 'YYYY-MM-DD HH:MM:SS'",
    /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(toStamp(new Date())), toStamp(new Date()));

  await run("DELETE FROM outbox WHERE to_address LIKE '%@outbox-test.invalid'");
  console.log(fail ? `\n${fail} FAILED` : "\nAll outbox checks passed.");
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
