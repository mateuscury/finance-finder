import Link from "next/link";
import { signOut } from "@/app/login/actions";
import { requireUser } from "@/lib/auth/session";

/**
 * Every data page lives under this group. The layout verifies the session
 * for the nav; each page calls `requireUser()` again itself (cached per
 * request), because layouts do not re-run on every navigation.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { identity } = await requireUser();
  return (
    <>
      <header>
        <nav aria-label="Ledger">
          <Link href="/">Overview</Link> · <Link href="/assets">Assets</Link> · <Link href="/transactions">Transactions</Link> · <Link href="/cash-flows">Cash flows</Link> ·{" "}
          <Link href="/settings">Settings</Link>
        </nav>
        <form action={signOut}>
          <span>{identity.email ?? identity.userId}</span> <button type="submit">Sign out</button>
        </form>
      </header>
      {children}
    </>
  );
}
