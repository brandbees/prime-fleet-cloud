import { NextResponse } from "next/server";
import { runGracePowerOffJob } from "@/lib/grace";
import { env } from "@/lib/env";

export const runtime = "nodejs";

/**
 * Cron: unpaid grace ended → power-off Hosted WA instances.
 * Auth: Authorization: Bearer $CRON_SECRET  (or ?secret= for simple schedulers)
 * Schedule example: every hour.
 */
export async function POST(req: Request) {
  const expected = env("CRON_SECRET", "").trim();
  if (!expected) {
    return NextResponse.json(
      { error: "CRON_SECRET not configured" },
      { status: 503 }
    );
  }

  const auth = req.headers.get("authorization") || "";
  const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  const url = new URL(req.url);
  const qs = url.searchParams.get("secret") || "";
  if (bearer !== expected && qs !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await runGracePowerOffJob();
  return NextResponse.json({ ok: true, ...result });
}

export async function GET(req: Request) {
  return POST(req);
}
