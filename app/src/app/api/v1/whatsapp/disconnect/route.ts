import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { disconnectSession } from "@/lib/openwa";
import { openwaConfig } from "@/lib/env";

/**
 * Plugin disconnect — logout/delete OpenWA session bound to this license.
 * Body: { license_key } or header X-Prime-Fleet-License
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { license_key?: string };
  const key = String(body.license_key || req.headers.get("x-prime-fleet-license") || "").trim();
  if (!key) return NextResponse.json({ error: "Missing license_key" }, { status: 400 });

  const cfg = openwaConfig();
  if (!cfg.apiKey) {
    return NextResponse.json({ error: "Messaging gateway is not configured on the server." }, { status: 503 });
  }

  const license = await prisma.license.findUnique({ where: { key } });
  if (!license) return NextResponse.json({ error: "Invalid license" }, { status: 403 });

  const sessionId = (license.openwaSessionId || "").trim();
  let openwa: { ok: boolean; message: string } = { ok: true, message: "No session linked" };
  if (sessionId) {
    try {
      openwa = await disconnectSession(sessionId);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Disconnect failed";
      return NextResponse.json({ error: msg }, { status: 502 });
    }
  }

  await prisma.license.update({
    where: { id: license.id },
    data: { openwaSessionId: "" },
  });

  return NextResponse.json({
    status: "disconnected",
    phone_connected: false,
    message: "Phone disconnected. Tap Connect phone to scan a new QR.",
    openwa_ok: openwa.ok,
  });
}
