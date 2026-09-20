"use client";
/**
 * The one client component (decision 19's exception): TOTP enrolment must
 * show the QR between `enroll()` and `verify()`, and the secret must never
 * travel in a URL. It talks only to server actions — cookies stay
 * httpOnly and no browser Supabase client exists.
 */
import { useActionState } from "react";
import { confirmTotpAction, enrolTotpAction } from "./actions";

type State = Awaited<ReturnType<typeof enrolTotpAction>> | null;

export function TotpEnrol() {
  const [state, start, pending] = useActionState<State>(async () => enrolTotpAction(), null);
  if (state?.ok) {
    return (
      <form action={confirmTotpAction}>
        <p>Scan this with your authenticator, or enter the secret by hand, then confirm with a code.</p>
        {/* eslint-disable-next-line @next/next/no-img-element -- a data URI from Auth, never fetched */}
        <img src={state.enrolment.qrCode} alt="TOTP enrolment QR code" width={200} height={200} />
        <p>
          Secret: <code>{state.enrolment.secret}</code>
        </p>
        <input type="hidden" name="factorId" value={state.enrolment.factorId} />
        <label>
          Code <input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" required />
        </label>
        <button type="submit">Confirm enrolment</button>
      </form>
    );
  }
  return (
    <form action={start}>
      {state && !state.ok ? <p role="alert">Enrolment could not start ({state.reason}).</p> : null}
      <button type="submit" disabled={pending}>
        {pending ? "Starting…" : "Enrol an authenticator app"}
      </button>
    </form>
  );
}
