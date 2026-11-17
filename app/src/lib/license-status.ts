export type LicenseLike = {
  active: boolean;
  plan: string;
  expiresAt: Date | string | null;
};

export function isLicenseExpired(license: LicenseLike, now = new Date()) {
  if (!license.expiresAt) return false;
  const exp = license.expiresAt instanceof Date ? license.expiresAt : new Date(license.expiresAt);
  return exp.getTime() < now.getTime();
}

/** Usable for WhatsApp / premium features. */
export function canUsePremium(license: LicenseLike, now = new Date()) {
  if (!license.active) return { ok: false as const, reason: "inactive" };
  if (isLicenseExpired(license, now)) {
    return {
      ok: false as const,
      reason: license.plan === "trial" ? "trial_expired" : "expired",
    };
  }
  return { ok: true as const, reason: "ok" };
}

export function daysLeft(expiresAt: Date | string | null, now = new Date()) {
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
