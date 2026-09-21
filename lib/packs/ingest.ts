/**
 * The single ingestion scheduler (plan §3.2).
 *
 * ONE exported entry point, `runIngest`, used by every caller. Milestone 1
 * wires only the cron scope, but asset creation, Refresh and pack-enable all
 * reuse the same authorization, validation, write and budget path. A second
 * ingestion path is how manual-price protection or watermark atomicity quietly
 * stops holding on one route only.
 *
 * The store is a narrow interface rather than a Supabase client, so every rule
 * below is testable without a database.
 */
import type { FetchContext, FetchRequest, IsoDate, MarketPack, PriceSource, SourceCapability } from "@/packs/types";
import { resolveActivation } from "./activate";
import { validatePoints } from "./validate";
import type { HttpAttempt, PackHttpHandle } from "./http";

// ---------------------------------------------------------------------------
// Scope — discriminated from day one (plan §3.2)
// ---------------------------------------------------------------------------

export type IngestScope =
  /** Cron: every pack any user enabled, plus dependencies. */
  | { kind: "all_enabled" }
  /** Asset creation / CSV import: price exactly these assets. */
  | { kind: "assets"; assetIds: string[] }
  /** The Refresh button: everything currently without a price. */
  | { kind: "unpriced" }
  /** A user just enabled a pack: backfill its series. */
  | { kind: "new_packs"; packIds: string[] };

// ---------------------------------------------------------------------------
// Store boundary
// ---------------------------------------------------------------------------

export interface AssetRow {
  assetId: string;
  packId: string;
  instrumentKind: string;
  /** The market ref: a ticker, or a canonical Tesouro id. */
  identifier: string;
}

export interface WatermarkRow {
  capability: SourceCapability;
  ref: string;
  targetFrom: IsoDate;
  lastDate: IsoDate | null;
  unavailableBefore: IsoDate | null;
}

export interface CursorRow {
  sourceId: string;
  lastRunAt: string | null;
}

export interface CommitPayload {
  source_id: string;
  prices: Array<{ asset_id: string; date: IsoDate; price: string; currency: string }>;
  series_points: Array<{ series_id: string; date: IsoDate; value: string; tenor_days: number }>;
  watermarks: Array<{
    capability: SourceCapability;
    ref: string;
    target_from: IsoDate;
    last_date: IsoDate | null;
    unavailable_before: IsoDate | null;
  }>;
  cursor: { last_date: IsoDate | null; last_error: string | null };
}

export interface CommitCounts {
  prices_written: number;
  manual_protected: number;
  series_written: number;
  watermarks_advanced: number;
}

export interface IngestStore {
  listEnabledPacks(offset: number, limit: number): Promise<string[][]>;
  listCursors(): Promise<CursorRow[]>;
  listWatermarks(sourceId: string): Promise<WatermarkRow[]>;
  /** Assets belonging to the given packs; `assetIds`/`unpriced` narrow it. */
  listAssets(scope: IngestScope, packIds: string[]): Promise<AssetRow[]>;
  /** Earliest trade date per asset identifier; absent means "no transactions". */
  earliestTradeDates(identifiers: string[]): Promise<Record<string, IsoDate>>;
  commitChunk(payload: CommitPayload): Promise<CommitCounts>;
}

// ---------------------------------------------------------------------------
// Summary — counts and codes only, never values (plan §3.4)
// ---------------------------------------------------------------------------

export type SourceStatus = "ok" | "partial" | "skipped" | "error" | "budget_exhausted";

export interface SourceSummary {
  sourceId: string;
  status: SourceStatus;
  statusCodes: number[];
  attempts: number;
  durationMs: number;
  accepted: number;
  rejected: number;
  written: number;
  manualProtected: number;
  warnings: number;
  /** A reviewed, value-free code. Never an upstream message. */
  errorCode: string | null;
}

export interface IngestSummary {
  ok: boolean;
  durationMs: number;
  sources: SourceSummary[];
  activatedPacks: string[];
  activationWarnings: number;
}

// ---------------------------------------------------------------------------
// Windowing
// ---------------------------------------------------------------------------

/** Re-request this many days behind a watermark, so a late revision is caught. */
export const OVERLAP_DAYS = 5;
/** Cap on one forward chunk, so an initial backfill stays resumable. */
export const MAX_CHUNK_DAYS = 90;
/** Window used when a ref has no transaction history to anchor to. */
export const DEFAULT_LOOKBACK_DAYS = 30;

