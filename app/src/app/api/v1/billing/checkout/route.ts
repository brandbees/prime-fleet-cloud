import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canUsePremium } from "@/lib/license-status";
import { createCheckoutForLicense } from "@/lib/billing";

/**
 * Plugin asks for a pay URL when trial/license is expired.
 * Body: { license_key, return_url? }
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    license_key?: string;
    return_url?: string;
  };
  const key = String(body.license_key || req.headers.get("x-prime-fleet-license") || "").trim();
  if (!key) return NextResponse.json({ error: "Missing license_key" }, { status: 400 });

  const license = await prisma.license.findUnique({ where: { key } });
  if (!license) return NextResponse.json({ error: "Invalid license" }, { status: 403 });

  const gate = canUsePremium(license);
  if (gate.ok && license.plan === "paid") {
    return NextResponse.json({
      already_paid: true,
      plan: "paid",
      message: "Already active.",
    });
  }

  // Allow checkout when expired OR still on trial (early upgrade).
  try {
    const checkout = await createCheckoutForLicense(key, String(body.return_url || "").trim());
    return NextResponse.json({
      already_paid: false,
      needs_payment: !gate.ok,
      reason: gate.ok ? "upgrade" : gate.reason,
      plan: license.plan,
      ...checkout,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Checkout failed";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
