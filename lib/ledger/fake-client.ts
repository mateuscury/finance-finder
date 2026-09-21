/**
 * A minimal PostgREST builder fake for the ledger action tests. Each
 * table op resolves with the response configured for it; every call is
 * recorded so a test can assert what was written. Test-only.
 */
import type { Db } from "@/lib/supabase/types";

export interface FakeResponse {
  data?: unknown;
  error?: { code?: string; message?: string } | null;
  count?: number | null;
}
type Op = "select" | "insert" | "update" | "delete" | "upsert";
export interface FakeCall {
  table: string;
  op: Op;
  payload?: unknown;
  filters: Array<[string, string, unknown]>;
}

export function fakeClient(responses: Partial<Record<string, Partial<Record<Op, FakeResponse | FakeResponse[]>>>>): {
  client: Db;
  calls: FakeCall[];
} {
  const calls: FakeCall[] = [];
  const queues = new Map<string, FakeResponse[]>();
  const next = (table: string, op: Op): FakeResponse => {
    const key = `${table}.${op}`;
    if (!queues.has(key)) {
      const configured = responses[table]?.[op];
      queues.set(key, Array.isArray(configured) ? [...configured] : configured ? [configured] : []);
    }
    const q = queues.get(key)!;
    return q.length > 1 ? q.shift()! : (q[0] ?? { data: null, error: null, count: 0 });
  };
  const from = (table: string) => {
    let op: Op = "select";
    let payload: unknown;
    const filters: Array<[string, string, unknown]> = [];
    const builder: Record<string, unknown> = {};
    const chain = () => builder;
    const setOp = (o: Op) => (p?: unknown) => {
      op = o;
      payload = p;
      return builder;
    };
    Object.assign(builder, {
      select: (cols?: string, opts?: unknown) => {
        if (op === "select") payload = { cols, opts };
        return builder;
      },
      insert: setOp("insert"),
      update: setOp("update"),
      delete: setOp("delete"),
      upsert: setOp("upsert"),
      eq: (c: string, v: unknown) => (filters.push([c, "eq", v]), builder),
      in: (c: string, v: unknown) => (filters.push([c, "in", v]), builder),
      gte: (c: string, v: unknown) => (filters.push([c, "gte", v]), builder),
      lte: (c: string, v: unknown) => (filters.push([c, "lte", v]), builder),
      order: chain,
      range: chain,
      limit: chain,
      overrideTypes: chain,
      maybeSingle: () => Object.assign(Promise.resolve(finish()), { overrideTypes: () => Promise.resolve(finish()) }),
      single: () => Promise.resolve(finish()),
      then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
        Promise.resolve(finish()).then(resolve, reject),
    });
    const finish = () => {
      calls.push({ table, op, payload, filters });
      const r = next(table, op);
      return { data: r.data ?? null, error: r.error ?? null, count: r.count ?? null };
    };
    return builder;
  };
  return { client: { from } as unknown as Db, calls };
}
