/**
 * Where a Supabase email link lands (password reset). Exchanges the one-time
 * code for a session cookie and continues to `next`, which must be a
 * same-origin path — a full URL here would be an open redirect.
 */
import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next") ?? "/";
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/";
  if (code) {
    const supabase = await createServerSupabase();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) return NextResponse.redirect(new URL("/login?failed=1", url.origin));
  }
  return NextResponse.redirect(new URL(safeNext, url.origin));
}
