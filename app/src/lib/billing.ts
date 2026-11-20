import { SignJWT, jwtVerify } from "jose";
import { prisma } from "./prisma";
import { env } from "./env";
import { stripeSettings } from "./settings";
import { waWriteFields } from "./license-status";
import { findLicenseByKey } from "./licenses";
import {
  getAuthSecretBytes,
  mockCheckoutAllowed,
  sanitizeReturnUrl,
} from "./security";
import { newJti } from "./tokens";

export function panelPublicUrl() {
  return env("PANEL_PUBLIC_URL", "http://127.0.0.1:3000").replace(/\/$/, "");
}

export async function stripeConfigured() {
  const s = await stripeSettings();
  return s.configured;
}

/**
 * Mark hosted WA paid + kick provision.
 * Refuses revoked licenses. Idempotent on Stripe session id.
 */
export async function activatePaid(
  licenseId: string,
  note = "paid via checkout",
  opts?: { sessionId?: string }
) {
  const license = await prisma.license.findUnique({ where: { id: licenseId } });
  if (!license) throw new Error("License not found");
  if (!license.active) {
    throw new Error("License revoked — payment cannot reactivate. Contact support.");
  }

  const sessionId = String(opts?.sessionId || "").trim();
  if (sessionId) {
    const prior = await prisma.stripeProcessed.findUnique({ where: { id: sessionId } });
    if (prior) {
      return license;
    }
    if (license.lastPaidSessionId === sessionId) {
      return license;
    }
  }

  const updated = await prisma.license.update({
    where: { id: licenseId },
    data: {
      ...waWriteFields("paid", null),
      active: true,
      notes: note.slice(0, 500),
      ...(sessionId ? { lastPaidSessionId: sessionId } : {}),
    },
  });

  if (sessionId) {
    try {
      await prisma.stripeProcessed.create({
        data: { id: sessionId, kind: "session", licenseId },
      });
    } catch {
      /* unique — already processed */
    }
  }

  try {
    const { startProvision } = await import("./provisioner");
    await startProvision(licenseId, `${note} → provision`);
  } catch {
    /* Provision errors stay on WaInstance; paid entitlement still applied. */
  }
  return prisma.license.findUniqueOrThrow({ where: { id: licenseId } }) || updated;
}

/** Drop hosted WA after refund/dispute (plugin license stays unless revoked separately). */
export async function revokeWhatsAppEntitlement(licenseId: string, note: string) {
  const license = await prisma.license.update({
    where: { id: licenseId },
    data: {
      ...waWriteFields("none", null),
      notes: note.slice(0, 500),
    },
  });
  try {
    const { powerOffInstance } = await import("./provisioner");
    await powerOffInstance(licenseId);
  } catch {
    /* optional */
  }
  return license;
}

function authSecret() {
  return getAuthSecretBytes();
}

/** Short-lived token for mock checkout pages (one-time jti). */
export async function signPayToken(licenseId: string, licenseKey: string) {
  const jti = newJti();
  return new SignJWT({ lid: licenseId, key: licenseKey, purpose: "pay_mock" })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("2h")
    .setIssuedAt()
    .setJti(jti)
    .sign(authSecret());
}

export async function verifyPayToken(token: string) {
  const { payload } = await jwtVerify(token, authSecret());
  if (payload.purpose && payload.purpose !== "pay_mock") {
    throw new Error("Invalid pay token");
  }
  const lid = typeof payload.lid === "string" ? payload.lid : "";
  const key = typeof payload.key === "string" ? payload.key : "";
  const jti = typeof payload.jti === "string" ? payload.jti : "";
  if (!lid || !key) throw new Error("Invalid pay token");
  return {
    licenseId: lid,
    licenseKey: key,
    jti,
    exp: typeof payload.exp === "number" ? payload.exp : 0,
  };
}

export async function createCheckoutForLicense(licenseKey: string, returnUrl = "") {
  const license = await findLicenseByKey(licenseKey);
  if (!license) throw new Error("Invalid license");
  if (!license.active) throw new Error("License inactive");

  const base = panelPublicUrl();
  const token = await signPayToken(license.id, license.key);
  const safeReturn = sanitizeReturnUrl(returnUrl, license.siteUrl);
  const successQs = new URLSearchParams();
  if (safeReturn) successQs.set("return_to", safeReturn);
  successQs.set("license", license.key);
  const success = `${base}/pay/success?${successQs.toString()}&session_id={CHECKOUT_SESSION_ID}`;
  const cancel = `${base}/pay/cancel`;

  const stripe = await stripeSettings();
  if (!stripe.configured) {
    if (!mockCheckoutAllowed()) {
      throw new Error(
        "Stripe is not configured. Set Billing keys in the portal (or ALLOW_MOCK_CHECKOUT=1 for local only)."
      );
    }
    return {
      mode: "mock" as const,
      checkout_url: `${base}/pay/mock?token=${encodeURIComponent(token)}`,
      license_key: license.key,
    };
  }

  const secret = stripe.secretKey;
  const priceId = stripe.priceId;
  const amountCents = stripe.amountCents;
  const currency = stripe.currency;

  const params = new URLSearchParams();
  params.set("mode", "payment");
  params.set("success_url", success);
  params.set("cancel_url", cancel);
  params.set("client_reference_id", license.id);
  params.set("metadata[license_key]", license.key);
  params.set("metadata[license_id]", license.id);
  params.set("payment_intent_data[metadata][license_key]", license.key);
  params.set("payment_intent_data[metadata][license_id]", license.id);

  if (priceId) {
    params.set("line_items[0][price]", priceId);
    params.set("line_items[0][quantity]", "1");
  } else {
    params.set("line_items[0][price_data][currency]", currency);
    params.set("line_items[0][price_data][unit_amount]", String(amountCents));
    params.set("line_items[0][price_data][product_data][name]", "Prime Fleet WhatsApp");
    params.set(
      "line_items[0][price_data][product_data][description]",
      "WhatsApp messaging for your booking site"
    );
    params.set("line_items[0][quantity]", "1");
  }

  const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });
  const data = (await res.json()) as { id?: string; url?: string; error?: { message?: string } };
  if (!res.ok || !data.url) {
    throw new Error(data.error?.message || "Could not start checkout");
  }
  return {
    mode: "stripe" as const,
    checkout_url: data.url,
    session_id: data.id || "",
    license_key: license.key,
  };
}
