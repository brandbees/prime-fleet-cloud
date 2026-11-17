import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { generateLicenseKey } from "@/lib/licenses";
import { trialExpiryFromNow } from "@/lib/license-status";
import { allowRate } from "@/lib/rate-limit";

/**
 * First-time site registration. Creates a trial license.
 * Never re-leaks an existing key unless the caller already proves they have it
 * (X-Prime-Fleet-License / body.license_key match) — otherwise attackers who
 * only know site_url could steal WhatsApp send authority.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    site_url?: string;
    site_name?: string;
    license_key?: string;
  };
  const siteUrl = String(body.site_url || "").trim().replace(/\/$/, "");
  const siteName = String(body.site_name || "").trim() || "WordPress site";
  const presented = String(
    body.license_key || req.headers.get("x-prime-fleet-license") || ""
  ).trim();

  if (!siteUrl) {
    return NextResponse.json({ error: "site_url required" }, { status: 400 });
  }

  const rl = allowRate(`bootstrap:${siteUrl}`, 8, 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Too many bootstrap attempts. Retry shortly." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } }
    );
  }

  const existing = await prisma.license.findFirst({
    where: { siteUrl },
    orderBy: { createdAt: "desc" },
  });

  if (existing) {
    if (presented && presented === existing.key) {
      return NextResponse.json({
        license_key: existing.key,
        plan: existing.plan,
        expires_at: existing.expiresAt,
        label: existing.label,
        existing: true,
      });
    }
    return NextResponse.json(
      {
        error:
          "This site already has a license. Paste the key from Prime Fleet Cloud → Licenses, or set PRIME_FLEET_LICENSE_KEY in wp-config.",
        already_registered: true,
        plan: existing.plan,
        expires_at: existing.expiresAt,
      },
      { status: 409 }
    );
  }

  const license = await prisma.license.create({
    data: {
      key: generateLicenseKey(),
      label: siteName,
      siteUrl,
      plan: "trial",
      expiresAt: trialExpiryFromNow(14),
      active: true,
      notes: "auto-bootstrap",
    },
  });

  return NextResponse.json({
    license_key: license.key,
    plan: license.plan,
    expires_at: license.expiresAt,
    label: license.label,
    existing: false,
  });
}
