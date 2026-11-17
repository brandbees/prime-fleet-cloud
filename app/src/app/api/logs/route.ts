import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const logs = await prisma.messageLog.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
    include: { license: { select: { label: true, key: true } } },
  });
  return NextResponse.json({ logs });
}
