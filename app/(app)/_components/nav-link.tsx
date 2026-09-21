"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * A nav link that knows whether it is the current route. Client-side on
 * purpose: the layout that renders the nav persists across navigations, so
 * a server-computed aria-current would go stale after the first click.
 */
export function NavLink({
  href,
  className,
  children,
}: {
  href: string;
  className?: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const current = href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
  return (
    <Link href={href} aria-current={current ? "page" : undefined} className={className}>
      {children}
    </Link>
  );
}

/** The current path as a hidden field, so a strip action can return to the page it was pressed on. */
export function ReturnTo({ name = "return_to" }: { name?: string }) {
  const pathname = usePathname();
  return <input type="hidden" name={name} value={pathname} />;
}
