import { createHash, randomBytes } from "crypto";
import { prisma } from "./prisma";
import { clearPlaintextLicenseKeys, hashLicenseKey } from "./security";
import { writeAudit } from "./audit";

export function generateLicenseKey() {
  const a = randomBytes(4).toString("hex").toUpperCase();
  const b = randomBytes(4).toString("hex").toUpperCase();
  const c = randomBytes(4).toString("hex").toUpperCase();
  return `PF-${a}-${b}-${c}`;
}

export function keyPrefixOf(key: string) {
  const t = String(key || "").trim().toUpperCase();
  if (t.length < 4) return t;
  return t.slice(-4);
}

export function maskLicenseKey(key: string, prefix = "") {
  const p = (prefix || keyPrefixOf(key) || "????").toUpperCase();
  return `PF-••••-••••-${p}`;
}

/**
 * DB fields for a new key. `plaintext` is the customer-facing key (always).
 * When LICENSE_CLEAR_PLAINTEXT=1, stored `key` is a placeholder; lookups use keyHash.
 */
export function newLicenseKeyFields(key = generateLicenseKey()) {
  const clear = clearPlaintextLicenseKeys();
  const storageKey = clear
    ? `PF-HASHONLY-${randomBytes(8).toString("hex").toUpperCase()}`
    : key;
  return {
    key: storageKey,
    keyHash: hashLicenseKey(key),
    keyPrefix: keyPrefixOf(key),
    plaintext: key,
  };
}

/** Re-issue key — returns plaintext once. Old key stops working. */
export async function reissueLicenseKey(licenseId: string, actor = "admin") {
  const fields = newLicenseKeyFields();
  const { plaintext, ...data } = fields;
  const row = await prisma.license.update({
    where: { id: licenseId },
    data,
  });
  await writeAudit({
    action: "license.reissue",
    actor,
    licenseId,
    meta: { keyPrefix: data.keyPrefix },
  });
  return { license: row, plaintext, masked: maskLicenseKey(plaintext) };
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
