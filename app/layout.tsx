import type { Metadata } from "next";
import Link from "next/link";
import NavLink from "./ui/nav-link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Email Agent",
  description: "Search for people, find their emails, draft cold outreach.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        <header className="sticky top-0 z-40 border-b border-[var(--color-line)] bg-[var(--color-paper)]/85 backdrop-blur-md">
          <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-3">
            <Link
              href="/"
              className="pressable pressable-subtle -mx-1 rounded-md px-1 text-[13px] font-semibold tracking-tight"
            >
              Email&nbsp;Agent
            </Link>
            <nav className="-mr-2 flex items-center gap-1">
              <NavLink href="/">Search</NavLink>
              <NavLink href="/settings">Settings</NavLink>
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-3xl px-6 py-10 pb-24">{children}</main>
      </body>
    </html>
  );
}
