-- Pending CSV import (SPEC §9.1 "Dry-run first, always"; docs/milestone-3-plan.md
-- Phase 5). The upload and the commit are two requests; the file must live
-- somewhere between them so the commit can re-run the dry run on the SAME
-- bytes and refuse if the preview it was shown no longer matches. One row
-- per user, replaced by each upload, deleted on commit or discard. Transient:
-- not user data, not in the backup.
create table if not exists public.csv_imports (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  filename    text not null,
  content     text not null,
  uploaded_at timestamptz not null default now(),
  -- A personal ledger's history is kilobytes; a megabyte cap keeps a stray
  -- upload from becoming a storage problem.
  constraint csv_imports_size_check check (octet_length(content) <= 4 * 1024 * 1024)
);

alter table public.csv_imports enable row level security;
drop policy if exists "own csv import" on public.csv_imports;
create policy "own csv import" on public.csv_imports
  for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
