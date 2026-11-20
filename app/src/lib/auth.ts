import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import bcrypt from "bcryptjs";
import { prisma } from "./prisma";
import { env } from "./env";
import { getAuthSecretBytes } from "./security";

const COOKIE = "pf_cloud_session";

function secret() {
  return getAuthSecretBytes();
}

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash);
}

export async function createSession(userId: string, email: string) {
  const token = await new SignJWT({ sub: userId, email })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("14d")
    .sign(secret());
  const jar = await cookies();
  const publicUrl = env("PANEL_PUBLIC_URL", "");
  const secureCookie =
    process.env.COOKIE_SECURE === "true" || publicUrl.startsWith("https://");
  jar.set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    /* HTTP VPS (http://IP:3040) must not use Secure cookies or login never sticks */
    secure: secureCookie,
    path: "/",
    maxAge: 60 * 60 * 24 * 14,
  });
}

export async function destroySession() {
  const jar = await cookies();
  jar.delete(COOKIE);
}

export async function getSession() {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    const id = String(payload.sub || "");
    const email = String(payload.email || "");
    if (!id) return null;
    return { id, email };
  } catch {
    return null;
  }
}

export async function requireAdmin() {
  const session = await getSession();
  if (!session) return null;
  const user = await prisma.adminUser.findUnique({ where: { id: session.id } });
  return user;
}
