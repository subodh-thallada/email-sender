import { listAccounts } from "@/lib/google/accounts";
import { backfillThreads, listLabels, listThreads } from "@/lib/threads/store";
import Dashboard from "./dashboard";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Outreach · Email Agent",
};

export default async function DashboardPage() {
  // Cheap and idempotent once caught up. Running it here rather than in a
  // migration script means mail sent before this page existed shows up the
  // first time anyone opens it, with no separate step to remember.
  await backfillThreads();

  const [threads, labels, accounts] = await Promise.all([
    listThreads(),
    listLabels(),
    listAccounts(),
  ]);

  return (
    <Dashboard
      threads={threads}
      labels={labels}
      canReadMail={accounts.some((a) => a.canRead)}
      hasAccount={accounts.length > 0}
    />
  );
}
