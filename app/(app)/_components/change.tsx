import type { Copy } from "@/lib/copy";
import { formatChange, formatPercent } from "@/lib/format";
import { Amount } from "./amount";

/**
 * A signed money change: arrow, amount, and the rate where there is one
 * (SPEC §10 — colour never carries the meaning alone, so the sign and the
 * arrow are always present). Overview's day and period change and the
 * Assets screen's unrealised column are the same figure in two places.
 *
 * `className` carries the caller's own layout; the direction class comes
 * from the figure itself.
 */
export function Change({
  delta,
  rate,
  currency,
  locale,
  copy,
  className,
}: {
  delta: string;
  rate: string | null;
  currency: string;
  locale: string;
  copy: Copy;
  className?: string;
}) {
  const money = formatChange(delta, currency, locale);
  const pct = rate === null ? null : formatPercent(rate, locale);
  const arrow = money.direction === "pos" ? "↑" : money.direction === "neg" ? "↓" : "→";
  return (
    <span className={`${className ? `${className} ` : ""}${money.direction}`}>
      <span aria-hidden="true">{arrow}</span> <Amount value={money.text} hiddenLabel={copy.nav.amountHidden} />
      {pct ? <span className="figure"> ({pct.text})</span> : null}
    </span>
  );
}
