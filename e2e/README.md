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

The journeys themselves are the persona scenarios in `specs/PERSONAS.md`, in
order, plus the security-boundary journey of decision 40.

## The journeys (Milestone 4 P7-U1)

| File              | What it proves                                                                                                  |
| ----------------- | --------------------------------------------------------------------------------------------------------------- |
| `01-sign-in`      | A password reaches the ledger; no signup exists; a wrong password says nothing about which half was wrong       |
| `02-enrol-totp`   | Enrolling in one session makes a FRESH session prove the factor                                                 |
| `03-add-asset`    | All seven BR kinds add through one generated form; an unpriced row names the missing variable                   |
| `04-import-csv`   | The golden ledger imports once, creates its assets inline, and a second import writes nothing                   |
| `05-analysis`     | The Assets foot total IS the Overview headline; Performance and Maturities show the golden's figures            |
| `06-export`       | Both downloads parse and `last_export_at` is stamped                                                            |
| `07-privacy-mode` | Every `.amount` masks and survives a reload                                                                     |
| `08-phone`        | Every route fits 400 px and the menu opens (the `phone` project only)                                           |
| `09-boundary`     | Signed out, and at AAL1 with a factor, NO route renders an amount; every response carries decision 51's headers |
| `10-instance`     | A failing source is named in the strip and on Settings → Instance; `pack_in_use` and `oversell` are refused     |

`gate.spec.ts` is the Phase-2 review gate, kept so its screenshots can be
regenerated; `smoke.spec.ts` is the tier's own canary.

### Two things that will bite

- **No journey may reach a live source.** `playwright.config.ts` starts the
  server with `BRAPI_TOKEN=""`; ingestion preflights on `!env[name]`, so the
  run is offline and deterministic, and `missing_env:BRAPI_TOKEN` is a
  _reproducible_ state rather than an accident of whose machine ran it.
- **Assert what renders, not where the address bar points.** After sign-in the
  MFA challenge is served in place and the URL stays `/`. The security claim
  is that no amount is on the page, which is what `09` asserts. Likewise, wait
  on a _result_ (poll the ledger) rather than `waitForLoadState`, which
  resolves immediately on an already-idle page and aborts the action in flight.
