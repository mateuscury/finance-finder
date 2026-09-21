import { cookies, headers } from "next/headers";
import { requireUser } from "@/lib/auth/session";
import { currentCopy } from "@/lib/copy/server";
import { parseTheme, THEME_COOKIE } from "@/lib/settings/preferences";
import { Nav } from "./_components/nav";

/**
 * Every data page lives under this group. The layout verifies the session
 * for the nav; each page calls `requireUser()` again itself (cached per
 * request), because layouts do not re-run on every navigation. The shell
 * is SPEC §9.2: nav, hairline, the status strip (Phase 2 U4), then <main>.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  await requireUser();
  const [copy, jar, requestHeaders] = await Promise.all([currentCopy(), cookies(), headers()]);
  const theme = parseTheme(jar.get(THEME_COOKIE)?.value);
  // The current path for aria-current; the proxy forwards it on every request.
  const current = requestHeaders.get("x-pathname") ?? "/";
  return (
    <>
      <a href="#main" className="skip-link">
        {copy.nav.skipToContent}
      </a>
      <Nav copy={copy} theme={theme} current={current} />
      <div id="main">{children}</div>
    </>
  );
}
