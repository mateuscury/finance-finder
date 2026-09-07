import { describe, expect, it } from "vitest";
import type { MarketPack } from "@/packs/types";
import { activateFromStore, readEnabledPackIds, resolveActivation, type EnabledPacksStore } from "./activate";

const pack = (id: string, dependencies?: string[]): MarketPack =>
  ({
    apiVersion: 2,
    id,
    name: id,
    currency: "BRL",
    locale: "pt-BR",
    instruments: [],
    series: [],
    sources: [],
    calendar: { timezone: "UTC", weekend: [], holidays: () => [], settlement: "T+0" },
    maintainers: ["x"],
    status: "draft",
    dependencies,
  }) as unknown as MarketPack;

const REGISTRY = [pack("global"), pack("br", ["global"]), pack("uk", ["global"]), pack("xx", ["uk"])];

const ids = (r: { packs: MarketPack[] }) => r.packs.map((p) => p.id);

describe("resolveActivation", () => {
  it("activates nothing for empty settings", () => {
    const r = resolveActivation(REGISTRY, []);
    expect(r.packs).toEqual([]);
    expect(r.warnings).toEqual([]);
  });

  it("pulls in a declared dependency: enabling 'br' also activates 'global'", () => {
    expect(ids(resolveActivation(REGISTRY, ["br"]))).toEqual(["global", "br"]);
  });

  it("resolves a multi-hop dependency chain", () => {
    expect(ids(resolveActivation(REGISTRY, ["xx"]))).toEqual(["global", "uk", "xx"]);
  });

  it("treats duplicate ids as one activation", () => {
    expect(ids(resolveActivation(REGISTRY, ["br", "br", "global"]))).toEqual(["global", "br"]);
  });

  it("drops an unknown id with a warning instead of failing the whole run", () => {
    const r = resolveActivation(REGISTRY, ["br", "zz"]);
    expect(ids(r)).toEqual(["global", "br"]);
    expect(r.unknown).toEqual(["zz"]);
    expect(r.warnings).toEqual(["activation: ignoring unknown pack 'zz'"]);
  });

  it("warns once per unknown id, however many users enabled it", () => {
    expect(resolveActivation(REGISTRY, ["zz", "zz", "zz"]).warnings).toHaveLength(1);
  });

  it("ignores an unknown dependency without dropping its dependant", () => {
    const r = resolveActivation([pack("br", ["nope"])], ["br"]);
    expect(ids(r)).toEqual(["br"]);
    expect(r.unknown).toEqual(["nope"]);
  });

  it("refuses a dependency cycle rather than looping", () => {
    const cyclic = [pack("a", ["b"]), pack("b", ["a"])];
    expect(() => resolveActivation(cyclic, ["a"])).toThrow(/cycle: a -> b -> a/);
  });

  it("refuses a self-referential pack", () => {
    expect(() => resolveActivation([pack("a", ["a"])], ["a"])).toThrow(/cycle/);
  });

  it("returns packs in registry order, not request order", () => {
    expect(ids(resolveActivation(REGISTRY, ["xx", "br"]))).toEqual(["global", "br", "uk", "xx"]);
  });

  it("shares a dependency between two activated packs without duplicating it", () => {
    expect(ids(resolveActivation(REGISTRY, ["br", "uk"]))).toEqual(["global", "br", "uk"]);
  });
});

describe("readEnabledPackIds", () => {
  const storeOf = (pages: string[][][]): { store: EnabledPacksStore; calls: number[][] } => {
    const calls: number[][] = [];
    return {
      calls,
      store: {
        async listEnabledPacks(offset, limit) {
          calls.push([offset, limit]);
          return pages[offset / limit] ?? [];
        },
      },
    };
  };

  it("unions every user's settings", async () => {
    const { store } = storeOf([[["br"], ["br", "uk"], []]]);
    expect((await readEnabledPackIds(store, 500)).sort()).toEqual(["br", "uk"]);
  });

  it("keeps paginating past a full page rather than trusting the row cap", async () => {
    // A store that returns exactly `limit` rows may well have more; stopping
    // here would silently ignore every user beyond the first page.
    const { store, calls } = storeOf([[["br"], ["br"]], [["uk"], ["uk"]], [["global"]]]);
    expect((await readEnabledPackIds(store, 2)).sort()).toEqual(["br", "global", "uk"]);
    expect(calls).toEqual([
      [0, 2],
      [2, 2],
      [4, 2],
    ]);
  });

  it("stops on the first short page", async () => {
    const { store, calls } = storeOf([[["br"]]]);
    await readEnabledPackIds(store, 2);
    expect(calls).toEqual([[0, 2]]);
  });

  it("handles a store with no users at all", async () => {
    const { store } = storeOf([[]]);
    expect(await readEnabledPackIds(store, 2)).toEqual([]);
  });
});

describe("activateFromStore", () => {
  it("reads the store and resolves dependencies in one call", async () => {
    const store: EnabledPacksStore = { async listEnabledPacks() { return [["br"]]; } };
    expect(ids(await activateFromStore(REGISTRY, store, 500))).toEqual(["global", "br"]);
  });
});
