import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canUsePremium, daysLeft } from "@/lib/license-status";
import { sessionById } from "@/lib/openwa";

/** Plugin polls this — no key shown to the user. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { license_key?: string };
  const key = String(body.license_key || req.headers.get("x-prime-fleet-license") || "").trim();
  if (!key) return NextResponse.json({ error: "Missing license_key" }, { status: 400 });

  const license = await prisma.license.findUnique({ where: { key } });
  if (!license) return NextResponse.json({ error: "Invalid license" }, { status: 403 });

  const gate = canUsePremium(license);
  const needsPayment = !gate.ok;

  let phoneConnected = false;
  let phone = "";
  let sessionStatus = "";
  if (license.openwaSessionId) {
    try {
      const sess = await sessionById(license.openwaSessionId);
      sessionStatus = sess.status;
      phoneConnected = sess.ok && sess.status === "ready";
      phone = phoneConnected ? String(sess.phone || "") : "";
    } catch {
      sessionStatus = "unknown";
    }
  }

  return NextResponse.json({
    ok: gate.ok,
    plan: license.plan,
    reason: gate.reason,
    needs_payment: needsPayment,
    expires_at: license.expiresAt,
    days_left: daysLeft(license.expiresAt),
    phone_connected: phoneConnected,
    phone,
    session_status: sessionStatus,
    message: gate.ok
      ? phoneConnected
        ? phone
          ? `Phone connected (${phone}).`
          : "Phone already connected."
        : license.plan === "trial"
          ? `Trial active${daysLeft(license.expiresAt) != null ? ` · ${daysLeft(license.expiresAt)} days left` : ""}. Connect your phone to send.`
          : "WhatsApp plan active. Connect your phone to send."
      : gate.reason === "trial_expired"
        ? "Trial ended. Update your plan to keep sending messages."
        : "License inactive or expired. Update your plan to continue.",
  });
}
