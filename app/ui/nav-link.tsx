"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export default function NavLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const active = href === "/" ? pathname === "/" : pathname.startsWith(href);

  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      data-active={active}
      className="pressable pressable-subtle rounded-md px-2 py-1 text-[13px] text-[var(--color-muted)] hover:text-[var(--color-ink)] data-[active=true]:text-[var(--color-ink)]"
    >
      {children}
    </Link>
  );
}
