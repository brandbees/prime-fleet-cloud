import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendText } from "@/lib/openwa";
import { canUsePremium } from "@/lib/license-status";
import { allowRate } from "@/lib/rate-limit";

/** Plugin premium WhatsApp send — license key in header or body. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    license_key?: string;
    to?: string;
    text?: string;
  };
  const headerKey = req.headers.get("x-prime-fleet-license") || "";
  const key = String(body.license_key || headerKey || "").trim();
  const to = String(body.to || "").trim();
  const text = String(body.text || "").trim();

  if (!key) return NextResponse.json({ error: "Missing license_key" }, { status: 400 });
  if (!to || !text) return NextResponse.json({ error: "to and text required" }, { status: 400 });

  /* Cap burst sends per license + destination (test spam / runaway jobs). */
  const byLic = allowRate(`wa:lic:${key}`, 40, 60_000);
  if (!byLic.ok) {
    return NextResponse.json(
      { error: "Rate limit — too many WhatsApp sends for this license. Retry shortly." },
      { status: 429, headers: { "Retry-After": String(byLic.retryAfterSec) } }
    );
  }
  const byTo = allowRate(`wa:to:${key}:${to}`, 8, 60_000);
  if (!byTo.ok) {
    return NextResponse.json(
      { error: "Rate limit — too many messages to this number. Retry shortly." },
      { status: 429, headers: { "Retry-After": String(byTo.retryAfterSec) } }
    );
  }

  const license = await prisma.license.findUnique({ where: { key } });
  if (!license) {
    return NextResponse.json({ error: "Invalid or inactive license" }, { status: 403 });
  }

  const gate = canUsePremium(license);
  if (!gate.ok) {
    const msg =
      gate.reason === "trial_expired"
        ? "Trial expired — WhatsApp blocked until a paid license is assigned."
        : gate.reason === "expired"
          ? "License expired — WhatsApp blocked."
          : "Invalid or inactive license";
    return NextResponse.json({ error: msg, reason: gate.reason }, { status: 403 });
  }

  try {
    if (!license.openwaSessionId) {
      return NextResponse.json(
        { error: "Phone not connected yet. Open Settings → WhatsApp and scan the QR code." },
        { status: 409 }
      );
    }
    const result = await sendText(to, text, license.openwaSessionId);
    await prisma.messageLog.create({
      data: {
        licenseId: license.id,
        to,
        preview: text.slice(0, 280),
        status: result.status,
        providerId: result.providerId,
      },
    });
    return NextResponse.json({
      ok: true,
      provider_id: result.providerId,
      status: result.status,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Send failed";
    await prisma.messageLog.create({
      data: {
        licenseId: license.id,
        to,
        preview: text.slice(0, 280),
        status: "failed",
        error: msg.slice(0, 500),
      },
    });
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
