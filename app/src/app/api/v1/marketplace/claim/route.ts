import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyActivateToken } from "@/lib/marketplace";
import { findLicenseByKey } from "@/lib/licenses";
import {
  assertSiteBound,
  clientIp,
  normalizeSiteUrl,
  rateLimited,
} from "@/lib/security";

/** WP redeems one-time activate token → license key (auto-save). */
export async function POST(req: Request) {
  const limited = await rateLimited(`marketplace:claim:${clientIp(req)}`, 20, 60_000);
  if (limited) return limited;

  const body = (await req.json().catch(() => ({}))) as {
    token?: string;
    site_url?: string;
  };
  const token = String(body.token || "").trim();
  if (!token) {
    return NextResponse.json({ error: "Missing token" }, { status: 400 });
  }

  let licenseKey = "";
  let tokenSite = "";
  try {
    const parsed = await verifyActivateToken(token);
    licenseKey = parsed.licenseKey;
    tokenSite = parsed.siteUrl;
  } catch {
    return NextResponse.json(
      { error: "Activate link expired, invalid, or already used. Try again." },
      { status: 400 }
    );
  }

  const license = await findLicenseByKey(licenseKey);
  if (!license || !license.active) {
    return NextResponse.json({ error: "License inactive or missing." }, { status: 403 });
  }

  const siteUrl = normalizeSiteUrl(String(body.site_url || tokenSite || "").trim());
  const siteCheck = assertSiteBound(license, siteUrl, { requirePresented: Boolean(license.siteUrl) });
  if (!siteCheck.ok) {
    return NextResponse.json({ error: siteCheck.error }, { status: 403 });
  }

  if (siteUrl && !license.siteUrl) {
    await prisma.license.update({
      where: { id: license.id },
      data: { siteUrl },
    });
  }

  return NextResponse.json({
    ok: true,
    license_key: license.key,
    label: license.label,
  });
}
