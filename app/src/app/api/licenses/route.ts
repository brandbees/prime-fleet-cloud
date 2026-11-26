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
    /** none | paid | monthly | yearly — hosted WA (plugin always on). Trial removed. */
    waPlan?: string;
    plan?: string;
  };
  const label = String(body.label || "").trim() || "Untitled site";
  const rawWa = String(body.waPlan || body.plan || "none").trim().toLowerCase();
  /* Trial mint removed — only paid Monthly/Yearly (or generic paid). */
  let entitlement: WaEntitlement = "none";
  if (rawWa === "monthly" || rawWa === "yearly") entitlement = rawWa;
  else if (rawWa === "paid") entitlement = "paid";
  else entitlement = "none";

  const waFields = waWriteFields(entitlement, null);

  const { plaintext, ...keyData } = newLicenseKeyFields();
  const row = await prisma.license.create({
    data: {
      ...keyData,
      label,
      siteUrl: String(body.siteUrl || "").trim(),
      notes: String(body.notes || "").trim(),
      active: true,
      serverStatus: "none",
      serverIp: "",
      ...waFields,
    },
  });

  try {
    const { writeAudit } = await import("@/lib/audit");
    await writeAudit({
      action: "license.create",
      actor: admin.email || "admin",
      licenseId: row.id,
      meta: { wa: entitlement, keyPrefix: keyData.keyPrefix },
    });
  } catch {
    /* ignore */
  }

  if (entitlement !== "none") {
    try {
      const { maybeProvisionAfterWaPaid } = await import("@/lib/provisioner");
      await maybeProvisionAfterWaPaid(row.id);
    } catch {
      /* mock provision optional on create */
    }
  }

  const fresh = await prisma.license.findUnique({ where: { id: row.id } });
  return NextResponse.json({
    license: fresh || row,
    /** One-time plaintext (same as stored unless LICENSE_CLEAR_PLAINTEXT=1). */
    license_key: plaintext,
  });
}
