# e2e — browser journeys

`pnpm test:e2e` runs Playwright against the LOCAL Supabase stack and a
Next.js server it starts itself (`pnpm dev` locally, `pnpm start` under
`CI`). It is a tier like `pnpm test:db` (MILESTONES.md §4 decision 46):

- **Fails, never skips.** No browser, no stack, no environment → a failure
  that names what is missing (`setup.ts`). A green run always proved
  something.
- **Excluded from `pnpm test`; required by `pnpm release:check`.**
- **One file at a time**, one worker: journeys share a database.
- Journeys create their own throwaway owner through the admin API and
  delete it afterwards (`helpers.ts`, Milestone 4 Phase 7); nothing is
  read from or written to a real user.

Setup once: `pnpm exec playwright install chromium`. Environment: the same
`.env.local` the database tier uses, plus `NEXT_PUBLIC_SITE_URL`.

The journeys themselves are the persona scenarios in `specs/PERSONAS.md`,
in order, plus the security-boundary journey of decision 40.
