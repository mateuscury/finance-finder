"use client";

import { copyFor } from "@/lib/copy";

/**
 * The error boundary for every data page (plan "Accessibility"): fixed
 * copy, never a message or a stack — an error may embed a value or a key.
 * A boundary gets no server props, so the language comes from the <html>
 * lang the root layout already set.
 */
export default function AppError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  const copy = copyFor(typeof document === "undefined" ? "en" : document.documentElement.lang);
  return (
    <main>
      <h1>{copy.errors.title}</h1>
      <p role="alert">{copy.errors.body}</p>
      <button type="button" onClick={() => retry()}>
        {copy.errors.retry}
      </button>
    </main>
  );
}
