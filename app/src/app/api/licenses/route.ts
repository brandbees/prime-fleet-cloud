import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { newLicenseKeyFields } from "@/lib/licenses";
import {
  canUsePlugin,
  canUseWhatsApp,
  daysLeft,
  normalizeWaEntitlement,
  serverStatusOf,
  trialExpiryFromNow,
  waExpiry,
  waWriteFields,
  type WaEntitlement,
} from "@/lib/license-status";

export async function GET() {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const rows = await prisma.license.findMany({ orderBy: { createdAt: "desc" } });
  const licenses = rows.map((r) => {
    const plugin = canUsePlugin(r);
    const wa = canUseWhatsApp(r);
    const ent = normalizeWaEntitlement(r);
    const exp = waExpiry(r);
    return {
      ...r,
      waEntitlement: ent,
      usable: wa.ok,
      pluginOk: plugin.ok,
      waOk: wa.ok,
      gateReason: wa.ok ? "ok" : wa.reason,
      daysLeft: daysLeft(exp),
      serverStatus: serverStatusOf(r),
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
    /** none | trial | paid — hosted WA entitlement (plugin always on). */
    waPlan?: string;
    plan?: string;
  };
  const label = String(body.label || "").trim() || "Untitled site";
  const rawWa = String(body.waPlan || body.plan || "trial").trim().toLowerCase();
  let entitlement: WaEntitlement = "none";
  if (rawWa === "trial") entitlement = "trial";
  else if (rawWa === "paid" || rawWa === "monthly" || rawWa === "yearly") entitlement = "paid";
  else entitlement = "none";

  const waExpires = entitlement === "trial" ? trialExpiryFromNow(14) : null;
  const waFields = waWriteFields(entitlement, waExpires);

  const row = await prisma.license.create({
    data: {
      ...newLicenseKeyFields(),
      label,
      siteUrl: String(body.siteUrl || "").trim(),
      notes: String(body.notes || "").trim(),
      active: true,
      serverStatus: "none",
      serverIp: "",
      ...waFields,
    },
  });

  if (entitlement !== "none") {
    try {
      const { maybeProvisionAfterWaPaid } = await import("@/lib/provisioner");
      await maybeProvisionAfterWaPaid(row.id);
    } catch {
      /* mock provision optional on create */
    }
  }

  const fresh = await prisma.license.findUnique({ where: { id: row.id } });
  return NextResponse.json({ license: fresh || row });
}
