import { SignJWT, jwtVerify } from "jose";
import { prisma } from "./prisma";
import { newLicenseKeyFields } from "./licenses";
import { waWriteFields } from "./license-status";
import { verifyEnvatoPurchaseCode } from "./envato";
import { panelPublicUrl } from "./billing";
import { getAuthSecretBytes, normalizeSiteUrl, sanitizeReturnUrl } from "./security";
import { consumeJti, newJti } from "./tokens";

function authSecret() {
  return getAuthSecretBytes();
}

/** Short-lived one-time token so WP can claim the key without putting it in the URL forever. */
export async function signActivateToken(licenseKey: string, siteUrl = "") {
  const jti = newJti();
  return new SignJWT({
    key: licenseKey,
    site: siteUrl,
    purpose: "wp_activate",
  })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("15m")
    .setIssuedAt()
    .setJti(jti)
    .sign(authSecret());
}

export async function verifyActivateToken(token: string) {
  const { payload } = await jwtVerify(token, authSecret());
  if (payload.purpose !== "wp_activate") throw new Error("Invalid activate token");
  const key = typeof payload.key === "string" ? payload.key : "";
  const jti = typeof payload.jti === "string" ? payload.jti : "";
  if (!key || !jti) throw new Error("Invalid activate token");

  const expSec = typeof payload.exp === "number" ? payload.exp : 0;
  const expiresAt = expSec ? new Date(expSec * 1000) : new Date(Date.now() + 15 * 60_000);
  const first = await consumeJti(jti, "wp_activate", expiresAt);
  if (!first) throw new Error("Activate link already used");

  return {
    licenseKey: key,
    siteUrl: typeof payload.site === "string" ? payload.site : "",
  };
}

/**
 * Verify Envato (or mock) purchase code → find/create plugin license (WA none by default).
 */
export async function issueLicenseFromPurchaseCode(opts: {
  purchaseCode: string;
  siteUrl?: string;
  label?: string;
}) {
  const purchaseCode = String(opts.purchaseCode || "").trim();
  const siteUrl = normalizeSiteUrl(String(opts.siteUrl || "").trim());
  const verified = await verifyEnvatoPurchaseCode(purchaseCode);
  if (!verified.ok) {
    return { ok: false as const, error: verified.error };
  }

  const existing = await prisma.license.findFirst({
    where: { purchaseCode },
  });

  if (existing) {
    if (!existing.active) {
      return { ok: false as const, error: "This purchase was revoked. Contact support." };
    }
    if (siteUrl && existing.siteUrl) {
      const { assertSiteBound } = await import("./security");
      const bound = assertSiteBound(existing, siteUrl);
      if (!bound.ok) {
        return {
          ok: false as const,
          error: "This purchase code is already activated on another site.",
        };
      }
    }
    const data: { siteUrl?: string; label?: string; notes?: string } = {};
    if (siteUrl && !existing.siteUrl) data.siteUrl = siteUrl;
    if (opts.label && existing.label.startsWith("Envato")) data.label = String(opts.label).trim();
    const row =
      Object.keys(data).length > 0
        ? await prisma.license.update({ where: { id: existing.id }, data })
        : existing;
    const token = await signActivateToken(row.key, siteUrl || row.siteUrl);
    return {
      ok: true as const,
      license: row,
      activate_token: token,
      reused: true,
      mock: verified.mock,
    };
  }

  const label =
    String(opts.label || "").trim() ||
    (verified.buyer ? `Envato · ${verified.buyer}` : verified.itemName || "Envato purchase");

  const { plaintext, ...keyFields } = newLicenseKeyFields();
  try {
    const row = await prisma.license.create({
      data: {
        ...keyFields,
        label,
        siteUrl,
        active: true,
        purchaseCode,
        purchaseSource: verified.mock ? "envato-mock" : "envato",
        serverStatus: "none",
        serverIp: "",
        notes: verified.mock
          ? "Issued via mock Envato (local)"
          : `Envato sale ${verified.soldAt || ""}`.trim(),
        ...waWriteFields("none", null),
      },
    });

    const token = await signActivateToken(plaintext, siteUrl);
    return {
      ok: true as const,
      license: row,
      activate_token: token,
      reused: false,
      mock: verified.mock,
    };
  } catch (e) {
    /* Race on purchaseCode — re-read */
    const raced = await prisma.license.findFirst({ where: { purchaseCode } });
    if (raced?.active) {
      const token = await signActivateToken(raced.key, siteUrl || raced.siteUrl);
      return {
        ok: true as const,
        license: raced,
        activate_token: token,
        reused: true,
        mock: verified.mock,
      };
    }
    throw e;
  }
}

export function activatePageUrl(returnTo: string, siteUrl: string) {
  const base = panelPublicUrl();
  const qs = new URLSearchParams();
  const safe = sanitizeReturnUrl(returnTo, siteUrl);
  if (safe) qs.set("return_to", safe);
  if (siteUrl) qs.set("site_url", siteUrl);
  return `${base}/activate?${qs.toString()}`;
}
