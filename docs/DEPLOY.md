# Deploying Finance Finder

MILESTONES.md §4 decision 43: Vercel Hobby + Supabase Free, on the
maintainer's own accounts, performed **with** the maintainer — the account
steps cannot be done for you. Follow this top to bottom once; afterwards only
"Deploying a change" applies.

> **The gate.** `pnpm release:check` must print
> "Release readiness checks passed." before real portfolio data goes in. Green
> CI is not the same signal (`CLAUDE.md`). Run it locally before you start.

Every step names variables, never values. Nothing here should ever be pasted
into a chat, a commit, or an issue.

## 0. Before you begin

- A GitHub account with this repository pushed.
- A Supabase account and a Vercel account.
- The Supabase CLI (`supabase --version`; this project is developed against
  2.72.7) and Node ≥ 22 with pnpm 10.
- `BRAPI_TOKEN` from https://brapi.dev (free tier). Optional: without it,
  market-priced holdings show "unpriced" with the variable named, and nothing
  crashes.

## 1. The Supabase project

1. **Create it.** Supabase dashboard → New project. Choose a region near you
   (`sa-east-1` for Brazil) and a strong database password; save that password
   in your password manager — it is not recoverable.
2. **Link and push the schema** from the repository root:

   ```
   supabase link --project-ref <your-project-ref>
   supabase db push
   ```

   `db push` applies `supabase/migrations/` in order. The migrations are
   forward-only and the initial one is frozen — never edit an applied file.

3. **Auth settings** (Authentication → Sign In / Providers, and → Policies).
   The dashboard must mirror `supabase/config.toml`, because `config.toml`
   governs only the local stack:

   | Setting                    | Value                                 | Why                                                    |
   | -------------------------- | ------------------------------------- | ------------------------------------------------------ |
   | Allow new users to sign up | **off**                               | One owner per instance; the owner is created in step 4 |
   | Email provider             | **on**                                | It is the provider for password reset mail             |
   | Confirm email              | **off**                               | The owner is created pre-confirmed                     |
   | Minimum password length    | **12**                                | matches `config.toml`                                  |
   | Password requirements      | **lower, upper, digits, symbols**     | matches `config.toml`                                  |
   | Multi-factor (TOTP)        | **enabled**                           | SPEC §9.6                                              |
   | Site URL                   | `https://<your-domain>`               | reset links are built from it                          |
   | Redirect URLs              | `https://<your-domain>/auth/callback` | the only callback                                      |

4. **SMTP.** The built-in email service is rate-limited and not for
   production. Configure a custom SMTP sender (Authentication → Emails) or
   password reset mail will not arrive. Test it before you rely on it.

## 2. The Vercel project

1. **Import** the GitHub repository. Framework preset: Next.js. Leave the
   build command as the default (`pnpm build`).
2. **Environment variables** (Settings → Environment Variables), Production
   and Preview:

   | Name                            | Where it comes from                                                      |
   | ------------------------------- | ------------------------------------------------------------------------ |
   | `NEXT_PUBLIC_SUPABASE_URL`      | Supabase → Project Settings → API                                        |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | the same page                                                            |
   | `SUPABASE_SERVICE_ROLE_KEY`     | the same page — **never** prefix it `NEXT_PUBLIC_`                       |
   | `NEXT_PUBLIC_SITE_URL`          | `https://<your-domain>`, no trailing slash                               |
   | `CRON_SECRET`                   | `openssl rand -base64 32` — at least 32 bytes, or cron auth fails closed |
   | `BRAPI_TOKEN`                   | brapi.dev, optional                                                      |

   `NEXT_PUBLIC_*` values are inlined **at build time**: changing one needs a
   redeploy, not just a restart.

