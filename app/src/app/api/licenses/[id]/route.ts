import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { trialExpiryFromNow } from "@/lib/license-status";

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
    /** paid = convert to paid (clears expiry). trial = reset 14-day trial. */
    plan?: string;
  };

  const data: {
    active?: boolean;
    label?: string;
    siteUrl?: string;
    notes?: string;
    plan?: string;
    expiresAt?: Date | null;
  } = {
    ...(typeof body.active === "boolean" ? { active: body.active } : {}),
    ...(body.label !== undefined ? { label: String(body.label).trim() } : {}),
    ...(body.siteUrl !== undefined ? { siteUrl: String(body.siteUrl).trim() } : {}),
    ...(body.notes !== undefined ? { notes: String(body.notes).trim() } : {}),
  };

  if (body.plan === "paid") {
    data.plan = "paid";
    data.expiresAt = null;
    data.active = true;
  } else if (body.plan === "trial") {
    data.plan = "trial";
    data.expiresAt = trialExpiryFromNow(14);
    data.active = true;
  }

  const row = await prisma.license.update({ where: { id }, data });
  return NextResponse.json({ license: row });
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  await prisma.license.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
