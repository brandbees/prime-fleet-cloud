import { SignJWT, jwtVerify } from "jose";
import { prisma } from "./prisma";
import { env } from "./env";
import {
  stripeSettings,
  WA_MONTHLY_CENTS,
  WA_YEARLY_CENTS,
} from "./settings";
import { waWriteFields, type WaEntitlement } from "./license-status";
import { findLicenseByKey } from "./licenses";
import {
  getAuthSecretBytes,
  mockCheckoutAllowed,
  sanitizeReturnUrl,
} from "./security";
import { newJti } from "./tokens";

export type WaBillingPlan = "monthly" | "yearly";

export function normalizeWaBillingPlan(raw: unknown): WaBillingPlan {
  const v = String(raw || "")
    .trim()
    .toLowerCase();
  return v === "yearly" ? "yearly" : "monthly";
}

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
  opts?: { sessionId?: string; plan?: WaBillingPlan | "paid" }
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

  const planOpt = String(opts?.plan || "").trim().toLowerCase();
  const entitlement: WaEntitlement =
    planOpt === "yearly" ? "yearly" : planOpt === "monthly" ? "monthly" : "paid";

  const updated = await prisma.license.update({
    where: { id: licenseId },
    data: {
      ...waWriteFields(entitlement, null),
      active: true,
      waUnpaidAt: null,
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

/**
 * Stripe cancel / refund / dispute → stop sends immediately, start 3-day grace, then power-off.
 * Pass `{ immediatePowerOff: true }` for hard cut (admin / destroy path).
 */
export async function revokeWhatsAppEntitlement(
  licenseId: string,
  note: string,
  opts?: { immediatePowerOff?: boolean }
) {
  if (opts?.immediatePowerOff) {
    const license = await prisma.license.update({
      where: { id: licenseId },
      data: {
        ...waWriteFields("none", null),
        waUnpaidAt: null,
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

  const { startUnpaidGrace } = await import("./grace");
  return startUnpaidGrace(licenseId, note);
}

function authSecret() {
  return getAuthSecretBytes();
}

/** Short-lived token for mock checkout pages (one-time jti). */
export async function signPayToken(
  licenseId: string,
  licenseKey: string,
  plan: WaBillingPlan = "monthly"
) {
  const jti = newJti();
  return new SignJWT({
    lid: licenseId,
    key: licenseKey,
    purpose: "pay_mock",
    wa_plan: plan,
  })
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
    plan: normalizeWaBillingPlan(payload.wa_plan),
    exp: typeof payload.exp === "number" ? payload.exp : 0,
  };
}

export async function createCheckoutForLicense(
  licenseKey: string,
  returnUrl = "",
  planRaw: string = "monthly"
) {
  const license = await findLicenseByKey(licenseKey);
  if (!license) throw new Error("Invalid license");
  if (!license.active) throw new Error("License inactive");

  const plan = normalizeWaBillingPlan(planRaw);
  const base = panelPublicUrl();
  const token = await signPayToken(license.id, license.key, plan);
  const safeReturn = sanitizeReturnUrl(returnUrl, license.siteUrl);
  const successQs = new URLSearchParams();
  if (safeReturn) successQs.set("return_to", safeReturn);
  successQs.set("license", license.key);
  const success = `${base}/pay/success?${successQs.toString()}&session_id={CHECKOUT_SESSION_ID}`;
  const cancelQs = new URLSearchParams();
  if (safeReturn) cancelQs.set("return_to", safeReturn);
  const cancel = cancelQs.toString()
    ? `${base}/pay/cancel?${cancelQs.toString()}`
    : `${base}/pay/cancel`;

  const stripe = await stripeSettings();
  if (!stripe.configured) {
    if (!mockCheckoutAllowed()) {
      throw new Error(
        "Stripe is not configured. Set Billing keys in the portal (or ALLOW_MOCK_CHECKOUT=1 for local only)."
      );
    }
    return {
      mode: "mock" as const,
      plan,
      checkout_url: `${base}/pay/mock?token=${encodeURIComponent(token)}&plan=${plan}`,
      license_key: license.key,
    };
  }

  const secret = stripe.secretKey;
  const currency = stripe.currency || "usd";
  const priceId =
    plan === "yearly" ? stripe.priceIdYearly : stripe.priceIdMonthly;
  const amountCents = plan === "yearly" ? WA_YEARLY_CENTS : WA_MONTHLY_CENTS;
  const interval = plan === "yearly" ? "year" : "month";
  const productName =
    plan === "yearly"
      ? "Prime Fleet Hosted WhatsApp (Yearly)"
      : "Prime Fleet Hosted WhatsApp (Monthly)";
  const productDesc =
    plan === "yearly"
      ? "$10/mo billed yearly ($120/year) — dedicated hosted WhatsApp"
      : "$15/mo — dedicated hosted WhatsApp";

  const params = new URLSearchParams();
  params.set("mode", "subscription");
  params.set("success_url", success);
  params.set("cancel_url", cancel);
  params.set("client_reference_id", license.id);
  params.set("metadata[license_key]", license.key);
  params.set("metadata[license_id]", license.id);
  params.set("metadata[wa_plan]", plan);
  params.set("subscription_data[metadata][license_key]", license.key);
  params.set("subscription_data[metadata][license_id]", license.id);
  params.set("subscription_data[metadata][wa_plan]", plan);

  if (priceId) {
    params.set("line_items[0][price]", priceId);
    params.set("line_items[0][quantity]", "1");
  } else {
    params.set("line_items[0][price_data][currency]", currency);
    params.set("line_items[0][price_data][unit_amount]", String(amountCents));
    params.set("line_items[0][price_data][recurring][interval]", interval);
    params.set("line_items[0][price_data][product_data][name]", productName);
    params.set("line_items[0][price_data][product_data][description]", productDesc);
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
    plan,
    checkout_url: data.url,
    session_id: data.id || "",
    license_key: license.key,
  };
}
