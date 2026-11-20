import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import {
  forceDestroyInstance,
  getInstanceForLicense,
  powerOffInstance,
  startProvision,
  tickMockProvision,
} from "@/lib/provisioner";

type Ctx = { params: Promise<{ licenseId: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { licenseId } = await ctx.params;
  await tickMockProvision(licenseId);
  const instance = await getInstanceForLicense(licenseId);
  if (!instance) return NextResponse.json({ error: "No instance" }, { status: 404 });
  return NextResponse.json({ instance });
}

export async function POST(req: Request, ctx: Ctx) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { licenseId } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { action?: string };
  const action = String(body.action || "").trim().toLowerCase();

  try {
    if (action === "provision" || action === "retry") {
      const instance = await startProvision(licenseId, `operator ${action}`);
      return NextResponse.json({ instance });
    }
    if (action === "power_off" || action === "stop") {
      const instance = await powerOffInstance(licenseId);
      return NextResponse.json({ instance });
    }
    if (action === "tick") {
      const instance = await tickMockProvision(licenseId);
      return NextResponse.json({ instance });
    }
    if (action === "destroy") {
      await forceDestroyInstance(licenseId);
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Action failed" },
      { status: 400 }
    );
  }
}
