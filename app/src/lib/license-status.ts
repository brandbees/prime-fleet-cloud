export type LicenseLike = {
  active: boolean;
  plan: string;
  expiresAt: Date | string | null;
  waEntitlement?: string | null;
  waExpiresAt?: Date | string | null;
  serverStatus?: string | null;
  serverIp?: string | null;
};

export type WaEntitlement = "none" | "trial" | "monthly" | "yearly" | "paid";

export function normalizeWaEntitlement(license: LicenseLike): WaEntitlement {
  const raw = String(license.waEntitlement || "").trim().toLowerCase();
  const plan = String(license.plan || "").trim().toLowerCase();

  if (raw === "trial" || raw === "monthly" || raw === "yearly" || raw === "paid") {
    return raw;
  }

  /*
   * DB default after migration is "none". Legacy rows still carry WA in `plan`
   * (trial|paid) — prefer that until an explicit WA write happens.
   */
  if (raw === "none" || raw === "") {
    if (plan === "trial") return "trial";
    if (plan === "paid" || plan === "monthly" || plan === "yearly") return "paid";
    return "none";
  }

  if (plan === "trial") return "trial";
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

/** Hosted WhatsApp entitlement (trial / paid plans). */
export function canUseWhatsApp(license: LicenseLike, now = new Date()) {
  const plugin = canUsePlugin(license);
  if (!plugin.ok) return { ok: false as const, reason: plugin.reason };

  const ent = normalizeWaEntitlement(license);
  if (ent === "none") return { ok: false as const, reason: "no_wa" };

  if (isExpiredAt(waExpiry(license), now)) {
    return {
      ok: false as const,
      reason: ent === "trial" ? "trial_expired" : "expired",
    };
  }
  return { ok: true as const, reason: "ok" };
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

export function trialExpiryFromNow(days = 14) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(23, 59, 59, 999);
  return d;
}

/** Keep legacy plan/expiresAt mirrors in sync when writing WA fields. */
export function waWriteFields(entitlement: WaEntitlement, expiresAt: Date | null) {
  const plan =
    entitlement === "none" ? "none" : entitlement === "trial" ? "trial" : "paid";
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
