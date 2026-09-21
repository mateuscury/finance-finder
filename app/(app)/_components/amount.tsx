/**
 * The one component every monetary amount and quantity renders through
 * (SPEC §12.3). Privacy mode masks it as ••• through CSS on `.amount`;
 * names, percentages and returns never use it. A server component: the
 * value arrives already formatted by lib/format.
 */
export function Amount({ value, hiddenLabel, className }: { value: string; hiddenLabel: string; className?: string }) {
  return (
    <span className={`amount figure${className ? ` ${className}` : ""}`} data-hidden-label={hiddenLabel}>
      {value}
    </span>
  );
}
