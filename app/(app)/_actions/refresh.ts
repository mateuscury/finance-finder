"use server";

import { after } from "next/server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { priceThenSnapshot } from "@/lib/jobs";
import {
  isRefreshing,
  NUDGE_COOKIE,
  PREFERENCE_COOKIE_OPTIONS,
  REFRESHING_COOKIE,
  REFRESHING_WINDOW_MS,
} from "@/lib/settings/preferences";

/**
 * Refresh (SPEC §9.4): the strip's one control. Re-runs the scoped fetch
 * for everything unpriced, then snapshots — after the response, under the
 * cron's budget. It reuses the cron code paths; it is not a third cron.
 * Returns to the page it was pressed on.
 */
export async function refreshAction(formData: FormData): Promise<void> {
  const started = Date.now();
  const { identity } = await requireUser();
  const spent = Date.now() - started;
  const jar = await cookies();
  // Debounced on the server (decision 62): while a run this control started is
  // still inside its window, schedule nothing — ten impatient clicks are one
  // run. The cookie existed from P2-U4 but only the strip read it, so every
  // click queued another job chain. There is deliberately no lease: a lease
  // row would be new user data, an advisory lock cannot span PostgREST's
  // per-request transactions, and a lease outliving a crashed run would block
  // the nightly cron. Overlapping runs stay safe because every write is an
  // idempotent upsert keyed by date.
  if (!isRefreshing(jar.get(REFRESHING_COOKIE)?.value, Date.now())) {
    after(() => priceThenSnapshot({ kind: "unpriced" }, [identity.userId], spent));
    // The strip shows "fetching in the background" while this is fresh; a
    // cookie rather than a query string, because the redirected render happens
    // inside this request and a template cannot see the new URL.
    jar.set(REFRESHING_COOKIE, String(Date.now()), {
      ...PREFERENCE_COOKIE_OPTIONS,
      maxAge: Math.ceil(REFRESHING_WINDOW_MS / 1000),
    });
  }
  redirect(safePath(formData.get("return_to")));
}

/**
 * Dismisses the backup nudge for its current occurrence (SPEC §12.3:
 * "dismissable per occurrence, never permanently"): the cookie remembers
 * WHICH last-export state was dismissed, so a new export — or the first
 * one — changes the value and the nudge returns only when it is due again.
 */
export async function dismissNudgeAction(formData: FormData): Promise<void> {
  await requireUser();
  const jar = await cookies();
  jar.set(NUDGE_COOKIE, String(formData.get("occurrence") ?? "none"), PREFERENCE_COOKIE_OPTIONS);
  redirect(safePath(formData.get("return_to")));
}

/** A same-origin path from a form value, else the Overview. */
function safePath(value: FormDataEntryValue | null): string {
  const back = String(value ?? "/");
  return back.startsWith("/") && !back.startsWith("//") ? back : "/";
}
