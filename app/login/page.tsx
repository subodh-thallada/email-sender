import { authConfigured } from "@/lib/auth";
import GoogleButton from "./google-button";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; denied?: string; error?: string }>;
}) {
  const { next, denied, error } = await searchParams;
  const configured = authConfigured();

  return (
    <div className="mx-auto max-w-sm space-y-6 py-16">
      <div className="enter text-center">
        <h1 className="text-[22px] font-semibold tracking-tight">Sign in</h1>
        <p className="mt-1.5 text-[13px] text-[var(--color-muted)]">
          This app spends API credits and sends mail from your Gmail, so it is
          not open to the public.
        </p>
      </div>

      {denied && (
        <p className="enter rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-900">
          That Google account is not on the allowlist. Add it to{" "}
          <code>ALLOWED_EMAILS</code>, or sign in with a different account.
        </p>
      )}

      {error && (
        <p className="enter rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-800">
          {error}
        </p>
      )}

      {configured ? (
        <GoogleButton next={next ?? "/"} />
      ) : (
        <div className="enter rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-4 text-[12px] leading-relaxed text-[var(--color-muted)]">
          <p className="font-medium text-[var(--color-ink)]">Auth not configured</p>
          <p className="mt-1.5">
            Create a Supabase project, enable the Google provider under
            Authentication &rarr; Providers, then set:
          </p>
          <pre className="mt-2 overflow-x-auto rounded bg-[var(--color-paper)] p-2 text-[11px]">
{`NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
ALLOWED_EMAILS=you@gmail.com`}
          </pre>
          <p className="mt-2">
            Add <code>{"<your-domain>/auth/callback"}</code> to Supabase&apos;s
            redirect allowlist. Local development runs without login.
          </p>
        </div>
      )}
    </div>
  );
}
