import { beforeEach, describe, expect, it, vi } from "vitest";

const created = { serviceClients: 0, stores: 0 };
vi.mock("@/lib/supabase/service", () => ({
  createServiceRoleClient: () => {
    created.serviceClients++;
    return {};
  },
}));
vi.mock("@/lib/jobs/snapshots-store", () => ({
  createSnapshotStore: () => {
    created.stores++;
    return {};
  },
}));
const runSnapshots = vi.fn();
vi.mock("@/lib/jobs/snapshots", () => ({ runSnapshots: (...args: unknown[]) => runSnapshots(...args) }));

const { GET, maxDuration } = await import("./route");

const SECRET = "x".repeat(48);
const authorized = () =>
  new Request("https://app.test/api/cron/snapshots", { headers: { authorization: `Bearer ${SECRET}` } });

beforeEach(() => {
  created.serviceClients = 0;
  created.stores = 0;
  runSnapshots.mockReset();
  process.env.CRON_SECRET = SECRET;
});

describe("GET /api/cron/snapshots", () => {
  it("rejects an unauthorized request before any database work", async () => {
    const res = await GET(new Request("https://app.test/api/cron/snapshots"));
    expect(res.status).toBe(401);
    expect(created.serviceClients).toBe(0);
    expect(created.stores).toBe(0);
    expect(runSnapshots).not.toHaveBeenCalled();
  });

  it("runs all users under the cron budget and returns counts only", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    runSnapshots.mockResolvedValue({
      ok: true,
      durationMs: 12,
      users: [
        {
          userId: "u1",
          status: "complete",
          from: "2026-02-10",
          to: "2026-02-27",
          daysBuilt: 12,
          rowsWritten: 70,
          errorCode: null,
        },
      ],
    });
    const res = await GET(authorized());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.users).toEqual([
      { status: "complete", from: "2026-02-10", to: "2026-02-27", daysBuilt: 12, rowsWritten: 70, errorCode: null },
    ]);
    expect(JSON.stringify(body)).not.toContain("u1");
    expect(runSnapshots.mock.calls[0][0]).toMatchObject({ scope: { kind: "all_users" } });
    expect(created.serviceClients).toBe(1);
    // The run log line (Milestone 4 D-19) carries the same counts and no user id.
    expect(log).toHaveBeenCalledTimes(1);
    const line = String(log.mock.calls[0][0]);
    expect(JSON.parse(line)).toMatchObject({ job: "snapshots", ok: true });
    expect(line).not.toContain("u1");
    log.mockRestore();
  });

  it("reports a fatal failure as a fixed code", async () => {
    runSnapshots.mockRejectedValue(new Error("postgres://user:pass@host/db exploded"));
    const res = await GET(authorized());
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).toContain("scheduler_failed");
    expect(text).not.toContain("postgres://");
  });

  it("exports the recorded maxDuration", () => {
    expect(maxDuration).toBe(60);
  });
});
