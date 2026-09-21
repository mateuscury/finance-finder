import type { Copy } from "@/lib/copy";

export type ValueStatusKind = "ok" | "carried_forward" | "stale" | "unpriced" | "accrues";

/**
 * The staleness mark of SPEC §11 on every screen (plan "Staleness is shown,
 * never hidden"): carried forward with its date, stale with its last-known
 * date and excluded from totals, unpriced with its reason. Never a zero.
 */
export function ValueStatus({
  copy,
  status,
  date,
  reason,
}: {
  copy: Copy;
  status: ValueStatusKind;
  date?: string | null;
  reason?: string | null;
}) {
  if (status === "ok") return null;
  const text =
    status === "carried_forward"
      ? copy.status.carriedForward({ date: date ?? "?" })
      : status === "stale"
        ? copy.status.stale({ date: date ?? "?" })
        : status === "accrues"
          ? copy.status.accrues
          : reason
            ? copy.status.unpricedReason({ reason })
            : copy.status.unpriced;
  const mark = status === "carried_forward" ? "↻" : status === "stale" ? "⚠" : status === "accrues" ? "∼" : "—";
  return (
    <span className={`value-status value-status-${status} muted`} title={text} aria-label={text}>
      <span aria-hidden="true">{mark}</span> <small>{text}</small>
    </span>
  );
}
