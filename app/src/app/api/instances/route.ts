import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { listInstances } from "@/lib/provisioner";

export async function GET() {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const instances = await listInstances();
  return NextResponse.json({ instances });
}
