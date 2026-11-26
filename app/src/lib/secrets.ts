/**
 * At-rest encryption for sensitive AppSetting values (Stripe, OpenWA API key).
 * Format: enc:v1:<iv_b64>:<tag_b64>:<cipher_b64>
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";
import { env } from "./env";

const PREFIX = "enc:v1:";

const SENSITIVE_KEYS = new Set([
  "stripe_secret_key",
  "stripe_webhook_secret",
  "openwa_api_key",
]);

export function isSensitiveSettingKey(key: string) {
  return SENSITIVE_KEYS.has(String(key || "").trim());
}

function keyMaterial() {
  const secret = env("AUTH_SECRET", "dev-secret-change-me-please-32");
  return createHash("sha256").update(`pf-secrets:${secret}`, "utf8").digest();
}

export function encryptSecret(plain: string): string {
  const raw = String(plain || "");
  if (!raw || raw.startsWith(PREFIX)) return raw;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyMaterial(), iv);
  const enc = Buffer.concat([cipher.update(raw, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString("base64")}:${tag.toString("base64")}:${enc.toString("base64")}`;
}

export function decryptSecret(stored: string): string {
  const raw = String(stored || "");
  if (!raw.startsWith(PREFIX)) return raw;
  try {
    const parts = raw.slice(PREFIX.length).split(":");
    if (parts.length !== 3) return "";
    const [ivB64, tagB64, dataB64] = parts;
    const iv = Buffer.from(ivB64, "base64");
    const tag = Buffer.from(tagB64, "base64");
    const data = Buffer.from(dataB64, "base64");
    const decipher = createDecipheriv("aes-256-gcm", keyMaterial(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
  } catch {
    return "";
  }
}

export function maybeEncryptSetting(key: string, value: string) {
  if (!isSensitiveSettingKey(key)) return value;
  return encryptSecret(value);
}

export function maybeDecryptSetting(key: string, value: string) {
  if (!isSensitiveSettingKey(key)) return value;
  return decryptSecret(value);
}
