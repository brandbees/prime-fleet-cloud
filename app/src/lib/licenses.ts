import { createHash, randomBytes } from "crypto";
import { prisma } from "./prisma";
import { hashLicenseKey } from "./security";

export function generateLicenseKey() {
  const a = randomBytes(4).toString("hex").toUpperCase();
  const b = randomBytes(4).toString("hex").toUpperCase();
  const c = randomBytes(4).toString("hex").toUpperCase();
  return `PF-${a}-${b}-${c}`;
}

/** Fields to set whenever a new plaintext key is issued. */
export function newLicenseKeyFields(key = generateLicenseKey()) {
  return {
    key,
    keyHash: hashLicenseKey(key),
  };
}

export async function findLicenseByKey(key: string) {
  const trimmed = String(key || "").trim();
  if (!trimmed) return null;

  const keyHash = hashLicenseKey(trimmed);
  const byHash = await prisma.license.findFirst({
    where: { keyHash },
  });
  if (byHash) return byHash;

  /* Legacy rows before keyHash backfill — match plaintext, then repair hash. */
  const byKey = await prisma.license.findUnique({ where: { key: trimmed } });
  if (byKey && !byKey.keyHash) {
    try {
      await prisma.license.update({
        where: { id: byKey.id },
        data: { keyHash },
      });
    } catch {
      /* unique race — ignore */
    }
  }
  return byKey;
}

export function fingerprintKey(key: string) {
  return createHash("sha256").update(key).digest("hex").slice(0, 12);
}
