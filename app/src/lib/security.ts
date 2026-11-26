import { NextResponse } from "next/server";
import { createHash, createHmac } from "crypto";
import { env } from "./env";
import { allowRateDurable } from "./rate-limit";

const WEAK_AUTH_SECRETS = new Set([
  "dev-secret-change-me-please-32",
  "change-me-local-auth-secret-32chars",
]);

export function isProduction() {
  return process.env.NODE_ENV === "production";
}

/** Unified AUTH_SECRET for sessions + pay/activate JWTs. */
export function getAuthSecretBytes() {
  const raw = env("AUTH_SECRET", "dev-secret-change-me-please-32");
  if (isProduction() && (!raw || raw.length < 32 || WEAK_AUTH_SECRETS.has(raw))) {
    throw new Error("AUTH_SECRET must be a strong unique value (32+ chars) in production");
  }
  return new TextEncoder().encode(raw);
}

/** Mock Envato / mock checkout — never on by NODE_ENV alone in production. */
export function mockCheckoutAllowed() {
  if (env("ALLOW_MOCK_CHECKOUT", "") === "1") {
    return !isProduction() || env("FORCE_MOCK_IN_PROD", "") === "1";
  }
  return !isProduction();
}

export function mockEnvatoAllowed() {
  if (env("ALLOW_MOCK_ENVATO", "") === "1") {
    return !isProduction() || env("FORCE_MOCK_IN_PROD", "") === "1";
  }
  return !isProduction();
}

/** Public site bootstrap (plugin key only, no WA) — off in production unless explicitly enabled. */
export function publicBootstrapAllowed() {
  if (env("ALLOW_PUBLIC_BOOTSTRAP", "") === "1") return true;
  if (env("ALLOW_PUBLIC_BOOTSTRAP", "") === "0") return false;
  return !isProduction();
}

export function clientIp(req: Request): string {
  const xf = req.headers.get("x-forwarded-for");
  if (xf) {
    const first = xf.split(",")[0]?.trim();
    if (first) return first.slice(0, 128);
  }
  const real = req.headers.get("x-real-ip")?.trim();
  if (real) return real.slice(0, 128);
  return "unknown";
}

export function normalizeSiteHost(url: string): string {
  const raw = String(url || "").trim();
  if (!raw) return "";
  try {
    const u = new URL(raw.includes("://") ? raw : `https://${raw}`);
    let host = u.hostname.toLowerCase();
    if (host.startsWith("www.")) host = host.slice(4);
    return host;
  } catch {
    return "";
  }
}

export function normalizeSiteUrl(url: string): string {
  const raw = String(url || "").trim().replace(/\/$/, "");
  if (!raw) return "";
  try {
    const u = new URL(raw.includes("://") ? raw : `https://${raw}`);
    u.hash = "";
    u.search = "";
    const href = u.toString().replace(/\/$/, "");
    return href;
  } catch {
    return raw;
  }
}

export function assertSiteBound(
  license: { siteUrl: string },
  siteUrl: string,
  opts?: { requirePresented?: boolean }
): { ok: true } | { ok: false; error: string } {
  const bound = normalizeSiteHost(license.siteUrl);
  const presented = normalizeSiteHost(siteUrl);
  if (!bound) {
    if (opts?.requirePresented && !presented) {
      return { ok: false, error: "site_url required" };
    }
    return { ok: true };
  }
  if (!presented) {
    return { ok: false, error: "site_url required for this license" };
  }
  if (presented !== bound) {
    return { ok: false, error: "License is bound to another site" };
  }
  return { ok: true };
}

/**
 * Open-redirect guard for return_to / return_url.
 * Allows http(s) only; host must match site, panel, or RETURN_TO_ALLOWLIST.
 */
export function isSafeReturnTo(returnTo: string, opts?: { siteUrl?: string; panelUrl?: string }) {
  const raw = String(returnTo || "").trim();
  if (!raw) return false;
  try {
    const u = new URL(raw);
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    if (u.username || u.password) return false;

    const host = u.hostname.toLowerCase();
    const hostNorm = host.startsWith("www.") ? host.slice(4) : host;
    const allowed = new Set<string>();

    for (const part of env("RETURN_TO_ALLOWLIST", "").split(",")) {
      const h = part.trim().toLowerCase();
      if (h) allowed.add(h.startsWith("www.") ? h.slice(4) : h);
    }
    if (opts?.siteUrl) {
      const sh = normalizeSiteHost(opts.siteUrl);
      if (sh) allowed.add(sh);
    }
    const panel = opts?.panelUrl || env("PANEL_PUBLIC_URL", "");
    if (panel) {
      try {
        const ph = new URL(panel).hostname.toLowerCase();
        allowed.add(ph.startsWith("www.") ? ph.slice(4) : ph);
      } catch {
        /* ignore */
      }
    }

    if (allowed.size === 0) {
      return hostNorm === "localhost" || hostNorm === "127.0.0.1" || hostNorm.endsWith(".local");
    }
    return allowed.has(hostNorm) || allowed.has(host);
  } catch {
    return false;
  }
}

export function sanitizeReturnUrl(returnUrl: string, siteUrl = "") {
  const raw = String(returnUrl || "").trim();
  if (!raw) return "";
  return isSafeReturnTo(raw, { siteUrl }) ? raw : "";
}

export function hashLicenseKey(key: string) {
  return createHash("sha256").update(String(key || "").trim().toUpperCase(), "utf8").digest("hex");
}

export function normalizeE164(to: string): string | null {
  const cleaned = String(to || "").trim().replace(/[^\d+]/g, "");
  if (/^\+[1-9]\d{7,14}$/.test(cleaned)) return cleaned;
  if (/^[1-9]\d{7,14}$/.test(cleaned)) return `+${cleaned}`;
  return null;
}

export function waTextMaxChars() {
  const n = Number(env("WA_TEXT_MAX_CHARS", "4096"));
  return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), 4096) : 4096;
}

export function waDailyQuota() {
  const n = Number(env("WA_DAILY_QUOTA", "500"));
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 500;
}

export async function rateLimited(
  key: string,
  max: number,
  windowMs: number
): Promise<NextResponse | null> {
  const rl = await allowRateDurable(key, max, windowMs);
  if (rl.ok) return null;
  return NextResponse.json(
    { error: "Too many requests. Retry shortly." },
    { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } }
  );
}

/** HMAC over validate JSON body (excluding sig fields) for WP tamper check. */
export function signValidatePayload(payload: Record<string, unknown>) {
  const ts = Math.floor(Date.now() / 1000);
  const body = { ...payload, ts };
  const canonical = JSON.stringify(body);
  const secret = env("AUTH_SECRET", "dev-secret-change-me-please-32");
  const sig = createHmac("sha256", secret).update(canonical, "utf8").digest("hex");
  return { ...body, sig };
}

export function clearPlaintextLicenseKeys() {
  return env("LICENSE_CLEAR_PLAINTEXT", "") === "1";
}
