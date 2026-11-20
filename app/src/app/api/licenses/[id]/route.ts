import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { trialExpiryFromNow, waWriteFields, type WaEntitlement } from "@/lib/license-status";

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
    /** paid = WA paid; trial = reset WA trial; none = drop WA entitlement. */
    plan?: string;
    waPlan?: string;
    serverStatus?: string;
  };

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
  } else if (waPlan === "trial") {
    Object.assign(data, waWriteFields("trial", trialExpiryFromNow(14)));
    data.active = true;
  } else if (waPlan === "none") {
    Object.assign(data, waWriteFields("none", null));
  }

  if (body.serverStatus !== undefined) {
    const s = String(body.serverStatus).trim().toLowerCase();
    if (["none", "provisioning", "running", "error", "stopped"].includes(s)) {
      data.serverStatus = s;
    }
  }

  const row = await prisma.license.update({ where: { id }, data });

  /* Paid / trial WA → kick mock provision (Webdock HOLD). */
  if (waPlan === "paid" || waPlan === "monthly" || waPlan === "yearly" || waPlan === "trial") {
    try {
      const { maybeProvisionAfterWaPaid } = await import("@/lib/provisioner");
      await maybeProvisionAfterWaPaid(id);
    } catch {
      /* leave serverStatus as-is */
    }
  }
  if (waPlan === "none") {
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
  return NextResponse.json({ ok: true });
}
