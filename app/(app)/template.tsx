import { cookies } from "next/headers";
import { currentCopy } from "@/lib/copy/server";
import { LOCALE_COOKIE, parseLocale, REFRESHING_COOKIE } from "@/lib/settings/preferences";
import { StatusStrip } from "./_components/status-strip";

/**
 * A template re-renders on every navigation, unlike the layout, which is
 * what the status strip needs: its items are live counts, and the
 * "fetching in the background" line follows a Refresh press.
 */
export default async function AppTemplate({ children }: { children: React.ReactNode }) {
  const [copy, jar] = await Promise.all([currentCopy(), cookies()]);
  const locale = parseLocale(jar.get(LOCALE_COOKIE)?.value);
  const refreshingSince = jar.get(REFRESHING_COOKIE)?.value;
  return (
    <>
      <StatusStrip copy={copy} locale={locale} refreshingSince={refreshingSince} />
      {children}
    </>
  );
}