export function addDays(date: IsoDate, days: number): IsoDate {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

export function maxDate(a: IsoDate, b: IsoDate): IsoDate {
  return a > b ? a : b;
}

export interface PlannedWindow {
  from: IsoDate;
  to: IsoDate;
  targetFrom: IsoDate;
  /** True when an earlier target reset this ref's forward cursor. */
  restarted: boolean;
}

/**
 * Decide the window to request for one ref.
 *
 * The subtle case is a NEWLY CREATED asset whose history starts before the
 * previous target: resuming from `lastDate` would leave a permanent hole
 * between the new target and the old one. When that happens the forward cursor
 * restarts at the earlier target and replays forward idempotently.
 */
export function planWindow(
  today: IsoDate,
  watermark: WatermarkRow | undefined,
  earliestTrade: IsoDate | undefined,
): PlannedWindow {
  const naturalTarget = earliestTrade ?? addDays(today, -DEFAULT_LOOKBACK_DAYS);
  const previousTarget = watermark?.targetFrom;
  const targetFrom = previousTarget && previousTarget <= naturalTarget ? previousTarget : naturalTarget;
  const restarted = previousTarget !== undefined && naturalTarget < previousTarget;

  let from: IsoDate;
  if (restarted || !watermark?.lastDate) {
    from = targetFrom;
  } else {
    // Resume just behind the last committed date, but never before the target.
    from = maxDate(addDays(watermark.lastDate, -OVERLAP_DAYS), targetFrom);
  }
  // A source that told us it cannot serve earlier than some date is believed,
  // rather than asked the same impossible question every night.
  if (watermark?.unavailableBefore && from < watermark.unavailableBefore) {
    from = watermark.unavailableBefore;
  }
  if (from > today) from = today;
  const to = maxDate(from, minDate(today, addDays(from, MAX_CHUNK_DAYS)));
  return { from, to, targetFrom, restarted };
}

function minDate(a: IsoDate, b: IsoDate): IsoDate {
  return a < b ? a : b;
}

// ---------------------------------------------------------------------------
// Work items
// ---------------------------------------------------------------------------

export interface WorkItem {
  capability: SourceCapability;
  refs: string[];
  from?: IsoDate;
  to?: IsoDate;
  /** ref -> the asset ids that quote resolves to; empty for a series ref. */
  assetIdsByRef: Map<string, string[]>;
  targetFromByRef: Map<string, IsoDate>;
}

/** The capability a source should be asked for, given what it declares. */
export function capabilityForSeries(source: PriceSource, isFx: boolean): SourceCapability | null {
  if (isFx && source.capabilities.includes("fx")) return "fx";
  if (source.capabilities.includes("series")) return "series";
  return null;
}

export function capabilityForAsset(source: PriceSource): SourceCapability | null {
  // Prefer real history; fall back to the latest quote only.
  if (source.capabilities.includes("historical")) return "historical";
  if (source.capabilities.includes("spot")) return "spot";
  return null;
}

// ---------------------------------------------------------------------------
// runIngest
// ---------------------------------------------------------------------------

export interface RunIngestOptions {
  scope: IngestScope;
  budgetMs: number;
  now: () => Date;
  store: IngestStore;
  /** Builds the PackHttp for one source, bound to that source's deadline. */
  httpFactory: (source: PriceSource, signal: AbortSignal, deadline: number) => PackHttpHandle;
  env: Readonly<Record<string, string | undefined>>;
  registry: readonly MarketPack[];
  /** Held back for the final commit and response. */
  reserveMs?: number;
}

const DEFAULT_RESERVE_MS = 10_000;

export async function runIngest(options: RunIngestOptions): Promise<IngestSummary> {
  const { scope, budgetMs, now, store, httpFactory, env, registry } = options;
  const reserveMs = options.reserveMs ?? DEFAULT_RESERVE_MS;
  const startedAt = now().getTime();
  const deadline = startedAt + budgetMs;
  const today = now().toISOString().slice(0, 10);

  // --- activation -----------------------------------------------------------
  const enabled = await readAllEnabledPacks(store);
  const requested = scope.kind === "new_packs" ? scope.packIds : enabled;
  const activation = resolveActivation(registry, requested);
  const activePackIds = activation.packs.map((p) => p.id);

  // --- source ordering ------------------------------------------------------
  // Least-recently-run first (nulls first), then stable by id: a source that
  // keeps timing out must not starve behind one that always succeeds.
  const cursors = new Map((await store.listCursors()).map((c) => [c.sourceId, c.lastRunAt] as const));
  const sources: Array<{ pack: MarketPack; source: PriceSource }> = activation.packs.flatMap((pack) =>
    pack.sources.map((source) => ({ pack, source })),
  );
  sources.sort((a, b) => {
    const ra = cursors.get(a.source.id) ?? null;
    const rb = cursors.get(b.source.id) ?? null;
    if (ra === null && rb !== null) return -1;
    if (rb === null && ra !== null) return 1;
    if (ra !== null && rb !== null && ra !== rb) return ra < rb ? -1 : 1;
    return a.source.id < b.source.id ? -1 : 1;
  });

  const assets = await store.listAssets(scope, activePackIds);
  const summaries: SourceSummary[] = [];

  for (let i = 0; i < sources.length; i++) {
    const { pack, source } = sources[i];
    const remaining = deadline - now().getTime();
    if (remaining <= reserveMs) {
      // Stop STARTING work; already-committed chunks stand and the next run
      // resumes from the watermarks.
      summaries.push(emptySummary(source.id, "budget_exhausted"));
      continue;
    }

    // Preflight: a missing API key disables the source without any adapter call.
    const missing = (source.envVars ?? []).filter((name) => !env[name]);
    if (missing.length > 0) {
      summaries.push({ ...emptySummary(source.id, "skipped"), errorCode: `missing_env:${missing.join(",")}` });
      await safeCommit(store, {
        source_id: source.id,
        prices: [],
        series_points: [],
        watermarks: [],
        cursor: { last_date: null, last_error: `missing_env:${missing.join(",")}` },
      });
      continue;
    }

    // Each source gets a child deadline: an even share of what is left, so one
    // slow source cannot consume the whole invocation.
    const share = Math.floor((remaining - reserveMs) / (sources.length - i));
    const sourceDeadline = now().getTime() + Math.max(1, share);
    summaries.push(
      await runSource({ pack, source, sourceDeadline, today, store, httpFactory, env, assets, now, scope }),
    );
  }

  return {
    ok: summaries.every((s) => s.status === "ok" || s.status === "skipped"),
    durationMs: now().getTime() - startedAt,
    sources: summaries,
    activatedPacks: activePackIds,
    activationWarnings: activation.warnings.length,
  };
}

function emptySummary(sourceId: string, status: SourceStatus): SourceSummary {
  return {
    sourceId,
    status,
    statusCodes: [],
    attempts: 0,
    durationMs: 0,
    accepted: 0,
    rejected: 0,
    written: 0,
    manualProtected: 0,
    warnings: 0,
    errorCode: null,
  };
}

async function readAllEnabledPacks(store: IngestStore): Promise<string[]> {
  const union = new Set<string>();
  const pageSize = 500;
  for (let offset = 0; ; offset += pageSize) {
    const page = await store.listEnabledPacks(offset, pageSize);
    for (const row of page) for (const id of row) union.add(id);
    if (page.length < pageSize) break;
  }
  return [...union];
}

async function safeCommit(store: IngestStore, payload: CommitPayload): Promise<CommitCounts | null> {
  try {
    return await store.commitChunk(payload);
  } catch {
    return null;
  }
}

interface RunSourceArgs {
  pack: MarketPack;
  source: PriceSource;
  sourceDeadline: number;
  today: IsoDate;
  store: IngestStore;
  httpFactory: RunIngestOptions["httpFactory"];
  env: Readonly<Record<string, string | undefined>>;
  assets: AssetRow[];
  now: () => Date;
  scope: IngestScope;
}

async function runSource(args: RunSourceArgs): Promise<SourceSummary> {
  const { pack, source, sourceDeadline, today, store, httpFactory, env, assets, now } = args;
  const startedAt = now().getTime();
  const summary = emptySummary(source.id, "ok");

  const watermarks = new Map<string, WatermarkRow>(
    (await store.listWatermarks(source.id)).map((w) => [`${w.capability}|${w.ref}`, w]),
  );

  // --- build work items ------------------------------------------------------
  const seriesRefs = pack.series.filter((s) => s.sourceId === source.id);
  const instrumentKinds = pack.instruments.filter(
    (i) =>
      (i.valuation.kind === "market_price" || i.valuation.kind === "nav_unit_price") &&
      i.valuation.sourceId === source.id,
  );
  const kindIds = new Set(instrumentKinds.map((k) => k.id));
  // One market ref can be held by several users; one fetched quote writes a
  // price row for each of their assets.
  const assetIdsByRef = new Map<string, string[]>();
  for (const asset of assets) {
    if (!kindIds.has(asset.instrumentKind)) continue;
    const list = assetIdsByRef.get(asset.identifier) ?? [];
    list.push(asset.assetId);
    assetIdsByRef.set(asset.identifier, list);
  }

  const earliest = await store.earliestTradeDates([...assetIdsByRef.keys()]);
  const items: WorkItem[] = [];

  // Series work, grouped by capability and identical window.
  for (const descriptor of seriesRefs) {
    const capability = capabilityForSeries(source, descriptor.kind.kind === "fx_rate");
    if (capability === null) continue;
    const key = `${capability}|${descriptor.id}`;
    const plan = planWindow(today, watermarks.get(key), undefined);
    pushItem(items, capability, descriptor.id, plan, new Map(), plan.targetFrom);
  }

  // Asset work. A `new_packs` run exists to backfill a newly enabled pack's
  // SERIES; pricing holdings is a different job with a different trigger, and
  // doing it here would turn a settings change into a full market fetch.
  const assetCapability = args.scope.kind === "new_packs" ? null : capabilityForAsset(source);
  if (assetCapability !== null) {
    for (const [ref, ids] of assetIdsByRef) {
      const key = `${assetCapability}|${ref}`;
      const plan = planWindow(today, watermarks.get(key), earliest[ref]);
      pushItem(items, assetCapability, ref, plan, new Map([[ref, ids]]), plan.targetFrom);
    }
  }

  if (items.length === 0) {
    return { ...summary, durationMs: now().getTime() - startedAt };
  }

  // --- execute ---------------------------------------------------------------
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1, sourceDeadline - now().getTime()));
  const handle = httpFactory(source, controller.signal, sourceDeadline);
  const ctx: FetchContext = {
    http: handle.http,
    env: Object.fromEntries((source.envVars ?? []).map((n) => [n, env[n]])),
    now: () => now(),
    signal: controller.signal,
    remainingMs: () => Math.max(0, sourceDeadline - now().getTime()),
  };

  const prices: CommitPayload["prices"] = [];
  const seriesPoints: CommitPayload["series_points"] = [];
  const commitWatermarks: CommitPayload["watermarks"] = [];
  const seriesById = new Map(pack.series.map((s) => [s.id, s] as const));
  const instrumentByRef = new Map<string, (typeof instrumentKinds)[number]>();
  for (const ref of assetIdsByRef.keys()) if (instrumentKinds[0]) instrumentByRef.set(ref, instrumentKinds[0]);

  try {
    for (const item of items) {
      if (controller.signal.aborted) {
        summary.status = "budget_exhausted";
        break;
      }
      const request: FetchRequest = { capability: item.capability, refs: item.refs, from: item.from, to: item.to };
      let result;
      try {
        result = await source.fetch(request, ctx);
      } catch {
        summary.status = "error";
        summary.errorCode ??= "adapter_threw";
        continue;
      }
      summary.warnings += result.warnings.length;

      const validation = validatePoints(result.points, {
        series: seriesById,
        instruments: instrumentByRef,
        requested: new Set(item.refs),
        from: item.from,
        to: item.to,
        now: today,
      });
      summary.accepted += validation.accepted.length;
      summary.rejected += validation.rejected.length;
      if (validation.rejected.length > 0) summary.status = summary.status === "ok" ? "partial" : summary.status;

      for (const point of validation.accepted) {
        const assetIds = item.assetIdsByRef.get(point.ref);
        if (assetIds && assetIds.length > 0) {
          // One quote, one row per holder. Each user's manual-price conflict is
          // then resolved independently inside the RPC.
          for (const assetId of assetIds) {
            prices.push({ asset_id: assetId, date: point.date, price: point.value, currency: point.currency! });
          }
        } else {
          seriesPoints.push({
            series_id: point.ref,
            date: point.date,
            value: point.value,
            tenor_days: point.tenorDays ?? 0,
          });
        }
      }

      // --- watermark decisions ------------------------------------------------
      for (const ref of item.refs) {
        if (validation.ambiguousRefs.has(ref)) continue; // response was ambiguous
        const coverage = result.coverage?.find((c) => c.ref === ref);
        const targetFrom = item.targetFromByRef.get(ref)!;

        if (item.capability === "spot") {
          // `spot` has no interval; advance only to a date actually returned.
          const dates = validation.accepted
            .filter((p) => p.ref === ref)
            .map((p) => p.date)
            .sort();
          if (dates.length === 0) continue;
          commitWatermarks.push({
            capability: item.capability,
            ref,
            target_from: targetFrom,
            last_date: dates[dates.length - 1],
            unavailable_before: null,
          });
          continue;
        }
        if (!coverage) continue; // bounded request with no coverage: say nothing

        if (coverage.complete) {
          // Complete covers the whole window, INCLUDING a genuinely empty one.
          commitWatermarks.push({
            capability: item.capability,
            ref,
            target_from: targetFrom,
            last_date: item.to ?? null,
            unavailable_before: null,
          });
          continue;
        }

        // Incomplete. Prefer the source's EXPLICIT floor over one inferred from
        // the returned span: the inferred form only exists when points came
        // back, and the case that loops is precisely the one where none did.
        const declaredFloor = coverage.unavailableBefore ?? null;
        const inferredFloor = coverage.returned ? coverage.returned.from : null;
        const floor = declaredFloor ?? inferredFloor;
        const recordFloor = floor !== null && floor > targetFrom ? floor : null;

        if (coverage.returned) {
          // Truncated with data: keep the points and the honest floor, and do
          // NOT describe the unreachable prefix as covered.
          commitWatermarks.push({
            capability: item.capability,
            ref,
            target_from: targetFrom,
            last_date: coverage.returned.to,
            unavailable_before: recordFloor,
          });
        } else if (recordFloor !== null) {
          // Nothing came back, but the source told us WHY: the whole requested
          // window predates what it can serve. Persisting the floor (with no
          // last_date, since nothing was committed) is what lets the next
          // planWindow skip forward to it instead of re-requesting the same
          // unreachable chunk forever.
          commitWatermarks.push({
            capability: item.capability,
            ref,
            target_from: targetFrom,
            last_date: null,
            unavailable_before: recordFloor,
          });
        }
        // Otherwise: incomplete, no points, no declared floor — a transient
        // failure. Nothing is known, so the watermark is left untouched.
      }
    }
  } finally {
    clearTimeout(timer);
  }

  for (const attempt of handle.attempts) {
    summary.attempts++;
    if (attempt.status !== null && !summary.statusCodes.includes(attempt.status)) {
      summary.statusCodes.push(attempt.status);
    }
  }
  if (handle.attempts.some((a: HttpAttempt) => a.outcome === "error" || a.outcome === "aborted")) {
    summary.status = summary.status === "ok" ? "partial" : summary.status;
  }

  const lastDates = commitWatermarks.map((w) => w.last_date).filter((d): d is IsoDate => d !== null);
  const counts = await safeCommit(store, {
    source_id: source.id,
    prices,
    series_points: seriesPoints,
    watermarks: commitWatermarks,
    cursor: {
      // A SUMMARY: the least-advanced ref for this source.
      last_date: lastDates.length > 0 ? lastDates.reduce((a, b) => (a < b ? a : b)) : null,
      last_error: summary.errorCode,
    },
  });
  if (counts === null) {
    summary.status = "error";
    summary.errorCode ??= "commit_failed";
  } else {
    summary.written = counts.prices_written + counts.series_written;
    summary.manualProtected = counts.manual_protected;
  }
  summary.durationMs = now().getTime() - startedAt;
  return summary;
}

function pushItem(
  items: WorkItem[],
  capability: SourceCapability,
  ref: string,
  plan: PlannedWindow,
  assetIds: Map<string, string[]>,
  targetFrom: IsoDate,
): void {
  // Batch only when the adapter request would carry the SAME window; merging
  // different windows would silently widen or narrow one of them.
  const existing = items.find((i) => i.capability === capability && i.from === plan.from && i.to === plan.to);
  const target = existing ?? {
    capability,
    refs: [],
    from: capability === "spot" ? undefined : plan.from,
    to: capability === "spot" ? undefined : plan.to,
    assetIdsByRef: new Map<string, string[]>(),
    targetFromByRef: new Map<string, IsoDate>(),
  };
  target.refs.push(ref);
  for (const [k, v] of assetIds) target.assetIdsByRef.set(k, v);
  target.targetFromByRef.set(ref, targetFrom);
  if (!existing) items.push(target);
}
