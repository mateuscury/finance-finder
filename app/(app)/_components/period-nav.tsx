import Link from "next/link";
import type { Copy } from "@/lib/copy";
import { PERIOD_KEYS, type PeriodKey } from "@/app/(app)/_models/period";
import styles from "./period-nav.module.css";

/**
 * The period selector every analysis screen shares (SPEC §9 screen 2):
 * links that rewrite the query — no client state, works without JavaScript.
 * `query` carries the other parameters (benchmarks, real) across a change.
 */
export function PeriodNav({
  copy,
  current,
  base,
  query,
}: {
  copy: Copy;
  current: PeriodKey;
  base: string;
  query: Record<string, string | undefined>;
}) {
  const href = (key: PeriodKey) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) if (v) params.set(k, v);
    params.set("period", key);
    return `${base}?${params.toString()}`;
  };
  return (
    <nav aria-label={copy.screens.performance.period} className={styles.nav}>
      {PERIOD_KEYS.map((key) => (
        <Link key={key} href={href(key)} aria-current={key === current ? "page" : undefined} className={styles.link}>
          {copy.screens.performance.periods[key]}
        </Link>
      ))}
    </nav>
  );
}

/** The same shape for a set of toggles (benchmarks, nominal/real). */
export function ToggleNav({
  label,
  items,
}: {
  label: string;
  items: Array<{ key: string; label: string; href: string; on: boolean }>;
}) {
  return (
    <nav aria-label={label} className={styles.nav}>
      <span className={styles.label}>{label}</span>
      {items.map((it) => (
        <Link key={it.key} href={it.href} aria-pressed={it.on} className={`${styles.link} ${it.on ? styles.on : ""}`}>
          {it.label}
        </Link>
      ))}
    </nav>
  );
}
