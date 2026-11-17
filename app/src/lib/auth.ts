import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import bcrypt from "bcryptjs";
import { prisma } from "./prisma";
import { env } from "./env";

const COOKIE = "pf_cloud_session";

const DEV_AUTH_FALLBACK = "dev-secret-change-me-please-32";

function secret() {
  const raw = env("AUTH_SECRET", DEV_AUTH_FALLBACK);
  if (process.env.NODE_ENV === "production" && (!raw || raw === DEV_AUTH_FALLBACK)) {
    throw new Error("AUTH_SECRET must be set to a strong value in production");
  }
  return new TextEncoder().encode(raw);
}

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 10);
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
  jar.set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
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
