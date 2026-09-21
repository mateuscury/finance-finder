import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The service-role client and the store are mocked so the test can prove the
 * ORDER of operations: an unauthorized request must not construct either.
 */
const created = { serviceClients: 0, stores: 0 };
vi.mock("@/lib/supabase/service", () => ({
  createServiceRoleClient: () => {
    created.serviceClients++;
    return {};
  },
}));
vi.mock("@/lib/packs/store", () => ({
  createIngestStore: () => {
    created.stores++;
    return {};
  },
}));

const runIngest = vi.fn();
vi.mock("@/lib/packs/ingest", () => ({ runIngest: (...args: unknown[]) => runIngest(...args) }));

const { GET, maxDuration } = await import("./route");

const SECRET = "x".repeat(48);
const authorized = () =>
  new Request("https://app.test/api/cron/prices", { headers: { authorization: `Bearer ${SECRET}` } });

beforeEach(() => {
  created.serviceClients = 0;
  created.stores = 0;
  runIngest.mockReset();
  process.env.CRON_SECRET = SECRET;
});

describe("GET /api/cron/prices", () => {
  it("rejects an unauthorized request before any database or network work", async () => {
    const res = await GET(new Request("https://app.test/api/cron/prices"));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
    // The decisive assertion: nothing was constructed and nothing ran.
    expect(created.serviceClients).toBe(0);
    expect(created.stores).toBe(0);
    expect(runIngest).not.toHaveBeenCalled();
  });

  it("rejects a wrong secret the same way", async () => {
    const res = await GET(
      new Request("https://app.test/api/cron/prices", { headers: { authorization: `Bearer ${"y".repeat(48)}` } }),
    );
    expect(res.status).toBe(401);
    expect(runIngest).not.toHaveBeenCalled();
  });

  it("fails closed when CRON_SECRET is absent or too weak", async () => {
    for (const secret of [undefined, "short"]) {
      if (secret === undefined) delete process.env.CRON_SECRET;
      else process.env.CRON_SECRET = secret;
      expect((await GET(authorized())).status).toBe(401);
    }
    expect(runIngest).not.toHaveBeenCalled();
  });

  it("returns a redacted run summary for an authorized request, not 501", async () => {
    runIngest.mockResolvedValue({
      ok: true,
      durationMs: 1234,
      activatedPacks: ["global", "br"],
      activationWarnings: 0,
      sources: [
        {
          sourceId: "br.bcb_sgs",
          status: "ok",
          statusCodes: [200],
          attempts: 2,
          durationMs: 300,
          accepted: 6,
          rejected: 0,
          written: 6,
          manualProtected: 1,
          warnings: 0,
          errorCode: null,
        },
      ],
    });
    const res = await GET(authorized());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.sources[0]).toMatchObject({ sourceId: "br.bcb_sgs", status: "ok", manualProtected: 1 });
    expect(created.serviceClients).toBe(1);
  });

  it("returns 200 with ok:false when a run completes with per-source failures", async () => {
    // Vercel does not retry a failed cron, so a completed-but-degraded run is
    // reported as completed; 500 is reserved for a fatal failure.
    runIngest.mockResolvedValue({
      ok: false,
      durationMs: 10,
      activatedPacks: ["br"],
      activationWarnings: 1,
      sources: [
        {
          sourceId: "br.brapi",
          status: "error",
          statusCodes: [503],
          attempts: 3,
          durationMs: 5,
          accepted: 0,
          rejected: 0,
          written: 0,
          manualProtected: 0,
          warnings: 2,
          errorCode: "adapter_threw",
        },
      ],
    });
    const res = await GET(authorized());
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(false);
  });

  it("returns 500 with a fixed code, echoing nothing, when the scheduler dies", async () => {
    runIngest.mockRejectedValue(new Error("postgres://user:hunter2@db.internal/postgres unreachable"));
    const res = await GET(authorized());
    expect(res.status).toBe(500);
    const text = JSON.stringify(await res.json());
    expect(JSON.parse(text)).toEqual({ ok: false, errorCode: "scheduler_failed" });
    expect(text).not.toContain("hunter2");
    expect(text).not.toContain("db.internal");
  });

  it("never leaks a URL, ref, price or warning string into the response", async () => {
    runIngest.mockResolvedValue({
      ok: true,
      durationMs: 1,
      activatedPacks: ["br"],
      activationWarnings: 0,
      sources: [
        {
          sourceId: "br.brapi",
          status: "ok",
          statusCodes: [200],
          attempts: 1,
          durationMs: 1,
          accepted: 1,
          rejected: 0,
          written: 1,
          manualProtected: 0,
          warnings: 1,
          errorCode: null,
          // Fields the route must DROP even if the scheduler ever carried them.
          warningMessages: ["brapi: something about HGLG11"],
          urls: ["https://brapi.dev/api/quote/HGLG11?token=secret"],
          points: [{ ref: "HGLG11", value: "148.3" }],
        },
      ],
    });
    const text = JSON.stringify(await (await GET(authorized())).json());
    for (const forbidden of ["HGLG11", "148.3", "https://", "token=", "secret"]) {
      expect(text, `response leaked '${forbidden}'`).not.toContain(forbidden);
    }
  });

  it("declares a maxDuration Vercel accepts without Fluid compute", () => {
    expect(maxDuration).toBe(60);
  });
});
