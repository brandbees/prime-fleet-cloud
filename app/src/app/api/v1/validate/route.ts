import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canUsePremium, daysLeft } from "@/lib/license-status";

/** Plugin calls this with license key — no admin cookie. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { license_key?: string; site_url?: string };
  const key = String(body.license_key || "").trim();
  if (!key) return NextResponse.json({ valid: false, error: "Missing license_key" }, { status: 400 });

  const license = await prisma.license.findUnique({ where: { key } });
  if (!license) {
    return NextResponse.json({ valid: false, error: "Invalid or inactive license" }, { status: 403 });
  }

  const gate = canUsePremium(license);
  if (!gate.ok) {
    const msg =
      gate.reason === "trial_expired"
        ? "Trial expired — purchase a paid license to continue WhatsApp."
        : gate.reason === "expired"
          ? "License expired."
          : "Invalid or inactive license";
    return NextResponse.json(
      {
        valid: false,
        error: msg,
        reason: gate.reason,
        plan: license.plan,
        expires_at: license.expiresAt,
      },
      { status: 403 }
    );
  }

  const siteUrl = String(body.site_url || "").trim();
  if (siteUrl && !license.siteUrl) {
    await prisma.license.update({
      where: { id: license.id },
      data: { siteUrl },
    });
  }

  return NextResponse.json({
    valid: true,
    features: { whatsapp: true },
    label: license.label,
    plan: license.plan,
    expires_at: license.expiresAt,
    days_left: daysLeft(license.expiresAt),
  });
}
