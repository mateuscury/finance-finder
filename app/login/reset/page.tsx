import Link from "next/link";
import { completePasswordReset, requestPasswordReset } from "../actions";

export default async function ResetPage({ searchParams }: PageProps<"/login/reset">) {
  const { step, sent, failed } = await searchParams;
  if (step === "complete") {
    return (
      <main>
        <h1>Choose a new password</h1>
        <form action={completePasswordReset}>
          <label>
            New password <input name="password" type="password" autoComplete="new-password" minLength={12} required />
          </label>
          <label>
            Confirm <input name="confirm" type="password" autoComplete="new-password" minLength={12} required />
          </label>
          {failed ? (
            <p role="alert">
              The passwords did not match or were not accepted (12+ characters, upper, lower, digit, symbol).
            </p>
          ) : null}
          <button type="submit">Set password</button>
        </form>
      </main>
    );
  }
  return (
    <main>
      <h1>Reset your password</h1>
      {sent ? (
        <p>
          If that address has an account, an email was sent. If email is down, the host can run{" "}
          <code>pnpm bootstrap:user</code>.
        </p>
      ) : (
        <form action={requestPasswordReset}>
          <label>
            Email <input name="email" type="email" autoComplete="username" required />
          </label>
          <button type="submit">Send reset email</button>
        </form>
      )}
      <p>
        <Link href="/login">Back to sign in</Link>
      </p>
    </main>
  );
}
