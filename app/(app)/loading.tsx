/** A token-coloured skeleton while a page's reads run; no copy, so nothing to translate. */
export default function Loading() {
  return (
    <main aria-busy="true">
      <div className="skeleton skeleton-title" />
      <div className="skeleton skeleton-line" />
      <div className="skeleton skeleton-line" />
      <div className="skeleton skeleton-block" />
    </main>
  );
}
