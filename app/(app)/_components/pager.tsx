import Link from "next/link";
import type { Copy } from "@/lib/copy";
import { LIST_PAGE_SIZE } from "@/lib/ledger/queries";

/** A 1-based page number from a `?page=` value; anything else is page 1. */
export function pageNumber(param: string | string[] | undefined): number {
  const n = typeof param === "string" ? parseInt(param, 10) : NaN;
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

export function Pager({ href, page, total, copy }: { href: string; page: number; total: number; copy: Copy }) {
  const pages = Math.max(1, Math.ceil(total / LIST_PAGE_SIZE));
  if (pages <= 1) return null;
  return (
    <nav className="pager" aria-label={copy.screens.pager.label}>
      {page > 1 ? <Link href={`${href}?page=${page - 1}`}>{copy.screens.pager.previous}</Link> : null}
      <span>{copy.screens.pager.of({ page, pages, total })}</span>
      {page < pages ? <Link href={`${href}?page=${page + 1}`}>{copy.screens.pager.next}</Link> : null}
    </nav>
  );
}
