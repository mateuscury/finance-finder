import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { MarketPack, PriceSource, SeriesDescriptor } from "@/packs/types";
import {
  addDays,
  capabilityForAsset,
  capabilityForSeries,
  DEFAULT_LOOKBACK_DAYS,
  MAX_CHUNK_DAYS,
  maxDate,
  OVERLAP_DAYS,
  planWindow,
  runIngest,
  type CommitPayload,
  type IngestStore,
  type WatermarkRow,
} from "./ingest";
import { createPackHttp } from "./http";

const TODAY = "2026-09-06";

const wm = (over: Partial<WatermarkRow> = {}): WatermarkRow => ({
  capability: "historical",
  ref: "HGLG11",
  targetFrom: "2026-01-01",
  lastDate: null,
  unavailableBefore: null,
  ...over,
});

describe("planWindow", () => {
  it("starts at the earliest trade date when there is no watermark", () => {
    const p = planWindow(TODAY, undefined, "2026-08-01");
    expect(p.from).toBe("2026-08-01");
    expect(p.targetFrom).toBe("2026-08-01");
    expect(p.restarted).toBe(false);
  });

  it("uses a short lookback when a ref has no transactions at all", () => {
    const p = planWindow(TODAY, undefined, undefined);
    expect(p.from).toBe(addDays(TODAY, -DEFAULT_LOOKBACK_DAYS));
  });

  it("resumes just behind the last committed date, with overlap for revisions", () => {
    const p = planWindow(TODAY, wm({ lastDate: "2026-09-01" }), "2026-01-01");
    expect(p.from).toBe(addDays("2026-09-01", -OVERLAP_DAYS));
  });

  it("never resumes before the target, however large the overlap", () => {
    const p = planWindow(TODAY, wm({ targetFrom: "2026-08-30", lastDate: "2026-08-31" }), "2026-08-30");
    expect(p.from).toBe("2026-08-30");
  });

  it("restarts the forward cursor when a new asset needs earlier history", () => {
    // The decisive case: a user adds a holding bought in 2025 to a ref whose
    // watermark already sits in 2026. Resuming at lastDate would leave a
    // permanent hole between the new target and the old one.
    const p = planWindow(TODAY, wm({ targetFrom: "2026-01-01", lastDate: "2026-09-01" }), "2025-03-04");
    expect(p.restarted).toBe(true);
    expect(p.targetFrom).toBe("2025-03-04");
    expect(p.from).toBe("2025-03-04");
  });

  it("does not restart when the new target is not earlier", () => {
    const p = planWindow(TODAY, wm({ targetFrom: "2025-01-01", lastDate: "2026-09-01" }), "2026-05-01");
    expect(p.restarted).toBe(false);
    expect(p.targetFrom).toBe("2025-01-01");
  });

  it("believes a recorded availability floor instead of re-asking nightly", () => {
    const p = planWindow(TODAY, wm({ targetFrom: "2020-01-01", unavailableBefore: "2026-06-08" }), "2020-01-01");
    expect(p.from).toBe("2026-06-08");
  });

  it("caps one chunk so an initial backfill stays resumable", () => {
    const p = planWindow(TODAY, undefined, "2020-01-01");
    expect(p.from).toBe("2020-01-01");
    expect(p.to).toBe(addDays("2020-01-01", MAX_CHUNK_DAYS));
    expect(p.to < TODAY).toBe(true);
  });

  it("never requests past today", () => {
    const p = planWindow(TODAY, wm({ targetFrom: "2026-09-06", lastDate: "2026-09-06" }), "2027-01-01");
    expect(p.from <= TODAY).toBe(true);
    expect(p.to).toBe(TODAY);
  });
});

