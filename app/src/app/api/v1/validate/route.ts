import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { findLicenseByKey } from "@/lib/licenses";
import {
  canUsePlugin,
  canUseWhatsApp,
  daysLeft,
  normalizeWaEntitlement,
  serverStatusOf,
  waExpiry,
} from "@/lib/license-status";
import {
  assertSiteBound,
  clientIp,
  normalizeSiteUrl,
  rateLimited,
  signValidatePayload,
} from "@/lib/security";

/** Plugin calls this with license key — no admin cookie. */
export async function POST(req: Request) {
  const ip = clientIp(req);
  const limited = await rateLimited(`validate:ip:${ip}`, 60, 60_000);
  if (limited) return limited;

  const body = (await req.json().catch(() => ({}))) as { license_key?: string; site_url?: string };
  const key = String(body.license_key || req.headers.get("x-prime-fleet-license") || "").trim();
  if (!key) return NextResponse.json({ valid: false, error: "Missing license_key" }, { status: 400 });

  const keyLimit = await rateLimited(`validate:key:${key.slice(0, 24)}`, 30, 60_000);
  if (keyLimit) return keyLimit;

  const license = await findLicenseByKey(key);
  if (!license) {
    return NextResponse.json({ valid: false, error: "Invalid or inactive license" }, { status: 403 });
  }

  const siteUrl = normalizeSiteUrl(String(body.site_url || "").trim());
  const siteCheck = assertSiteBound(license, siteUrl, { requirePresented: true });
  if (!siteCheck.ok) {
    return NextResponse.json(
      { valid: false, error: siteCheck.error, reason: "site_mismatch" },
      { status: 403 }
    );
  }

  const plugin = canUsePlugin(license);
  if (!plugin.ok) {
    return NextResponse.json(
      {
        valid: false,
        error: "License inactive or revoked. Contact support or re-activate.",
        reason: plugin.reason,
        plugin: { ok: false, reason: plugin.reason },
        whatsapp: { ok: false, reason: "inactive" },
      },
      { status: 403 }
    );
  }

  const wa = canUseWhatsApp(license);
  const ent = normalizeWaEntitlement(license);
  const exp = waExpiry(license);

  if (siteUrl && !license.siteUrl) {
    await prisma.license.update({
      where: { id: license.id },
      data: { siteUrl },
    });
  }

  const payload = {
    valid: true as const,
    label: license.label,
    plugin: { ok: true, reason: "ok" },
    whatsapp: {
      ok: wa.ok,
      reason: wa.reason,
      entitlement: ent,
      plan: license.plan,
      needs_payment: !wa.ok,
      expires_at: exp,
      days_left: daysLeft(exp),
      server_status: serverStatusOf(license),
      server_ip: license.serverIp || "",
    },
    features: {
      plugin: true,
      whatsapp: wa.ok,
    },
    plan: license.plan,
    expires_at: exp,
    days_left: daysLeft(exp),
  };

  return NextResponse.json(signValidatePayload(payload));
}
