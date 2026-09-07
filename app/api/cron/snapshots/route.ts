/**
 * Daily portfolio snapshot cron. The second of the two schedules this project
 * ships by design; Vercel's Hobby tier currently allows far more.
 * Depends on lib/calc (Milestones 1–3).
 */
import { NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/cron/auth";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return NextResponse.json({ ok: false, reason: "snapshots not implemented (Milestones 1–3)" }, { status: 501 });
}
