import { outcomeFrom } from "@/app/(app)/_lib/form";
import { currentCopy } from "@/lib/copy/server";

/** Renders the last action's outcome from the page's search params, in the request's language. */
export async function Notice({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const copy = await currentCopy();
  const outcome = outcomeFrom(searchParams, copy);
  if (!outcome) return null;
  if (outcome.kind === "saved") return <p role="status">{copy.saved}</p>;
  return (
    <p role="alert">
      {outcome.message}
      {outcome.fields.length > 0 ? copy.checkFields({ fields: outcome.fields.join(", ") }) : ""}
    </p>
  );
}
