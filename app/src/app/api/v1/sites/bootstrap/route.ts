import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { newLicenseKeyFields } from "@/lib/licenses";
import { waWriteFields } from "@/lib/license-status";
import {
  assertSiteBound,
  clientIp,
  normalizeSiteUrl,
  publicBootstrapAllowed,
  rateLimited,
} from "@/lib/security";

/**
 * First-time site registration — plugin license only (WA = none).
 * Hosted WA trial mint removed (boss 26 Nov). Disabled in production unless ALLOW_PUBLIC_BOOTSTRAP=1.
 * Never re-leaks an existing key unless the caller already proves they have it.
 */
export async function POST(req: Request) {
  if (!publicBootstrapAllowed()) {
    return NextResponse.json(
      {
        error:
          "Self-serve license signup is disabled. Activate with your Envato purchase code or ask support for a key.",
      },
      { status: 403 }
    );
  }

  const body = (await req.json().catch(() => ({}))) as {
    site_url?: string;
    site_name?: string;
    license_key?: string;
  };
  const siteUrl = normalizeSiteUrl(String(body.site_url || "").trim());
  const siteName = String(body.site_name || "").trim() || "WordPress site";
  const presented = String(
    body.license_key || req.headers.get("x-prime-fleet-license") || ""
  ).trim();
  const ip = clientIp(req);

  if (!siteUrl) {
    return NextResponse.json({ error: "site_url required" }, { status: 400 });
  }

  const limited =
    (await rateLimited(`bootstrap:site:${siteUrl}`, 5, 60_000)) ||
    (await rateLimited(`bootstrap:ip:${ip}`, 10, 60_000)) ||
    (await rateLimited(`bootstrap:global`, 60, 60_000));
  if (limited) return limited;

  const existing = await prisma.license.findFirst({
    where: { siteUrl },
    orderBy: { createdAt: "desc" },
  });

  if (existing) {
    const bound = assertSiteBound(existing, siteUrl);
    if (!bound.ok) {
      return NextResponse.json({ error: bound.error }, { status: 403 });
    }
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

  const { plaintext, ...keyData } = newLicenseKeyFields();
  const license = await prisma.license.create({
    data: {
      ...keyData,
      label: siteName,
      siteUrl,
      ...waWriteFields("none", null),
      active: true,
      serverStatus: "none",
      serverIp: "",
      notes: "auto-bootstrap (plugin only; WA via paid upgrade)",
    },
  });

  try {
    const { writeAudit } = await import("@/lib/audit");
    await writeAudit({
      action: "license.bootstrap",
      licenseId: license.id,
      ip,
      meta: { siteUrl, wa: "none" },
    });
  } catch {
    /* ignore */
  }

  return NextResponse.json({
    license_key: plaintext,
    plan: license.plan,
    wa_entitlement: license.waEntitlement,
    expires_at: license.waExpiresAt || license.expiresAt,
    server_status: license.serverStatus,
    label: license.label,
    existing: false,
  });
}
