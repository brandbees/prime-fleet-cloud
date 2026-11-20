import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { disconnectSession } from "@/lib/openwa";
import { openwaSettings } from "@/lib/settings";
import { canUsePlugin } from "@/lib/license-status";
import { findLicenseByKey } from "@/lib/licenses";
import {
  assertSiteBound,
  clientIp,
  normalizeSiteUrl,
  rateLimited,
} from "@/lib/security";

/**
 * Plugin disconnect — logout/delete OpenWA session bound to this license.
 * Body: { license_key, site_url? } or header X-Prime-Fleet-License
 */
export async function POST(req: Request) {
  const limited = rateLimited(`wa:disconnect:${clientIp(req)}`, 15, 60_000);
  if (limited) return limited;

  const body = (await req.json().catch(() => ({}))) as { license_key?: string; site_url?: string };
  const key = String(body.license_key || req.headers.get("x-prime-fleet-license") || "").trim();
  if (!key) return NextResponse.json({ error: "Missing license_key" }, { status: 400 });

  const cfg = await openwaSettings();
  if (!cfg.apiKey) {
    return NextResponse.json(
      { error: "Messaging gateway is not configured. Set OpenWA in Panel → WhatsApp." },
      { status: 503 }
    );
  }

  const license = await findLicenseByKey(key);
  if (!license) return NextResponse.json({ error: "Invalid license" }, { status: 403 });

  const siteUrl = normalizeSiteUrl(String(body.site_url || "").trim());
  const siteCheck = assertSiteBound(license, siteUrl);
  if (!siteCheck.ok) {
    return NextResponse.json({ error: siteCheck.error }, { status: 403 });
  }

  const plugin = canUsePlugin(license);
  if (!plugin.ok) {
    return NextResponse.json({ error: "License inactive or revoked." }, { status: 403 });
  }

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
