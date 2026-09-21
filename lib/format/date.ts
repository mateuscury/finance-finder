/**
 * Calendar dates ("YYYY-MM-DD") per locale. A date is not an instant: it is
 * formatted in UTC from its own midnight so no time zone can shift it to
 * the day before. The `Date` here carries a calendar day, not a value.
 */
const cache = new Map<string, Intl.DateTimeFormat>();

function formatter(locale: string, style: "short" | "long"): Intl.DateTimeFormat {
  const key = `${locale}|${style}`;
  let f = cache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(locale, { timeZone: "UTC", dateStyle: style === "short" ? "medium" : "long" });
    cache.set(key, f);
  }
  return f;
}

export function formatDate(iso: string, locale: string, style: "short" | "long" = "short"): string {
  return formatter(locale, style).format(new Date(`${iso}T00:00:00Z`));
}

/** "fev. 2026" / "Feb 2026" — for a timeline grouped by month. */
export function formatMonth(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { timeZone: "UTC", month: "short", year: "numeric" }).format(
    new Date(`${iso}T00:00:00Z`),
  );
}
