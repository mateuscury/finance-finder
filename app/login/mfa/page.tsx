import { currentCopy } from "@/lib/copy/server";
import { verifyTotp } from "../actions";

/** SPEC §9.6: a valid password alone gets this page and nothing else. */
export default async function MfaPage({ searchParams }: PageProps<"/login/mfa">) {
  const [{ failed }, copy] = await Promise.all([searchParams, currentCopy()]);
  const c = copy.screens.login.mfa;
  const s = copy.screens.settings.security;
  return (
    <>
      <h1>{c.title}</h1>
      <form action={verifyTotp}>
        <label>
          {c.code}
          <input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" required autoFocus />
        </label>
        {failed ? <p role="alert">{c.failed}</p> : null}
        <button type="submit" className="primary">
          {c.verify}
        </button>
      </form>
      <p className="muted">
        <small>
          {s.recoveryBefore}
          <code>pnpm bootstrap:user --reset-mfa</code>
          {s.recoveryAfter}
        </small>
      </p>
    </>
  );
}
