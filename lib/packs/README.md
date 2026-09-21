# lib/packs — kernel-side pack runtime

Kernel code that _consumes_ manifests. Packs never import from here (lint and
`packs/conformance/hygiene.test.ts` both enforce it).

## What is here

| File          | Responsibility                                                                                                       |
| ------------- | -------------------------------------------------------------------------------------------------------------------- |
| `http.ts`     | The `PackHttp` implementation: token-bucket rate limiting, retries, deadline-aware aborts, and fixture record/replay |
| `redact.ts`   | Secret redaction, applied before a byte reaches a fixture, an exception or a diagnostic                              |
| `fixtures.ts` | The versioned fixture envelope and its zod schema                                                                    |
| `validate.ts` | Adapter-output validation against the manifest that asked for the data                                               |
| `activate.ts` | Resolves `user_settings.enabled_packs` transitively (`br` → `global`)                                                |
| `ingest.ts`   | The single scheduler: windowing, budgets, watermarks, commit payloads                                                |
| `store.ts`    | The only file that knows about PostgREST; paginates every collection                                                 |

## HTTP modes

`createPackHttp` runs in one of three modes:

- **`live`** — real network. A process-local token bucket applies the source's
  declared `rateLimit`, every request carries the project user-agent, and the
  request is genuinely cancelled (not raced) when the budget signal aborts.
- **`record`** — identical to live, plus a sanitized transcript for the recorder.
- **`replay`** — consumes a recorded transcript strictly, in order, and never
  touches global `fetch`. Sleeps are no-ops, so a recorded 429 exhausts its
  retries instantly and deterministically.

**Retry policy:** at most **3 attempts** total, for `429` and `5xx` only. Every
attempt — including a retry — consumes a rate-limit token. Both `Retry-After`
forms are honoured (delay-seconds and HTTP-date), but the runtime never sleeps
past the source or invocation deadline: returning the 429 now leaves time for
the commit, where sleeping would not.

**Rate-limit scope:** the token bucket is _process-local_. It is not a
distributed limit, and two concurrent instances would each hold their own. That
is acceptable only because ingestion is a single scheduled invocation; an
upstream 429 remains the final authority.

## Fixture envelope

One versioned object per file — deliberately not a bare array, because an array
has nowhere to carry `recordedAt`, and `recordedAt` is what supplies `ctx.now()`
during replay:

```json
{
  "version": 1,
  "recordedAt": "2026-09-06T21:00:00.000Z",
  "cases": [
    {
      "input": { "capability": "series", "refs": ["br.cdi"], "from": "...", "to": "..." },
      "exchanges": [
        {
          "request": { "method": "GET", "url": "...", "headers": {} },
          "response": { "status": 200, "headers": {}, "body": "..." }
        }
      ]
    }
  ]
}
```

`success.json` and `empty.json` must between them exercise **every** declared
capability. `upstream_5xx.json` and `rate_limited_429.json` contain one exchange
per attempt, so replay walks the whole retry policy.

Record with `pnpm fixtures:record --source <id>` (or `--all`). Selection is
explicit on purpose: a bare invocation records nothing rather than silently
rewriting every fixture. Success and empty cases come from the checked-in
catalog in `scripts/fixture-catalog.ts` — public sample identifiers, never a
user's database. Retryable failures are synthesized locally against a stub
transport; the recorder never waits for a real upstream to break.

Bulk downloads may declare a `trimBody` reducer (Tesouro publishes one ~14 MB
CSV covering every bond since 2004). The reduced body preserves the exact
delimiter, decimal notation and column layout the adapter parses.

## Cursors vs watermarks

`ingest_cursors.last_date` is **a summary, not the resume truth**. One value per
source cannot distinguish an already-backfilled ticker from an asset created
this morning, and a legitimately empty window would be re-requested nightly.

`ingest_watermarks` is keyed by `(source_id, capability, ref)`:

- `target_from` — the earliest date this ref is currently wanted from. A newly
  created asset can pull it **earlier**, which restarts that ref's forward
  cursor and replays forward idempotently rather than leaving a hole.
- `last_date` — the highest date whose request _and_ validated write both
  succeeded. It advances through `to` on a coverage-complete response,
  **including a genuinely empty one**, and never on an auth failure, abort,
  transport failure, or rejected output.
- `unavailable_before` — the source's honest lower availability boundary, for a
  truncated range (brapi's free plan reaches back three months). Clear it
  explicitly when credentials or plan coverage change.

An adapter states that boundary through `RefCoverage.unavailableBefore`, and
**must** state it explicitly rather than leaving it to be inferred from the
returned span. The case that matters is the one where NOTHING came back: a
window entirely older than a rolling limit looks exactly like a transient
failure, so the scheduler would refuse to advance and re-request the same
unreachable chunk on every run. With the floor declared, the next `planWindow`
skips forward to it. A genuinely transient failure declares no floor, so nothing
is written off.

## Logging boundary

Telemetry carries **source id, attempt, status code and duration only**. Never a
URL, header, body, adapter warning, ref, quantity, or price. The cron route's
summary is built from that telemetry plus counts, and reviewed error _codes_ —
never an upstream message.

## Safety requirements (all enforced by tests)

- validate every adapter result structurally _and_ semantically against the
  manifest, rejecting rather than coercing;
- paginate every PostgREST read past `api.max_rows` (currently 1,000);
- never overwrite a user-authored `manual` price — enforced in the database by
  `commit_ingest_chunk`, not only in application code;
- commit prices, series points, watermarks and the cursor in ONE transaction, so
  data and resume markers cannot diverge;
- redact declared secrets, and their URL-encoded forms, before they reach a
  fixture, an exception or a log.
