import { NextResponse } from "next/server";
import { activatePaid } from "@/lib/billing";
import { prisma } from "@/lib/prisma";
import { stripeSettings } from "@/lib/settings";
import { findLicenseByKey } from "@/lib/licenses";
import { clientIp, rateLimited } from "@/lib/security";

/**
 * After Stripe Checkout — activate from session_id (backup when webhook missed).
 * Only activates when Stripe reports payment_status=paid. Idempotent.
 */
export async function POST(req: Request) {
  const limited = rateLimited(`billing:confirm:${clientIp(req)}`, 20, 60_000);
  if (limited) return limited;

  const body = (await req.json().catch(() => ({}))) as { session_id?: string };
  const url = new URL(req.url);
  const sessionId = String(body.session_id || url.searchParams.get("session_id") || "").trim();
  if (!sessionId) return NextResponse.json({ error: "session_id required" }, { status: 400 });
  if (!/^cs_[a-zA-Z0-9_]+$/.test(sessionId)) {
    return NextResponse.json({ error: "Invalid session_id" }, { status: 400 });
  }

  const stripe = await stripeSettings();
  if (!stripe.secretKey) {
    return NextResponse.json({ error: "Stripe not configured" }, { status: 503 });
  }

  const res = await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`, {
    headers: { Authorization: `Bearer ${stripe.secretKey}` },
    cache: "no-store",
  });
  const session = (await res.json()) as {
    id?: string;
    payment_status?: string;
    status?: string;
    client_reference_id?: string | null;
    metadata?: Record<string, string>;
    error?: { message?: string };
  };
  if (!res.ok) {
    return NextResponse.json({ error: session.error?.message || "Could not load Stripe session" }, { status: 502 });
  }

  if (session.payment_status !== "paid") {
    return NextResponse.json(
      { error: "Payment not completed yet", payment_status: session.payment_status, status: session.status },
      { status: 402 }
    );
  }

  const licenseId = String(session.metadata?.license_id || session.client_reference_id || "").trim();
  const licenseKey = String(session.metadata?.license_key || "").trim();
  const license =
    (licenseId && (await prisma.license.findUnique({ where: { id: licenseId } }))) ||
    (licenseKey && (await findLicenseByKey(licenseKey))) ||
    null;

  if (!license) {
    return NextResponse.json({ error: "License not found for this payment" }, { status: 404 });
  }

  try {
    await activatePaid(license.id, "Paid via Stripe checkout", { sessionId });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Activation failed";
    return NextResponse.json({ error: msg }, { status: 403 });
  }
  return NextResponse.json({ ok: true, plan: "paid", license_key: license.key });
}