3. **The crons** come from `vercel.json` and need no dashboard setup:

   ```
   /api/cron/prices     30 21 * * 1-5
   /api/cron/snapshots   0 23 * * 1-5
   ```

   See [Crons](#5-crons) for what to expect from them on Hobby — read that
   section before concluding one is broken.

4. **Function duration (D-27).** Fluid compute is enabled by default, and on
   Hobby a function may run up to **300 s**. This project ships a deliberately
   conservative **60 s**: `CRON_MAX_DURATION_SECONDS` in `lib/cron/budget.ts`
   and the `maxDuration` export in both routes under `app/api/cron/`.

   Raising both literals to 300 is optional and safe on Hobby with Fluid
   compute on. It matters in exactly one case: the **first** snapshot backfill
   of a long history. At the measured 3.3 days/s
   (`docs/performance-budgets.md`) a 60 s invocation builds ~200 days and a
   300 s one ~1,000, so five years of history catches up in about two runs
   instead of seven. Change both literals together, or the route will be cut
   off before the job's own budget expires.

## 3. First deploy and the owner

1. Deploy (push to `main`, or Deploy in the dashboard). Confirm the build
   succeeded and `/login` renders.
2. **Create the single owner** from your machine, with the environment
   pointed at production. The script is interactive on purpose so the password
   never reaches an env file or the process list:

   ```
   NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... pnpm bootstrap:user
   ```

3. **Sign in** at `https://<your-domain>/login`, then Settings → Security →
   enrol an authenticator. Confirm a fresh browser session demands the code.
   Recovery is `pnpm bootstrap:user --reset-mfa` on the host — never an email
   link.
4. **Set the base currency before the first transaction.** It locks after, and
   changing it later discards every snapshot and rebuilds history.

## 4. Verifying the deployment

Run the journeys against production. The setup creates and deletes its own
throwaway owner and never touches yours:

```
NEXT_PUBLIC_SITE_URL=https://<your-domain> pnpm test:e2e
```

Then watch both crons fire once (below). Only after that should real
portfolio data go in.

## 5. Crons

Two by design, not a platform cap: ingestion iterates its sources inside one
invocation with a per-source budget and `ingest_cursors` resume markers.

**What Hobby guarantees, and what it does not.** Hobby allows at most one run
**per day** per cron expression — both of this project's schedules qualify —
and its scheduling precision is **per hour (±59 minutes)**. A job set for
21:30 may fire any time between 21:00 and 21:59. It is not late; that is the
plan. An expression that would run more than once a day fails at deploy time.
Crons run against **production** deployments only.

**Reading a run.** Vercel → your project → Logs, filtered to the cron path.
Each run prints one JSON line (decision D-19) carrying ids, counts, status
codes and durations — never a row value and never a URL with a token:

```json
{ "job": "prices", "ok": true, "durationMs": 8412, "sources": [{ "id": "br.brapi", "status": "ok", "points": 37 }] }
```

**When they stop.** The app tells the owner, in the status strip and in
Settings → Instance (US-016):

| What the strip says    | What it means                                                                       |
| ---------------------- | ----------------------------------------------------------------------------------- |
| "no price run since …" | `/api/cron/prices` has not completed — check the cron log and `CRON_SECRET`         |
| "source … failing: …"  | one source is erroring; the rest are fine. The reason is that source's `last_error` |
| "history stopped at …" | snapshots are behind — usually a long backfill still catching up (§2.4)             |

Settings → Instance states the same per source, with the last price run and
how far history is built. It points here by name, so this section is a
contract, not a nicety.

## 6. Two free-tier facts worth knowing

- **A Supabase Free project pauses after a week of inactivity**
  ([docs](https://supabase.com/docs/guides/platform/free-project-pausing)), and
  is restored from the dashboard. The weekday crons are themselves activity,
  so an instance that is deploying and running crons stays awake; one that is
  paused stops ingesting, and the strip will say so when you return.
- **Free is 500 MB of database and 5 GB of egress per project.** SPEC §8 has
  the growth arithmetic: about five thousand price and snapshot rows a year
  for a twenty-asset portfolio. Nothing is ever pruned, and fetched price
  history cannot be re-fetched — so take backups (Settings → Your data). The
  free plan keeps no automatic ones.

## 7. Deploying a change, and rolling back

- **Deploy**: push to `main`. CI must be green; `check`, `db` and `e2e` all
  run.
- **Roll back**: Vercel → Deployments → the previous build → Promote to
  Production. The database is **forward-only** — a rollback of the app does
  not undo a migration, so a schema change must always be additive and
  deployed before the code that needs it.
- **A new migration**: `supabase db push` before the deploy that depends on
  it.

## 8. If something is wrong

| Symptom                             | Where to look                                                                              |
| ----------------------------------- | ------------------------------------------------------------------------------------------ |
| Cron returns 401                    | `CRON_SECRET` missing or under 32 bytes — auth fails closed by design (`lib/cron/auth.ts`) |
| Everything unpriced, variable named | `BRAPI_TOKEN` unset; ingestion preflights and skips the source without calling it          |
| Reset mail never arrives            | SMTP not configured (§1.4)                                                                 |
| Sign-in loops back to `/login`      | `NEXT_PUBLIC_SITE_URL` or the redirect URL does not match the deployed origin              |
| A page says "something went wrong"  | Vercel logs; the message is deliberately value-free                                        |
