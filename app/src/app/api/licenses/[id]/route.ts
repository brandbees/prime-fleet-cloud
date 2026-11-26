import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import { reissueLicenseKey } from "@/lib/licenses";
import { waWriteFields, type WaEntitlement } from "@/lib/license-status";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, ctx: Ctx) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as {
    active?: boolean;
    label?: string;
    siteUrl?: string;
    notes?: string;
    /** paid|monthly|yearly = WA paid; none = drop WA. Trial mint removed. */
    plan?: string;
    waPlan?: string;
    serverStatus?: string;
    /** Rotate license key — returns plaintext once. */
    reissueKey?: boolean;
  };

  if (body.reissueKey) {
    const out = await reissueLicenseKey(id, admin.email || "admin");
    return NextResponse.json({
      license: out.license,
      license_key: out.plaintext,
      masked: out.masked,
      message: "New key issued. Copy it now — it won’t be shown again in full if plaintext clearing is on.",
    });
  }

  const data: Record<string, unknown> = {
    ...(typeof body.active === "boolean" ? { active: body.active } : {}),
    ...(body.label !== undefined ? { label: String(body.label).trim() } : {}),
    ...(body.siteUrl !== undefined ? { siteUrl: String(body.siteUrl).trim() } : {}),
    ...(body.notes !== undefined ? { notes: String(body.notes).trim() } : {}),
  };

  const waPlan = body.waPlan || body.plan;
  if (waPlan === "paid" || waPlan === "monthly" || waPlan === "yearly") {
    const ent: WaEntitlement = waPlan === "paid" ? "paid" : (waPlan as WaEntitlement);
    Object.assign(data, waWriteFields(ent === "monthly" || ent === "yearly" ? ent : "paid", null));
    data.active = true;
    data.waUnpaidAt = null;
  } else if (waPlan === "trial") {
    /* Trial product removed — treat as drop WA (no new trial mint). */
    Object.assign(data, waWriteFields("none", null));
    data.waUnpaidAt = null;
  } else if (waPlan === "none") {
    Object.assign(data, waWriteFields("none", null));
    data.waUnpaidAt = null;
  }

  if (body.serverStatus !== undefined) {
    const s = String(body.serverStatus).trim().toLowerCase();
    if (["none", "provisioning", "running", "error", "stopped"].includes(s)) {
      data.serverStatus = s;
    }
  }

  const row = await prisma.license.update({ where: { id }, data });

  await writeAudit({
    action:
      typeof body.active === "boolean" && body.active === false
        ? "license.revoke"
        : waPlan === "none"
          ? "license.wa_drop"
          : waPlan
            ? "license.wa_update"
            : "license.update",
    actor: admin.email || "admin",
    licenseId: id,
    meta: { waPlan: waPlan || null, active: body.active },
  });

  /* Paid WA → kick provision. */
  if (waPlan === "paid" || waPlan === "monthly" || waPlan === "yearly") {
    try {
      const { maybeProvisionAfterWaPaid } = await import("@/lib/provisioner");
      await maybeProvisionAfterWaPaid(id);
    } catch {
      /* leave serverStatus as-is */
    }
  }
  if (waPlan === "none" || waPlan === "trial") {
    try {
      const { powerOffInstance } = await import("@/lib/provisioner");
      await powerOffInstance(id);
    } catch {
      /* no instance yet */
    }
  }

  const fresh = await prisma.license.findUnique({ where: { id } });
  return NextResponse.json({ license: fresh || row });
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  await prisma.license.delete({ where: { id } });
  await writeAudit({
    action: "license.delete",
    actor: admin.email || "admin",
    licenseId: id,
  });
  return NextResponse.json({ ok: true });
}
