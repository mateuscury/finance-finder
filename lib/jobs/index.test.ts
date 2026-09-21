import { beforeEach, describe, expect, it, vi } from "vitest";
import { CRON_RESERVE_MS, ingestBudgetMs } from "@/lib/cron/budget";

const runIngest = vi.fn();
const runSnapshots = vi.fn();
const deleteUser = vi.fn();
vi.mock("@/lib/supabase/service", () => ({
  createServiceRoleClient: () => ({ auth: { admin: { deleteUser: (id: string) => deleteUser(id) } } }),
}));
vi.mock("@/lib/packs/ingest", () => ({ runIngest: (...a: unknown[]) => runIngest(...a) }));
vi.mock("@/lib/jobs/snapshots", () => ({ runSnapshots: (...a: unknown[]) => runSnapshots(...a) }));
vi.mock("@/lib/packs/store", () => ({ createIngestStore: () => ({}) }));
vi.mock("@/lib/jobs/snapshots-store", () => ({ createSnapshotStore: () => ({}) }));

const { deleteUserJob, ingestJob, priceThenSnapshot, remainingBudgetMs, snapshotsJob } = await import("./index");

beforeEach(() => {
  runIngest.mockReset();
  runSnapshots.mockReset();
  deleteUser.mockReset();
});

describe("after-response jobs", () => {
  it("remainingBudgetMs subtracts what the action spent and never drops below one reserve", () => {
    expect(remainingBudgetMs(0)).toBe(ingestBudgetMs());
    expect(remainingBudgetMs(5_000)).toBe(ingestBudgetMs() - 5_000);
    expect(remainingBudgetMs(10 ** 9)).toBe(CRON_RESERVE_MS);
    expect(remainingBudgetMs(-100)).toBe(ingestBudgetMs());
  });

  it("ingestJob and snapshotsJob hand the runners the remaining budget and the scope", async () => {
    runIngest.mockResolvedValue({ ok: true });
    runSnapshots.mockResolvedValue({ ok: true });
    await ingestJob({ kind: "unpriced" }, 1_000);
    expect(runIngest.mock.calls[0][0]).toMatchObject({
      scope: { kind: "unpriced" },
      budgetMs: ingestBudgetMs() - 1_000,
    });
    await snapshotsJob({ kind: "users", userIds: ["u"] }, 2_000);
    expect(runSnapshots.mock.calls[0][0]).toMatchObject({
      scope: { kind: "users", userIds: ["u"] },
      budgetMs: ingestBudgetMs() - 2_000,
    });
  });

  it("priceThenSnapshot runs the ingest first and the snapshots for the given users after", async () => {
    const order: string[] = [];
    runIngest.mockImplementation(async () => (order.push("ingest"), { ok: true }));
    runSnapshots.mockImplementation(async () => (order.push("snapshots"), { ok: true }));
    const r = await priceThenSnapshot({ kind: "assets", assetIds: ["a"] }, ["u"]);
    expect(order).toEqual(["ingest", "snapshots"]);
    expect(r).toEqual({ ingest: { ok: true }, snapshots: { ok: true } });
    expect(runSnapshots.mock.calls[0][0]).toMatchObject({ scope: { kind: "users", userIds: ["u"] } });
  });

  it("deleteUserJob deletes exactly the id it is given and reports the outcome", async () => {
    deleteUser.mockResolvedValue({ error: null });
    expect(await deleteUserJob("u1")).toEqual({ ok: true });
    expect(deleteUser).toHaveBeenCalledWith("u1");
    deleteUser.mockResolvedValue({ error: { message: "x" } });
    expect(await deleteUserJob("u1")).toEqual({ ok: false });
  });
});
