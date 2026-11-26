import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createSession, verifyPassword } from "@/lib/auth";
import { clientIp, rateLimited } from "@/lib/security";

export async function POST(req: Request) {
  const ip = clientIp(req);
  const limited =
    await rateLimited(`auth:login:ip:${ip}`, 10, 60_000) ||
    await rateLimited(`auth:login:global`, 60, 60_000);
  if (limited) return limited;

  const body = (await req.json().catch(() => ({}))) as { email?: string; password?: string };
  const email = String(body.email || "")
    .trim()
    .toLowerCase();
  const password = String(body.password || "");
  if (!email || !password) {
    return NextResponse.json({ error: "Email and password required" }, { status: 400 });
  }

  const emailLimit = await rateLimited(`auth:login:email:${email}`, 8, 15 * 60_000);
  if (emailLimit) return emailLimit;

  const user = await prisma.adminUser.findUnique({ where: { email } });
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }
  await createSession(user.id, user.email);
  return NextResponse.json({ ok: true });
}
