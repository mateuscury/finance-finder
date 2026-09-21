import { describe, expect, it } from "vitest";
import { PACKS } from "@/packs";
import type { MarketPack } from "@/packs/types";
import { fakeClient } from "@/lib/testing/fake-client";
import { changeBaseCurrency, setEnabledPacks, stampExport, updatePreferences } from "./settings";

const U = "11111111-1111-4111-8111-111111111111";
const unmaintained: MarketPack = { ...PACKS[0], id: "zz", name: "Dead", status: "unmaintained" };

describe("setEnabledPacks", () => {
  it("refuses unknown and unmaintained packs, allows draft, and reports what is newly enabled", async () => {
    const c = fakeClient({ user_settings: { select: { data: { enabled_packs: ["br"] } }, upsert: { data: null } } });
    expect(await setEnabledPacks(c.client, U, PACKS, ["nope"])).toEqual({
      ok: false,
      reason: "unknown_kind",
      fields: ["enabled_packs"],
    });
    expect(await setEnabledPacks(c.client, U, [...PACKS, unmaintained], ["zz"])).toEqual({
      ok: false,
      reason: "invalid_input",
      fields: ["enabled_packs"],
    });
    expect(await setEnabledPacks(c.client, U, PACKS, ["br", "global", "br"])).toEqual({
      ok: true,
      value: { newlyEnabled: ["global"] },
    });
    expect(c.calls.find((x) => x.op === "upsert")!.payload).toEqual({ user_id: U, enabled_packs: ["br", "global"] });
  });

  it("an empty selection disables everything", async () => {
    const c = fakeClient({ user_settings: { select: { data: { enabled_packs: ["br"] } }, upsert: { data: null } } });
    expect(await setEnabledPacks(c.client, U, PACKS, [])).toEqual({ ok: true, value: { newlyEnabled: [] } });
  });
});

describe("updatePreferences / stampExport", () => {
  it("validates theme and locale, and stamps last_export_at as ISO text", async () => {
    const c = fakeClient({ user_settings: { upsert: { data: null } } });
    expect(await updatePreferences(c.client, U, { theme: "neon", locale: "pt-BR" })).toEqual({
      ok: false,
      reason: "invalid_input",
      fields: ["theme"],
    });
    expect(await updatePreferences(c.client, U, { theme: "dark", locale: "PT" })).toEqual({
      ok: false,
      reason: "invalid_input",
      fields: ["locale"],
    });
    // Well-formed but not shipped: no dictionary, so refused (decision 34).
    expect(await updatePreferences(c.client, U, { theme: "dark", locale: "en-GB" })).toEqual({
      ok: false,
      reason: "invalid_input",
      fields: ["locale"],
    });
    expect(await updatePreferences(c.client, U, { theme: "dark", locale: "en" })).toEqual({
      ok: true,
      value: undefined,
    });
    expect(await stampExport(c.client, U, new Date("2026-09-20T12:00:00Z"))).toEqual({ ok: true, value: undefined });
    expect(c.calls.at(-1)!.payload).toEqual({ user_id: U, last_export_at: "2026-09-20T12:00:00.000Z" });
  });
});

describe("error paths surface as closed reasons, never a message", () => {
  const dbError = { error: { code: "XX000", message: "internal error at postgres://user:pw@host" } };

  it("changeBaseCurrency: invalid input, a failed read, a failed count, a failed write", async () => {
    const c = fakeClient({});
    expect(await changeBaseCurrency(c.client, U, { base_currency: "br" })).toMatchObject({
      ok: false,
      reason: "invalid_input",
    });
    expect(c.calls).toHaveLength(0);

    const readFails = fakeClient({ user_settings: { select: dbError } });
    expect(await changeBaseCurrency(readFails.client, U, { base_currency: "USD" })).toEqual({
      ok: false,
      reason: "write_failed",
    });

    const countFails = fakeClient({
      user_settings: { select: { data: { base_currency: "BRL" } } },
      transactions: { select: dbError },
    });
    expect(await changeBaseCurrency(countFails.client, U, { base_currency: "USD" })).toEqual({
      ok: false,
      reason: "write_failed",
    });

    const writeFails = fakeClient({
      user_settings: { select: { data: { base_currency: "BRL" } }, upsert: dbError },
      transactions: { select: { count: 0 } },
    });
    expect(await changeBaseCurrency(writeFails.client, U, { base_currency: "USD" })).toEqual({
      ok: false,
      reason: "write_failed",
    });
  });

  it("setEnabledPacks: a failed read and a failed write; a missing settings row counts as nothing enabled", async () => {
    const readFails = fakeClient({ user_settings: { select: dbError } });
    expect(await setEnabledPacks(readFails.client, U, PACKS, ["br"])).toEqual({ ok: false, reason: "write_failed" });
    const writeFails = fakeClient({ user_settings: { select: { data: null }, upsert: dbError } });
    expect(await setEnabledPacks(writeFails.client, U, PACKS, ["br"])).toEqual({ ok: false, reason: "write_failed" });
    const fresh = fakeClient({ user_settings: { select: { data: null }, upsert: { data: null } } });
    expect(await setEnabledPacks(fresh.client, U, PACKS, ["br", "br"])).toEqual({
      ok: true,
      value: { newlyEnabled: ["br"] },
    });
  });

  it("updatePreferences and stampExport report a refused write", async () => {
    const c = fakeClient({ user_settings: { upsert: dbError } });
    expect(await updatePreferences(c.client, U, { theme: "dark", locale: "en" })).toEqual({
      ok: false,
      reason: "write_failed",
    });
    expect(await stampExport(c.client, U)).toEqual({ ok: false, reason: "write_failed" });
  });
});
