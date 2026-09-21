import Link from "next/link";
import { currentCopy } from "@/lib/copy/server";
import { completePasswordReset, requestPasswordReset } from "../actions";

/** SPEC §9.6: the reset email, then the new password once the callback has exchanged the link. */
export default async function ResetPage({ searchParams }: PageProps<"/login/reset">) {
  const [{ step, sent, failed }, copy] = await Promise.all([searchParams, currentCopy()]);
  const c = copy.screens.login.reset;
  if (step === "complete") {
    return (
      <>
        <h1>{c.completeTitle}</h1>
        <form action={completePasswordReset}>
          <label>
            {c.newPassword}
            <input name="password" type="password" autoComplete="new-password" minLength={12} required />
          </label>
          <label>
            {c.confirm}
            <input name="confirm" type="password" autoComplete="new-password" minLength={12} required />
          </label>
          {failed ? <p role="alert">{c.failed}</p> : null}
          <button type="submit" className="primary">
            {c.set}
          </button>
        </form>
      </>
    );
  }
  return (
    <>
      <h1>{c.title}</h1>
      {sent ? (
        <p role="status">
          {c.sentBefore}
          <code>pnpm bootstrap:user</code>
          {c.sentAfter}
        </p>
      ) : (
        <form action={requestPasswordReset}>
          <label>
            {c.email}
            <input name="email" type="email" autoComplete="username" required />
          </label>
          <button type="submit" className="primary">
            {c.send}
          </button>
        </form>
      )}
      <p className="muted">
        <small>
          <Link href="/login">{c.back}</Link>
        </small>
      </p>
    </>
  );
}
