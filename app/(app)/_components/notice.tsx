import { outcomeFrom } from "@/app/(app)/_lib/form";

/** Renders the last action's outcome from the page's search params. */
export function Notice({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const outcome = outcomeFrom(searchParams);
  if (!outcome) return null;
  if (outcome.kind === "saved") return <p role="status">Saved.</p>;
  return (
    <p role="alert">
      {outcome.message}
      {outcome.fields.length > 0 ? ` Check: ${outcome.fields.join(", ")}.` : ""}
    </p>
  );
}
