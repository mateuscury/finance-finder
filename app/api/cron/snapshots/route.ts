/**
 * Daily portfolio snapshot cron. Second and last of the two Vercel Hobby crons.
 * Depends on lib/calc (Milestones 1–3).
 */
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return NextResponse.json({ ok: false, reason: "snapshots not implemented (Milestones 1–3)" }, { status: 501 });
}
