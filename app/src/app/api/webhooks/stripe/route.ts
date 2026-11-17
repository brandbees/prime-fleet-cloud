import { NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { activatePaid } from "@/lib/billing";
import { prisma } from "@/lib/prisma";
import { stripeSettings } from "@/lib/settings";

export const runtime = "nodejs";

/**
 * Stripe → POST /api/webhooks/stripe
 * Event: checkout.session.completed → mark license paid (no key paste on WP).
 * No Stripe Customer — one-time Checkout Session only.
 */
export async function POST(req: Request) {
  const stripe = await stripeSettings();
  const secret = stripe.webhookSecret;
  if (!secret || !stripe.secretKey) {
    return NextResponse.json({ error: "Stripe webhook not configured" }, { status: 503 });
  }

  const raw = await req.text();
  const sig = req.headers.get("stripe-signature") || "";
  let event: { type?: string; data?: { object?: Record<string, unknown> } };
  try {
    event = verifyStripeSignature(raw, sig, secret);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Invalid signature";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data?.object || {};
    const meta = (session.metadata || {}) as Record<string, string>;
    const licenseId =
      String(meta.license_id || session.client_reference_id || "").trim();
    const licenseKey = String(meta.license_key || "").trim();

    const license =
      (licenseId && (await prisma.license.findUnique({ where: { id: licenseId } }))) ||
      (licenseKey && (await prisma.license.findUnique({ where: { key: licenseKey } }))) ||
      null;

    if (license) {
      await activatePaid(license.id, "Paid via Stripe checkout");
    }
  }

  return NextResponse.json({ received: true });
}

/** Minimal Stripe signature verify (no stripe SDK). */
function verifyStripeSignature(payload: string, header: string, secret: string) {
  const parts = header.split(",").map((p) => p.trim());
  const ts = parts.find((p) => p.startsWith("t="))?.slice(2);
  const v1 = parts.find((p) => p.startsWith("v1="))?.slice(3);
  if (!ts || !v1) throw new Error("Missing Stripe signature parts");

  const signed = `${ts}.${payload}`;
  const expected = createHmac("sha256", secret).update(signed, "utf8").digest("hex");
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(v1, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new Error("Stripe signature mismatch");
  }
  const age = Math.abs(Date.now() / 1000 - Number(ts));
  if (age > 60 * 5) throw new Error("Stripe signature too old");

  return JSON.parse(payload) as { type?: string; data?: { object?: Record<string, unknown> } };
}
