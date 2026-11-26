import { NextResponse } from "next/server";
import { canUseWhatsApp, normalizeWaEntitlement } from "@/lib/license-status";
import { createCheckoutForLicense } from "@/lib/billing";
import { findLicenseByKey } from "@/lib/licenses";
import {
  assertSiteBound,
  clientIp,
  normalizeSiteUrl,
  rateLimited,
} from "@/lib/security";

/**
 * Plugin asks for a pay URL when Hosted WA is unpaid or expired.
 * Body: { license_key, return_url?, site_url?, plan?: "monthly"|"yearly" }
 */
export async function POST(req: Request) {
  const limited = await rateLimited(`billing:checkout:${clientIp(req)}`, 20, 60_000);
  if (limited) return limited;

  const body = (await req.json().catch(() => ({}))) as {
    license_key?: string;
    return_url?: string;
    site_url?: string;
    plan?: string;
  };
  const key = String(body.license_key || req.headers.get("x-prime-fleet-license") || "").trim();
  if (!key) return NextResponse.json({ error: "Missing license_key" }, { status: 400 });

  const license = await findLicenseByKey(key);
  if (!license) return NextResponse.json({ error: "Invalid license" }, { status: 403 });

  const siteUrl = normalizeSiteUrl(String(body.site_url || "").trim());
  const siteCheck = assertSiteBound(license, siteUrl);
  if (!siteCheck.ok) {
    return NextResponse.json({ error: siteCheck.error }, { status: 403 });
  }

  const gate = canUseWhatsApp(license);
  const ent = normalizeWaEntitlement(license);
  if (gate.ok && (ent === "paid" || ent === "monthly" || ent === "yearly")) {
    return NextResponse.json({
      already_paid: true,
      plan: ent,
      message: "Already active.",
    });
  }

  try {
    const checkout = await createCheckoutForLicense(
      key,
      String(body.return_url || "").trim(),
      String(body.plan || "monthly")
    );
    return NextResponse.json({
      already_paid: false,
      needs_payment: !gate.ok,
      reason: gate.ok ? "upgrade" : gate.reason,
      ...checkout,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Checkout failed";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
