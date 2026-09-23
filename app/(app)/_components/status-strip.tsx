import Link from "next/link";
import { cookies } from "next/headers";
import { PACKS } from "@/packs";
import { nowMs, todayIso } from "@/lib/clock";
import { requireUser } from "@/lib/auth/session";
import type { Copy, ReasonCode } from "@/lib/copy";
import { formatDate } from "@/lib/format";
import { readStatus } from "@/lib/ledger/status";
import { dismissNudgeAction, refreshAction } from "@/app/(app)/_actions/refresh";
import { isRefreshing, NUDGE_COOKIE } from "@/lib/settings/preferences";
import { ReturnTo } from "./nav-link";
import styles from "./status-strip.module.css";

/**
 * SPEC §9.2: one line under the nav, present only when something is
 * pending; each item links to the screen that resolves it; it carries a
 * single Refresh control and nothing else. `aria-live` so a screen reader
 * hears a change without a page announcement.
 */
export async function StatusStrip({
  copy,
  locale,
  refreshingSince,
}: {
  copy: Copy;
  locale: string;
  refreshingSince: string | undefined;
}) {
  const { client } = await requireUser();
  // The clock is read once, with the data: the strip is about "now".
  const now = nowMs();
  const today = todayIso(now);
  const refreshing = isRefreshing(refreshingSince, now);
  const [status, jar] = await Promise.all([readStatus(client, PACKS, process.env, today), cookies()]);
  const occurrence = status.exportNudge ? (status.exportNudge.lastExportAt ?? "none") : null;
  const nudgeDismissed = occurrence !== null && jar.get(NUDGE_COOKIE)?.value === occurrence;
  const showNudge = status.exportNudge !== null && !nudgeDismissed;

  const items: Array<{ key: string; text: string; href: string }> = [];
  if (status.unpricedAssets > 0)
    items.push({ key: "unpriced", text: copy.strip.unpriced({ n: status.unpricedAssets }), href: "/assets" });
  if (status.rebuild) {
    const r = status.rebuild;
    // A gap that is still closing is a rebuild; one nothing has written into
    // for two trading days is a stall, and says so (decision 63).
    items.push(
      r.stalled
        ? {
            key: "rebuild",
            text: copy.strip.rebuildStopped({
              through: r.through ? formatDate(r.through, locale) : null,
              lastRun: formatDate(r.target, locale),
            }),
            href: "/settings#instance",
          }
        : {
            key: "rebuild",
            text: copy.strip.rebuilding({
              from: formatDate(r.from, locale),
              through: r.through ? formatDate(r.through, locale) : null,
              target: formatDate(r.target, locale),
            }),
            href: "/",
          },
    );
  }
  if (status.ingestStale) {
    items.push({
      key: "ingest-stale",
      text: copy.strip.ingestStale({
        lastRun: status.ingestStale.lastRunAt ? formatDate(status.ingestStale.lastRunAt.slice(0, 10), locale) : null,
      }),
      href: "/settings#instance",
    });
  }
  for (const f of status.failingSources)
    items.push({
      key: `failing-${f.sourceId}`,
      text: copy.strip.sourceFailing({
        sourceId: f.sourceId,
        reason: copy.status.reasons[f.code as ReasonCode] ?? f.code,
      }),
      href: "/settings#instance",
    });
  for (const s of status.disabledSources)
    items.push({ key: `source-${s.sourceId}`, text: copy.strip.sourceDisabled(s), href: "/settings" });
  if (showNudge && status.exportNudge)
    items.push({ key: "export", text: copy.strip.exportNudge(status.exportNudge), href: "/settings" });

  if (items.length === 0 && !refreshing) return null;
  return (
    <div className={styles.strip} role="status" aria-live="polite" aria-label={copy.strip.label}>
      <ul className={styles.items}>
        {items.map((item) => (
          <li key={item.key}>
            <Link href={item.href}>{item.text}</Link>
            {item.key === "export" && occurrence !== null ? (
              <form action={dismissNudgeAction} className={styles.inline}>
                <input type="hidden" name="occurrence" value={occurrence} />
                <ReturnTo />
                <button type="submit" className="quiet">
                  {copy.strip.dismiss}
                </button>
              </form>
            ) : null}
          </li>
        ))}
        {refreshing ? <li className="muted">{copy.strip.refreshing}</li> : null}
      </ul>
      <form action={refreshAction} className={styles.inline}>
        <ReturnTo />
        <button type="submit" className="quiet">
          {copy.strip.refresh}
        </button>
      </form>
    </div>
  );
}
