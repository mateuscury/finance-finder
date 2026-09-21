"use client";
/**
 * The one client component (decision 19's exception): TOTP enrolment must
 * show the QR between `enroll()` and `verify()`, and the secret must never
 * travel in a URL. It talks only to server actions — cookies stay
 * httpOnly and no browser Supabase client exists. Its strings arrive as
 * props: the dictionary is chosen on the server.
 */
import { useActionState } from "react";
import type { Copy } from "@/lib/copy";
import { confirmTotpAction, enrolTotpAction } from "./actions";

type State = Awaited<ReturnType<typeof enrolTotpAction>> | null;

/** `copy` and `reasons` are strings only: props cross the server/client boundary. */
export function TotpEnrol({
  copy,
  reasons,
}: {
  copy: Copy["screens"]["settings"]["security"]["enrol"];
  reasons: Copy["security"];
}) {
  const [state, start, pending] = useActionState<State>(async () => enrolTotpAction(), null);
  if (state?.ok) {
    return (
      <form action={confirmTotpAction}>
        <p>{copy.scan}</p>
        {/* eslint-disable-next-line @next/next/no-img-element -- a data URI from Auth, never fetched */}
        <img src={state.enrolment.qrCode} alt={copy.qrAlt} width={200} height={200} />
        <p>
          {copy.secret}: <code>{state.enrolment.secret}</code>
        </p>
        <input type="hidden" name="factorId" value={state.enrolment.factorId} />
        <label>
          {copy.code}
          <input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" required />
        </label>
        <button type="submit" className="primary">
          {copy.confirm}
        </button>
      </form>
    );
  }
  return (
    <form action={start}>
      {state && !state.ok ? (
        <p role="alert">
          {copy.failed} {reasons[state.reason] ?? reasons.auth_failed}
        </p>
      ) : null}
      <button type="submit" disabled={pending}>
        {pending ? copy.starting : copy.start}
      </button>
    </form>
  );
}