describe("capability selection", () => {
  const src = (capabilities: PriceSource["capabilities"]): PriceSource => ({ id: "br.x", capabilities }) as PriceSource;

  it("prefers fx for an fx series and series otherwise", () => {
    expect(capabilityForSeries(src(["fx", "historical"]), true)).toBe("fx");
    expect(capabilityForSeries(src(["series"]), false)).toBe("series");
    expect(capabilityForSeries(src(["spot"]), false)).toBeNull();
  });

  it("prefers real history for assets, falling back to spot", () => {
    expect(capabilityForAsset(src(["spot", "historical"]))).toBe("historical");
    expect(capabilityForAsset(src(["spot"]))).toBe("spot");
    expect(capabilityForAsset(src(["series"]))).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// runIngest, against a fake store and stub adapters
// ---------------------------------------------------------------------------

function makeSource(over: Partial<PriceSource> & Pick<PriceSource, "id">): PriceSource {
  return {
    label: over.id,
    homepage: "https://example.test/",
    license: "public-domain",
    auth: "none",
    rateLimit: { requests: 10, perSeconds: 1 },
    capabilities: ["series"],
    fetch: async () => ({ points: [], warnings: [] }),
    ...over,
  } as PriceSource;
}

function makePack(over: Partial<MarketPack> & Pick<MarketPack, "id">): MarketPack {
  return {
    apiVersion: 2,
    name: over.id,
    currency: "BRL",
    locale: "pt-BR",
    instruments: [],
    series: [],
    sources: [],
    calendar: { timezone: "UTC", weekend: [], holidays: () => [], settlement: "T+0" },
    maintainers: ["x"],
    status: "draft",
    ...over,
  } as MarketPack;
}

function makeStore(over: Partial<IngestStore> = {}) {
  const commits: CommitPayload[] = [];
  const store: IngestStore = {
    listEnabledPacks: async () => [["br"]],
    listCursors: async () => [],
    listWatermarks: async () => [],
    listAssets: async () => [],
    earliestTradeDates: async () => ({}),
    commitChunk: async (payload) => {
      commits.push(payload);
      return {
        prices_written: payload.prices.length,
        manual_protected: 0,
        series_written: payload.series_points.length,
        watermarks_advanced: payload.watermarks.length,
      };
    },
    ...over,
  };
  return { store, commits };
}

const httpFactory = (source: PriceSource, signal: AbortSignal, deadline: number) =>
  createPackHttp({
    source,
    mode: "replay",
    signal,
    deadline,
    exchanges: [],
    now: () => 0,
    fetchImpl: (() => {
      throw new Error("no network in tests");
    }) as unknown as typeof fetch,
  });

const CDI: SeriesDescriptor = {
  id: "br.cdi",
  label: "CDI",
  kind: { kind: "rate_daily", dayCount: "BUS/252" },
  sourceId: "br.sgs",
  roles: [],
};

const base = (source: PriceSource, storeOver: Partial<IngestStore> = {}) => {
  const { store, commits } = makeStore(storeOver);
  const pack = makePack({ id: "br", series: [{ ...CDI, sourceId: source.id }], sources: [source] });
  return {
    commits,
    run: () =>
      runIngest({
        scope: { kind: "all_enabled" },
        budgetMs: 60_000,
        now: () => new Date(`${TODAY}T12:00:00Z`),
        store,
        httpFactory,
        env: {},
        registry: [pack],
        reserveMs: 1_000,
      }),
  };
};

describe("runIngest — watermark advancement", () => {
  it("advances through `to` on a coverage-complete EMPTY response", async () => {
    // The point of structured coverage: "successfully checked, nothing there"
    // must move the cursor, or a holiday window is re-requested forever.
    const source = makeSource({
      id: "br.sgs",
      fetch: async (req) => ({
        points: [],
        warnings: [],
        coverage: [{ ref: "br.cdi", requested: { from: req.from!, to: req.to! }, returned: null, complete: true }],
      }),
    });
    const { run, commits } = base(source);
    await run();
    expect(commits[0].watermarks).toEqual([
      {
        capability: "series",
        ref: "br.cdi",
        target_from: expect.any(String),
        last_date: commits[0].watermarks[0].last_date,
        unavailable_before: null,
      },
    ]);
    expect(commits[0].watermarks[0].last_date).toBe(TODAY);
  });

  it("does NOT advance when coverage is incomplete and nothing came back", async () => {
    const source = makeSource({
      id: "br.sgs",
      fetch: async (req) => ({
        points: [],
        warnings: ["upstream failed"],
        coverage: [{ ref: "br.cdi", requested: { from: req.from!, to: req.to! }, returned: null, complete: false }],
      }),
    });
    const { run, commits } = base(source);
    await run();
    expect(commits[0].watermarks).toEqual([]);
  });

  it("records an availability floor for a truncated response instead of claiming coverage", async () => {
    const source = makeSource({
      id: "br.sgs",
      fetch: async (req) => ({
        points: [{ ref: "br.cdi", date: "2026-09-02", value: "0.0004", currency: null }],
        warnings: ["history before the plan limit is unavailable"],
        coverage: [
          {
            ref: "br.cdi",
            requested: { from: req.from!, to: req.to! },
            returned: { from: "2026-09-02", to: "2026-09-02" },
            complete: false,
          },
        ],
      }),
    });
    const { run, commits } = base(source);
    await run();
    const [watermark] = commits[0].watermarks;
    expect(watermark.last_date).toBe("2026-09-02");
    expect(watermark.unavailable_before).toBe("2026-09-02");
    // The points still land: truncation loses history, not the data we got.
    expect(commits[0].series_points).toHaveLength(1);
  });

  it("does not advance a ref whose response was ambiguous", async () => {
    const source = makeSource({
      id: "br.sgs",
      fetch: async (req) => ({
        // A duplicate primary key makes the response ambiguous for br.cdi.
        points: [
          { ref: "br.cdi", date: "2026-09-02", value: "0.0004", currency: null },
          { ref: "br.cdi", date: "2026-09-02", value: "0.0009", currency: null },
        ],
        warnings: [],
        coverage: [
          {
            ref: "br.cdi",
            requested: { from: req.from!, to: req.to! },
            returned: { from: "2026-09-02", to: "2026-09-02" },
            complete: true,
          },
        ],
      }),
    });
    const { run, commits } = base(source);
    await run();
    expect(commits[0].watermarks).toEqual([]);
  });

  it("rejects invalid points instead of writing them, and reports partial", async () => {
    const source = makeSource({
      id: "br.sgs",
      fetch: async (req) => ({
        // A scalar rate must not carry a currency.
        points: [{ ref: "br.cdi", date: "2026-09-02", value: "0.0004", currency: "BRL" }],
        warnings: [],
        coverage: [{ ref: "br.cdi", requested: { from: req.from!, to: req.to! }, returned: null, complete: true }],
      }),
    });
    const { run, commits } = base(source);
    const summary = await run();
    expect(commits[0].series_points).toEqual([]);
    expect(summary.sources[0].rejected).toBe(1);
    expect(summary.sources[0].status).toBe("partial");
  });
});

describe("runIngest — scheduling and safety", () => {
  it("skips a source with a missing API key without calling the adapter", async () => {
    let called = false;
    const source = makeSource({
      id: "br.keyed",
      auth: "api_key",
      envVars: ["BRAPI_TOKEN"],
      fetch: async () => {
        called = true;
        return { points: [], warnings: [] };
      },
    });
    const { run, commits } = base(source);
    const summary = await run();
    expect(called).toBe(false);
    expect(summary.sources[0].status).toBe("skipped");
    expect(summary.sources[0].errorCode).toBe("missing_env:BRAPI_TOKEN");
    // The cursor records the safe reason so the UI can explain it.
    expect(commits[0].cursor.last_error).toBe("missing_env:BRAPI_TOKEN");
  });

  it("orders sources least-recently-run first, then stably by id", async () => {
    const order: string[] = [];
    const mk = (id: string) =>
      makeSource({
        id,
        fetch: async (req) => {
          order.push(id);
          return {
            points: [],
            warnings: [],
            coverage: [
              { ref: req.refs[0], requested: { from: req.from!, to: req.to! }, returned: null, complete: true },
            ],
          };
        },
      });
    const pack = makePack({
      id: "br",
      series: [
        { ...CDI, id: "br.a", sourceId: "br.a" },
        { ...CDI, id: "br.b", sourceId: "br.b" },
        { ...CDI, id: "br.c", sourceId: "br.c" },
      ],
      sources: [mk("br.a"), mk("br.b"), mk("br.c")],
    });
    const { store } = makeStore({
      listCursors: async () => [
        { sourceId: "br.a", lastRunAt: "2026-09-06T00:00:00Z" },
        { sourceId: "br.b", lastRunAt: "2026-09-01T00:00:00Z" },
        // br.c has never run -> first.
      ],
    });
    await runIngest({
      scope: { kind: "all_enabled" },
      budgetMs: 60_000,
      now: () => new Date(`${TODAY}T12:00:00Z`),
      store,
      httpFactory,
      env: {},
      registry: [pack],
      reserveMs: 1_000,
    });
    expect(order).toEqual(["br.c", "br.b", "br.a"]);
  });

  it("stops starting sources once only the commit reserve remains", async () => {
    let calls = 0;
    const mk = (id: string) =>
      makeSource({
        id,
        fetch: async () => {
          calls++;
          return { points: [], warnings: [] };
        },
      });
    const pack = makePack({
      id: "br",
      series: [
        { ...CDI, id: "br.a", sourceId: "br.a" },
        { ...CDI, id: "br.b", sourceId: "br.b" },
      ],
      sources: [mk("br.a"), mk("br.b")],
    });
    const { store } = makeStore();
    let t = Date.parse(`${TODAY}T12:00:00Z`);
    const summary = await runIngest({
      scope: { kind: "all_enabled" },
      budgetMs: 10_000,
      // Time jumps past the budget after the first source.
      now: () => new Date((t += 6_000)),
      store,
      httpFactory,
      env: {},
      registry: [pack],
      reserveMs: 5_000,
    });
    expect(summary.sources.some((s) => s.status === "budget_exhausted")).toBe(true);
    expect(calls).toBeLessThan(2);
  });

  it("writes one price row per holder of the same market ref", async () => {
    const instrument = {
      id: "br.fii",
      label: "FII",
      valuation: { kind: "market_price" as const, sourceId: "br.quotes" },
      metadataSchema: z.object({}),
      identifier: "ticker" as const,
      quoteCurrency: "BRL",
    };
    const source = makeSource({
      id: "br.quotes",
      capabilities: ["spot", "historical"],
      fetch: async (req) => ({
        points: [{ ref: "HGLG11", date: "2026-09-04", value: "148.3", currency: "BRL" }],
        warnings: [],
        coverage: [
          {
            ref: "HGLG11",
            requested: { from: req.from!, to: req.to! },
            returned: { from: "2026-09-04", to: "2026-09-04" },
            complete: true,
          },
        ],
      }),
    });
    const pack = makePack({ id: "br", instruments: [instrument], sources: [source] });
    const { store, commits } = makeStore({
      listAssets: async () => [
        { assetId: "asset-user-1", packId: "br", instrumentKind: "br.fii", identifier: "HGLG11" },
        { assetId: "asset-user-2", packId: "br", instrumentKind: "br.fii", identifier: "HGLG11" },
      ],
      earliestTradeDates: async () => ({ HGLG11: "2026-09-01" }),
    });
    await runIngest({
      scope: { kind: "all_enabled" },
      budgetMs: 60_000,
      now: () => new Date(`${TODAY}T12:00:00Z`),
      store,
      httpFactory,
      env: {},
      registry: [pack],
      reserveMs: 1_000,
    });
    // ONE fetched quote, TWO price rows: each user's manual-price conflict is
    // then resolved independently inside commit_ingest_chunk.
    expect(commits[0].prices).toEqual([
      { asset_id: "asset-user-1", date: "2026-09-04", price: "148.3", currency: "BRL" },
      { asset_id: "asset-user-2", date: "2026-09-04", price: "148.3", currency: "BRL" },
    ]);
  });

  it("survives an adapter that throws, reporting a safe code", async () => {
    const source = makeSource({
      id: "br.sgs",
      fetch: async () => {
        throw new Error("upstream exploded with secret=abc");
      },
    });
    const { run } = base(source);
    const summary = await run();
    expect(summary.sources[0].status).toBe("error");
    expect(summary.sources[0].errorCode).toBe("adapter_threw");
    expect(JSON.stringify(summary)).not.toContain("secret=abc");
    expect(summary.ok).toBe(false);
  });

  it("activates a pack's dependencies transitively", async () => {
    const globalPack = makePack({ id: "global" });
    const brPack = makePack({ id: "br", dependencies: ["global"] });
    const { store } = makeStore({ listEnabledPacks: async () => [["br"]] });
    const summary = await runIngest({
      scope: { kind: "all_enabled" },
      budgetMs: 60_000,
      now: () => new Date(`${TODAY}T12:00:00Z`),
      store,
      httpFactory,
      env: {},
      registry: [globalPack, brPack],
      reserveMs: 1_000,
    });
    expect(summary.activatedPacks).toEqual(["global", "br"]);
  });

  it("reports a commit failure rather than claiming success", async () => {
    const source = makeSource({
      id: "br.sgs",
      fetch: async (req) => ({
        points: [],
        warnings: [],
        coverage: [{ ref: "br.cdi", requested: { from: req.from!, to: req.to! }, returned: null, complete: true }],
      }),
    });
    const { run } = base(source, {
      commitChunk: async () => {
        throw new Error("db down");
      },
    });
    const summary = await run();
    expect(summary.sources[0].status).toBe("error");
    expect(summary.sources[0].errorCode).toBe("commit_failed");
  });
});

describe("runIngest — an unreachable backfill must not loop forever", () => {
  /** A source that can only ever serve dates on/after `floor`. */
  const cappedSource = (floor: string) =>
    makeSource({
      id: "br.capped",
      capabilities: ["spot", "historical"],
      fetch: async (req) => {
        const from = req.from!;
        const to = req.to!;
        const reachable = from >= floor;
        if (reachable) {
          return {
            points: [{ ref: "HGLG11", date: maxDate(from, floor), value: "148.3", currency: "BRL" }],
            warnings: [],
            coverage: [
              {
                ref: "HGLG11",
                requested: { from, to },
                returned: { from: maxDate(from, floor), to: maxDate(from, floor) },
                complete: true,
              },
            ],
          };
        }
        // Whole window predates what the source can serve.
        return {
          points: [],
          warnings: ["history before the plan limit is unavailable"],
          coverage: [
            { ref: "HGLG11", requested: { from, to }, returned: null, complete: false, unavailableBefore: floor },
          ],
        };
      },
    });

  const instrument = {
    id: "br.fii",
    label: "FII",
    valuation: { kind: "market_price" as const, sourceId: "br.capped" },
    metadataSchema: z.object({}),
    identifier: "ticker" as const,
    quoteCurrency: "BRL",
  };

  it("records the declared floor with no points, then reaches data on the next run", async () => {
    const FLOOR = "2026-06-08";
    const source = cappedSource(FLOOR);
    const pack = makePack({ id: "br", instruments: [instrument], sources: [source] });

    // Persistent watermark state across runs, as the real RPC would keep.
    let stored: WatermarkRow[] = [];
    const commits: CommitPayload[] = [];
    const store: IngestStore = {
      listEnabledPacks: async () => [["br"]],
      listCursors: async () => [],
      listWatermarks: async () => stored,
      listAssets: async () => [{ assetId: "a1", packId: "br", instrumentKind: "br.fii", identifier: "HGLG11" }],
      // Bought well before the source's floor.
      earliestTradeDates: async () => ({ HGLG11: "2025-01-01" }),
      commitChunk: async (payload) => {
        commits.push(payload);
        for (const w of payload.watermarks) {
          const existing = stored.find((s) => s.ref === w.ref && s.capability === w.capability);
          const restarted = existing !== undefined && w.target_from < existing.targetFrom;
          const next: WatermarkRow = {
            capability: w.capability,
            ref: w.ref,
            targetFrom: w.target_from,
            lastDate: restarted
              ? w.last_date
              : ([existing?.lastDate ?? null, w.last_date]
                  .filter((d): d is string => d !== null)
                  .sort()
                  .pop() ?? null),
            unavailableBefore: w.unavailable_before,
          };
          stored = [...stored.filter((s) => !(s.ref === w.ref && s.capability === w.capability)), next];
        }
        return {
          prices_written: payload.prices.length,
          manual_protected: 0,
          series_written: payload.series_points.length,
          watermarks_advanced: payload.watermarks.length,
        };
      },
    };

    const run = () =>
      runIngest({
        scope: { kind: "all_enabled" },
        budgetMs: 60_000,
        now: () => new Date(`${TODAY}T12:00:00Z`),
        store,
        httpFactory,
        env: {},
        registry: [pack],
        reserveMs: 1_000,
      });

    // Run 1: target is 2025-01-01, the chunk is entirely unreachable.
    await run();
    expect(commits[0].prices).toEqual([]);
    expect(commits[0].watermarks[0]).toMatchObject({ last_date: null, unavailable_before: FLOOR });

    // Run 2 must NOT repeat the same unreachable window — the recorded floor
    // moves the request forward to what the source can actually serve.
    await run();
    const secondRequest = commits[1];
    expect(secondRequest.prices.length, "second run reached real data").toBeGreaterThan(0);
    expect(secondRequest.watermarks[0].last_date).not.toBeNull();

    // Run 3 keeps making progress rather than oscillating.
    await run();
    expect(commits[2].watermarks[0].last_date).not.toBeNull();
    expect(stored[0].lastDate).not.toBeNull();
  });

  it("still refuses to advance when a failure declares no floor", async () => {
    const source = makeSource({
      id: "br.sgs",
      fetch: async (req) => ({
        points: [],
        warnings: ["upstream down"],
        coverage: [{ ref: "br.cdi", requested: { from: req.from!, to: req.to! }, returned: null, complete: false }],
      }),
    });
    const { run, commits } = base(source);
    await run();
    expect(commits[0].watermarks).toEqual([]);
  });
});

describe("runIngest — scope semantics", () => {
  it("a new_packs run backfills series and prices no holdings", async () => {
    const instrument = {
      id: "br.fii",
      label: "FII",
      valuation: { kind: "market_price" as const, sourceId: "br.mixed" },
      metadataSchema: z.object({}),
      identifier: "ticker" as const,
      quoteCurrency: "BRL",
    };
    const seen: string[] = [];
    const source = makeSource({
      id: "br.mixed",
      capabilities: ["series", "spot", "historical"],
      fetch: async (req) => {
        seen.push(`${req.capability}:${req.refs.join(",")}`);
        return {
          points: [],
          warnings: [],
          coverage: req.refs.map((ref) => ({
            ref,
            requested: { from: req.from!, to: req.to! },
            returned: null,
            complete: true,
          })),
        };
      },
    });
    const pack = makePack({
      id: "br",
      instruments: [instrument],
      series: [{ ...CDI, sourceId: "br.mixed" }],
      sources: [source],
    });
    const { store } = makeStore({
      // Even if the store handed assets over, the scheduler must not price them.
      listAssets: async () => [{ assetId: "a1", packId: "br", instrumentKind: "br.fii", identifier: "HGLG11" }],
      earliestTradeDates: async () => ({ HGLG11: "2026-01-01" }),
    });
    await runIngest({
      scope: { kind: "new_packs", packIds: ["br"] },
      budgetMs: 60_000,
      now: () => new Date(`${TODAY}T12:00:00Z`),
      store,
      httpFactory,
      env: {},
      registry: [pack],
      reserveMs: 1_000,
    });
    expect(seen).toEqual(["series:br.cdi"]);
    expect(seen.some((s) => s.includes("HGLG11"))).toBe(false);
  });

  it("an all_enabled run does price holdings", async () => {
    const instrument = {
      id: "br.fii",
      label: "FII",
      valuation: { kind: "market_price" as const, sourceId: "br.mixed" },
      metadataSchema: z.object({}),
      identifier: "ticker" as const,
      quoteCurrency: "BRL",
    };
    const seen: string[] = [];
    const source = makeSource({
      id: "br.mixed",
      capabilities: ["spot", "historical"],
      fetch: async (req) => {
        seen.push(`${req.capability}:${req.refs.join(",")}`);
        return { points: [], warnings: [] };
      },
    });
    const pack = makePack({ id: "br", instruments: [instrument], sources: [source] });
    const { store } = makeStore({
      listAssets: async () => [{ assetId: "a1", packId: "br", instrumentKind: "br.fii", identifier: "HGLG11" }],
      earliestTradeDates: async () => ({ HGLG11: "2026-01-01" }),
    });
    await runIngest({
      scope: { kind: "all_enabled" },
      budgetMs: 60_000,
      now: () => new Date(`${TODAY}T12:00:00Z`),
      store,
      httpFactory,
      env: {},
      registry: [pack],
      reserveMs: 1_000,
    });
    expect(seen).toEqual(["historical:HGLG11"]);
  });
});
