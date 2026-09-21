import { cookies } from "next/headers";
import { requireUser } from "@/lib/auth/session";
import { currentCopy } from "@/lib/copy/server";
import { parseTheme, THEME_COOKIE } from "@/lib/settings/preferences";
import { Nav } from "./_components/nav";

/**
 * Every data page lives under this group. The layout verifies the session
 * for the nav; each page calls `requireUser()` again itself (cached per
 * request), because layouts do not re-run on every navigation. The shell
 * is SPEC §9.2: nav and hairline here; the status strip is in template.tsx,
 * which re-renders on every navigation so its counts are never stale.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  await requireUser();
  const [copy, jar] = await Promise.all([currentCopy(), cookies()]);
  const theme = parseTheme(jar.get(THEME_COOKIE)?.value);
  return (
    <>
      <a href="#main" className="skip-link">
        {copy.nav.skipToContent}
      </a>
      <Nav copy={copy} theme={theme} />
      <div id="main">{children}</div>
    </>
  );
}
