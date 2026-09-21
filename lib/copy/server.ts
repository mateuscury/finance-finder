/**
 * The request's copy, for Server Components and actions: the language comes
 * from the preference cookie `lib/settings/preferences.ts` describes, so no
 * page needs a database read to speak the user's language, and a signed-out
 * page speaks the instance default.
 */
import { cookies } from "next/headers";
import { LOCALE_COOKIE, parseLocale } from "@/lib/settings/preferences";
import { copyFor } from "./index";
import type { Copy } from "./types";

export async function currentCopy(): Promise<Copy> {
  const jar = await cookies();
  return copyFor(parseLocale(jar.get(LOCALE_COOKIE)?.value));
}
export type { ImportOutcome } from "./types";
