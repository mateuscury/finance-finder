/**
 * Price + series ingestion cron (PACKS.md §10).
 *
 * Vercel Hobby allows two cron jobs total, so this ONE invocation must iterate
 * every enabled pack's sources with a per-source time budget and resume
 * markers (`ingest_cursors`), never one job per pack. Kernel work for
 * Milestone 1 — see lib/packs/README.md.
 */
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return NextResponse.json({ ok: false, reason: "ingestion not implemented (Milestone 1)" }, { status: 501 });
}
