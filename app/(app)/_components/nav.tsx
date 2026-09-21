import Link from "next/link";
import type { Copy } from "@/lib/copy";
import type { Theme } from "@/lib/settings/preferences";
import { signOut } from "@/app/login/actions";
import { setThemeAction } from "@/app/(app)/_actions/preferences";
import { PrivacyToggle } from "./privacy-toggle";
import styles from "./nav.module.css";

/**
 * SPEC §9.2: two groups, always fully visible — a screen with no data yet
 * still teaches what the product does — a hairline beneath, and a menu on
 * narrow viewports. The menu is a <details> so it works without JavaScript;
 * the theme control is a form so it works the same way.
 */
export function Nav({ copy, theme, current }: { copy: Copy; theme: Theme; current: string }) {
  const groups = [
    {
      label: copy.nav.analysis,
      items: [
        ["/", copy.nav.overview],
        ["/performance", copy.nav.performance],
        ["/allocation", copy.nav.allocation],
        ["/contribution", copy.nav.contribution],
        ["/maturities", copy.nav.maturities],
      ],
    },
    {
      label: copy.nav.ledger,
      items: [
        ["/assets", copy.nav.assets],
        ["/transactions", copy.nav.transactions],
        ["/cash-flows", copy.nav.cashFlows],
      ],
    },
  ] as const;
  const isCurrent = (href: string) =>
    href === "/" ? current === "/" : current === href || current.startsWith(`${href}/`);

  const links = groups.map((g) => (
    <div key={g.label} className={styles.group}>
      <span className={styles.groupLabel}>{g.label}</span>
      <ul className={styles.list}>
        {g.items.map(([href, label]) => (
          <li key={href}>
            <Link href={href} aria-current={isCurrent(href) ? "page" : undefined} className={styles.link}>
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  ));

  const controls = (
    <div className={styles.controls}>
      <Link href="/settings" aria-current={isCurrent("/settings") ? "page" : undefined} className={styles.link}>
        {copy.nav.settings}
      </Link>
      <form action={setThemeAction} className={styles.theme}>
        <label>
          <span className="visually-hidden">{copy.nav.theme}</span>
          <select name="theme" defaultValue={theme} aria-label={copy.nav.theme}>
            <option value="system">{copy.nav.themeSystem}</option>
            <option value="light">{copy.nav.themeLight}</option>
            <option value="dark">{copy.nav.themeDark}</option>
          </select>
        </label>
        <button type="submit" className="quiet">
          {copy.nav.theme}
        </button>
      </form>
      <PrivacyToggle label={copy.nav.privacy} onLabel={copy.nav.privacyOn} offLabel={copy.nav.privacyOff} />
      <form action={signOut}>
        <button type="submit" className="quiet">
          {copy.nav.signOut}
        </button>
      </form>
    </div>
  );

  return (
    <header className={styles.header}>
      <div className={styles.inner}>
        <Link href="/" className={styles.brand}>
          Finance Finder
        </Link>
        <nav aria-label={copy.nav.analysis} className={styles.wide}>
          {links}
          {controls}
        </nav>
        <details className={styles.narrow}>
          <summary className={styles.summary}>{copy.nav.menu}</summary>
          <nav aria-label={copy.nav.menu}>
            {links}
            {controls}
          </nav>
        </details>
      </div>
    </header>
  );
}
