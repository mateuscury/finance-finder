# lib/packs — kernel-side pack runtime

Kernel code that *consumes* manifests. Packs never import from here.

Planned (Milestone 1):

- `http.ts` — the `PackHttp` implementation: per-source rate limiting, retry
  with backoff, project user-agent, fixture record/replay (PACKS.md §7 rule 1).
- `activate.ts` — resolve `user_settings.enabled_packs` against the registry,
  pulling in each pack's declared `dependencies` transitively (`br` → `global`)
  so a user who enables only `br` still gets USDBRL ingested.
- `ingest.ts` — the single-invocation price job: iterate enabled sources with
  a per-source time budget and resume markers (Vercel Hobby = 2 crons, §10).
