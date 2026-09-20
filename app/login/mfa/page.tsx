import { verifyTotp } from "../actions";

/** SPEC §9.6: a valid password alone gets this page and nothing else. */
export default async function MfaPage({ searchParams }: PageProps<"/login/mfa">) {
  const { failed } = await searchParams;
  return (
    <main>
      <h1>Second factor</h1>
      <form action={verifyTotp}>
        <label>
          Code from your authenticator <input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" required />
        </label>
        {failed ? <p role="alert">That code was not accepted.</p> : null}
        <button type="submit">Verify</button>
      </form>
      <p>
        Lost the device? Recovery is <code>pnpm bootstrap:user --reset-mfa</code> on the host — never an email link.
      </p>
    </main>
  );
}
