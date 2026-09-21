/** A copy line with `code` spans: SPEC's quoted lines keep their backticks verbatim in the dictionary. */
export function Inline({ text }: { text: string }) {
  return (
    <>{text.split("`").map((part, i) => (i % 2 === 1 ? <code key={i}>{part}</code> : <span key={i}>{part}</span>))}</>
  );
}
