import { NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { activatePaid, revokeWhatsAppEntitlement } from "@/lib/billing";
import { prisma } from "@/lib/prisma";
import { stripeSettings } from "@/lib/settings";
import { clientIp, rateLimited } from "@/lib/security";
import { findLicenseByKey } from "@/lib/licenses";

export const runtime = "nodejs";

/**
 * Stripe → POST /api/webhooks/stripe
 * checkout.session.completed → mark license paid (payment_status=paid only).
 * refund/dispute → drop WA entitlement.
 */
export async function POST(req: Request) {
  const limited = rateLimited(`stripe:wh:${clientIp(req)}`, 120, 60_000);
  if (limited) return limited;

  const stripe = await stripeSettings();
  const secret = stripe.webhookSecret;
  if (!secret || !stripe.secretKey) {
    return NextResponse.json({ error: "Stripe webhook not configured" }, { status: 503 });
  }

  const raw = await req.text();
  const sig = req.headers.get("stripe-signature") || "";
  let event: {
    id?: string;
    type?: string;
    data?: { object?: Record<string, unknown> };
  };
  try {
    event = verifyStripeSignature(raw, sig, secret);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Invalid signature";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  const eventId = String(event.id || "").trim();
  if (eventId) {
    const seen = await prisma.stripeProcessed.findUnique({ where: { id: `evt:${eventId}` } });
    if (seen) {
      return NextResponse.json({ received: true, duplicate: true });
    }
  }

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data?.object || {};
      const paymentStatus = String(session.payment_status || "");
      if (paymentStatus !== "paid") {
        return NextResponse.json({ received: true, skipped: "not_paid" });
      }

      const meta = (session.metadata || {}) as Record<string, string>;
      const licenseId = String(meta.license_id || session.client_reference_id || "").trim();
      const licenseKey = String(meta.license_key || "").trim();
      const sessionId = String(session.id || "").trim();

      const license =
        (licenseId && (await prisma.license.findUnique({ where: { id: licenseId } }))) ||
        (licenseKey && (await findLicenseByKey(licenseKey))) ||
        null;

      if (license) {
        try {
          await activatePaid(license.id, "Paid via Stripe checkout", { sessionId });
        } catch (e) {
          const msg = e instanceof Error ? e.message : "activate failed";
          console.error("[stripe webhook] activatePaid", msg);
        }
      }
    }

    if (
      event.type === "charge.refunded" ||
      event.type === "charge.dispute.created" ||
      event.type === "payment_intent.payment_failed"
    ) {
      const obj = event.data?.object || {};
      const meta = (obj.metadata || {}) as Record<string, string>;
      const licenseId = String(meta.license_id || "").trim();
      const licenseKey = String(meta.license_key || "").trim();
      const license =
        (licenseId && (await prisma.license.findUnique({ where: { id: licenseId } }))) ||
        (licenseKey && (await findLicenseByKey(licenseKey))) ||
        null;
      if (license) {
        await revokeWhatsAppEntitlement(
          license.id,
          `WA revoked after Stripe ${event.type}`
        );
      }
    }
  } finally {
    if (eventId) {
      try {
        await prisma.stripeProcessed.create({
          data: { id: `evt:${eventId}`, kind: "event", licenseId: "" },
        });
      } catch {
        /* duplicate */
      }
    }
  }

  return NextResponse.json({ received: true });
}

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

  return JSON.parse(payload) as {
    id?: string;
    type?: string;
    data?: { object?: Record<string, unknown> };
  };
}
