import Link from "next/link";
import { signIn } from "./actions";

/** SPEC §9.6, §9.5: email + password, no signup link, one line of copy. */
export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { failed } = await searchParams;
  return (
    <main>
      <h1>Sign in</h1>
      <form action={signIn}>
        <label>
          Email <input name="email" type="email" autoComplete="username" required />
        </label>
        <label>
          Password <input name="password" type="password" autoComplete="current-password" required />
        </label>
        {failed ? <p role="alert">Email or password incorrect.</p> : null}
        <button type="submit">Sign in</button>
      </form>
      <p>
        Single-owner instance — the account is created with <code>pnpm bootstrap:user</code>. <Link href="/login/reset">Forgot your password?</Link>
      </p>
    </main>
  );
}
