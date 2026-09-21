# lib/auth — identity

The trust rules (docs/milestone-3-plan.md "Identity and sessions"):

- **Identity comes from `getUser()`**, verified against Auth on every call.
  `getSession()` trusts the cookie unverified and is banned by lint.
- **`access.ts`** is the pure decision — `resolveAccess(auth)` →
  `unauthenticated | mfa_required | ok`, and `redirectFor(pathname, access)`
  — shared by `proxy.ts` (optimistic, every request, refreshes the cookie)
  and `session.ts` (authoritative).
- **`session.ts`** `requireUser()` is the DAL entry every page under
  `app/(app)/` and every server action calls FIRST: it redirects to
  `/login` or `/login/mfa` and returns the identity plus the user's own
  RLS-scoped client. `requireAal2()` gates password change, factor removal
  and delete-everything when a factor is enrolled.
- **`security.ts`** — password change, TOTP enrol/confirm/remove, sign out
  everywhere, a fresh-password check on a throwaway client. Fixed reasons
  only.
- Nothing in the browser talks to Supabase: the one client component (TOTP
  enrolment) calls server actions, so the session cookie is `httpOnly`.
- `auth.dbtest.ts` proves sign-in, uniform failure and TOTP → AAL2 against
  the local Auth with an RFC 6238 generator written in the test.

## One factor per owner

Supabase Auth permits up to ten verified TOTP factors; this app keeps
exactly one. The challenge (`verifyTotp` in `app/login/actions.ts`) reads
the first verified factor, so a second would never be asked for —
`enrolTotp` therefore refuses with `factor_exists` while one is verified,
and removal (`unenrolTotp`, AAL2) is the way to replace it. Abandoned
unverified enrolments are cleared on the next attempt.
