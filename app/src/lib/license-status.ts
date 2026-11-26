export type LicenseLike = {
  active: boolean;
  plan: string;
  expiresAt: Date | string | null;
  waEntitlement?: string | null;
  waExpiresAt?: Date | string | null;
  serverStatus?: string | null;
  serverIp?: string | null;
};

/** Hosted WA SKUs. Legacy DB value "trial" is normalized to none (trial product removed). */
export type WaEntitlement = "none" | "monthly" | "yearly" | "paid";

export function normalizeWaEntitlement(license: LicenseLike): WaEntitlement {
  const raw = String(license.waEntitlement || "").trim().toLowerCase();
  const plan = String(license.plan || "").trim().toLowerCase();

  /* Trial removed (boss 26 Nov) — legacy trial rows behave as unpaid. */
  if (raw === "trial" || plan === "trial") return "none";

  if (raw === "monthly" || raw === "yearly" || raw === "paid") {
    return raw;
  }

  /*
   * DB default after migration is "none". Legacy rows still carry WA in `plan`
   * (paid|monthly|yearly) — prefer that until an explicit WA write happens.
   */
  if (raw === "none" || raw === "") {
    if (plan === "paid" || plan === "monthly" || plan === "yearly") return "paid";
    return "none";
  }

  if (plan === "paid" || plan === "monthly" || plan === "yearly") return "paid";
  return "none";
}

export function waExpiry(license: LicenseLike): Date | string | null {
  if (license.waExpiresAt != null) return license.waExpiresAt;
  // Legacy: expiresAt was WA trial expiry.
  if (normalizeWaEntitlement(license) !== "none") return license.expiresAt;
  return null;
}

export function isExpiredAt(expiresAt: Date | string | null | undefined, now = new Date()) {
  if (!expiresAt) return false;
  const exp = expiresAt instanceof Date ? expiresAt : new Date(expiresAt);
  return exp.getTime() < now.getTime();
}

/** Plugin product ($49) — key present + not revoked. */
export function canUsePlugin(license: LicenseLike) {
  if (!license.active) return { ok: false as const, reason: "inactive" };
  return { ok: true as const, reason: "ok" };
}

/** Hosted WhatsApp entitlement (paid monthly / yearly only). */
export function canUseWhatsApp(license: LicenseLike, now = new Date()) {
  const plugin = canUsePlugin(license);
  if (!plugin.ok) return { ok: false as const, reason: plugin.reason };

  const ent = normalizeWaEntitlement(license);
  if (ent === "none") return { ok: false as const, reason: "no_wa" };

  if (isExpiredAt(waExpiry(license), now)) {
    return { ok: false as const, reason: "expired" };
  }
  return { ok: true as const, reason: "ok" };
}

/**
 * True only for active paid Hosted WA (monthly | yearly | paid).
 * Legacy DB "trial" normalizes to none → false. Use before provision / OpenWA bind.
 */
export function isPaidHostedWa(license: LicenseLike, now = new Date()) {
  return canUseWhatsApp(license, now).ok;
}

/** Guard for provisioner / OpenWA bind — never start from trial or unpaid. */
export function requirePaidHostedWa(license: LicenseLike, now = new Date()) {
  const gate = canUseWhatsApp(license, now);
  if (gate.ok) return gate;
  const msg =
    gate.reason === "no_wa"
      ? "Hosted WhatsApp requires a paid Monthly or Yearly plan (trial removed)."
      : gate.reason === "expired"
        ? "Hosted WhatsApp plan expired — renew Monthly or Yearly before provision."
        : "License inactive — cannot provision Hosted WhatsApp.";
  return { ok: false as const, reason: gate.reason, message: msg };
}

/** @deprecated Use canUseWhatsApp — kept for older call sites. */
export function canUsePremium(license: LicenseLike, now = new Date()) {
  return canUseWhatsApp(license, now);
}

export function isLicenseExpired(license: LicenseLike, now = new Date()) {
  return isExpiredAt(waExpiry(license), now);
}

export function daysLeft(expiresAt: Date | string | null | undefined, now = new Date()) {
  if (!expiresAt) return null;
  const exp = expiresAt instanceof Date ? expiresAt : new Date(expiresAt);
  const ms = exp.getTime() - now.getTime();
  return Math.ceil(ms / (1000 * 60 * 60 * 24));
}

/** @deprecated Trial removed — do not mint new trials. Kept for one-off scripts only. */
export function trialExpiryFromNow(days = 14) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(23, 59, 59, 999);
  return d;
}

/** Keep legacy plan/expiresAt mirrors in sync when writing WA fields. */
export function waWriteFields(entitlement: WaEntitlement, expiresAt: Date | null) {
  const plan = entitlement === "none" ? "none" : "paid";
  return {
    waEntitlement: entitlement,
    waExpiresAt: expiresAt,
    plan,
    expiresAt,
  };
}

export function serverStatusOf(license: LicenseLike) {
  const s = String(license.serverStatus || "none").trim().toLowerCase();
  if (["none", "provisioning", "running", "error", "stopped"].includes(s)) return s;
  return "none";
}

/** OpenWA session → WP/panel health (product copy, no WIP). */
export type SessionHealth = "none" | "ready" | "needs_reconnect" | "waiting_scan" | "starting" | "unknown";

const DROP_STATUSES = new Set([
  "logged_out",
  "logout",
  "disconnected",
  "failed",
  "error",
  "stopped",
  "closed",
  "close",
  "destroyed",
  "killed",
  "unpaired",
]);

const WAIT_STATUSES = new Set(["qr", "qr_ready", "scan", "pending_qr", "pairing"]);

const START_STATUSES = new Set(["starting", "initializing", "loading", "opening", "launching"]);

export function classifySessionHealth(opts: {
  hasSessionId: boolean;
  sessionStatus: string;
  phoneConnected: boolean;
}): SessionHealth {
  if (!opts.hasSessionId) return "none";
  if (opts.phoneConnected) return "ready";
  const st = String(opts.sessionStatus || "").trim().toLowerCase();
  if (!st || st === "unknown" || st === "unconfigured") return "unknown";
  if (st === "ready" || st === "connected" || st === "open") return "ready";
  if (DROP_STATUSES.has(st)) return "needs_reconnect";
  if (WAIT_STATUSES.has(st)) return "waiting_scan";
  if (START_STATUSES.has(st)) return "starting";
  /* Had a session id but not ready → treat as drop so admin can re-scan. */
  return "needs_reconnect";
}

export function sessionHealthMessage(health: SessionHealth, phone = ""): string {
  switch (health) {
    case "ready":
      return phone
        ? `Phone connected (${phone}).`
        : "Phone connected.";
    case "needs_reconnect":
      return "Phone link dropped. Tap Connect phone and scan the new QR to reconnect.";
    case "waiting_scan":
      return "Scan the QR with WhatsApp on your phone (Linked devices).";
    case "starting":
      return "Starting WhatsApp link…";
    case "unknown":
      return "Could not check phone link. Tap Connect phone to refresh.";
    default:
      return "";
  }
}

export const RECONNECT_STEPS =
  "1) Tap Connect phone below. 2) On your phone open WhatsApp → Linked devices → Link a device. 3) Scan the QR. 4) Wait until this page shows Connected.";
