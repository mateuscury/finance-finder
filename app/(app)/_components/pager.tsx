import Link from "next/link";
import { LIST_PAGE_SIZE } from "@/lib/ledger/queries";

/** A 1-based page number from a `?page=` value; anything else is page 1. */
export function pageNumber(param: string | string[] | undefined): number {
  const n = typeof param === "string" ? parseInt(param, 10) : NaN;
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

export function Pager({ href, page, total }: { href: string; page: number; total: number }) {
  const pages = Math.max(1, Math.ceil(total / LIST_PAGE_SIZE));
  return (
    <p>
      Page {page} of {pages} ({total} rows). {page > 1 ? <Link href={`${href}?page=${page - 1}`}>Previous</Link> : null}{" "}
      {page < pages ? <Link href={`${href}?page=${page + 1}`}>Next</Link> : null}
    </p>
  );
}
