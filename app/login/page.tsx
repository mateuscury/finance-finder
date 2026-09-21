import Link from "next/link";
import { currentCopy } from "@/lib/copy/server";
import { Inline } from "./_inline";
import { signIn } from "./actions";

/** SPEC §9.6, §9.5: email + password, no signup link, one line of copy. */
export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const [{ failed }, copy] = await Promise.all([searchParams, currentCopy()]);
  const c = copy.screens.login;
  return (
    <>
      <h1>{c.title}</h1>
      <form action={signIn}>
        <label>
          {c.email}
          <input name="email" type="email" autoComplete="username" required />
        </label>
        <label>
          {c.password}
          <input name="password" type="password" autoComplete="current-password" required />
        </label>
        {failed ? <p role="alert">{c.failed}</p> : null}
        <button type="submit" className="primary">
          {c.signIn}
        </button>
      </form>
      <p className="muted">
        <small>
          <Inline text={copy.empty.login} /> <Link href="/login/reset">{c.forgot}</Link>
        </small>
      </p>
    </>
  );
}
