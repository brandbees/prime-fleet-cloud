import { randomBytes } from "crypto";
import { prisma } from "./prisma";

export function newJti() {
  return randomBytes(16).toString("hex");
}

/** Returns false if jti was already consumed (replay). */
export async function consumeJti(jti: string, purpose: string, expiresAt: Date) {
  const id = String(jti || "").trim();
  if (!id) return false;
  try {
    await prisma.securityToken.create({
      data: { jti: id, purpose, expiresAt },
    });
    return true;
  } catch {
    return false;
  }
}

export async function purgeExpiredTokens() {
  await prisma.securityToken.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });
}
