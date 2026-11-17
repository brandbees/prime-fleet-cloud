import { SignJWT, jwtVerify } from "jose";
import { prisma } from "./prisma";
import { env } from "./env";
import { stripeSettings } from "./settings";

export function panelPublicUrl() {
  return env("PANEL_PUBLIC_URL", "http://127.0.0.1:3000").replace(/\/$/, "");
}

export async function stripeConfigured() {
  const s = await stripeSettings();
  return s.configured;
}

export async function activatePaid(licenseId: string, note = "paid via checkout") {
  return prisma.license.update({
    where: { id: licenseId },
    data: {
      plan: "paid",
      expiresAt: null,
      active: true,
      notes: note.slice(0, 500),
    },
  });
}

function authSecret() {
  const s = env("AUTH_SECRET", "change-me-local-auth-secret-32chars");
  return new TextEncoder().encode(s);
}

/** Short-lived token for mock (or Stripe success return) checkout pages. */
export async function signPayToken(licenseId: string, licenseKey: string) {
  return new SignJWT({ lid: licenseId, key: licenseKey })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("2h")
    .setIssuedAt()
    .sign(authSecret());
}

export async function verifyPayToken(token: string) {
  const { payload } = await jwtVerify(token, authSecret());
  const lid = typeof payload.lid === "string" ? payload.lid : "";
  const key = typeof payload.key === "string" ? payload.key : "";
  if (!lid || !key) throw new Error("Invalid pay token");
  return { licenseId: lid, licenseKey: key };
}

export async function createCheckoutForLicense(licenseKey: string, returnUrl = "") {
  const license = await prisma.license.findUnique({ where: { key: licenseKey } });
  if (!license) throw new Error("Invalid license");
  if (!license.active) throw new Error("License inactive");

  const base = panelPublicUrl();
  const token = await signPayToken(license.id, license.key);
  /* Always land on cloud success first so we can activate even if webhook/CLI missed. */
  const successQs = new URLSearchParams();
  if (returnUrl) successQs.set("return_to", returnUrl);
  successQs.set("license", license.key);
  const success = `${base}/pay/success?${successQs.toString()}&session_id={CHECKOUT_SESSION_ID}`;
  const cancel = `${base}/pay/cancel`;

  const stripe = await stripeSettings();
  if (!stripe.configured) {
    const allowMock =
      process.env.ALLOW_MOCK_CHECKOUT === "1" || process.env.NODE_ENV !== "production";
    if (!allowMock) {
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

  /* One-time Checkout only — no Stripe Customer object. */
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
