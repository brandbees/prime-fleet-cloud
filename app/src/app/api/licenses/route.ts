import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { generateLicenseKey } from "@/lib/licenses";
import { canUsePremium, daysLeft, trialExpiryFromNow } from "@/lib/license-status";

export async function GET() {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const rows = await prisma.license.findMany({ orderBy: { createdAt: "desc" } });
  const licenses = rows.map((r) => {
    const gate = canUsePremium(r);
    return {
      ...r,
      usable: gate.ok,
      gateReason: gate.reason,
      daysLeft: daysLeft(r.expiresAt),
    };
  });
  return NextResponse.json({ licenses });
}

export async function POST(req: Request) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as {
    label?: string;
    siteUrl?: string;
    notes?: string;
    plan?: string;
  };
  const label = String(body.label || "").trim() || "Untitled site";
  const plan = body.plan === "trial" ? "trial" : "paid";
  const row = await prisma.license.create({
    data: {
      key: generateLicenseKey(),
      label,
      siteUrl: String(body.siteUrl || "").trim(),
      notes: String(body.notes || "").trim(),
      plan,
      expiresAt: plan === "trial" ? trialExpiryFromNow(14) : null,
      active: true,
    },
  });
  return NextResponse.json({ license: row });
}
