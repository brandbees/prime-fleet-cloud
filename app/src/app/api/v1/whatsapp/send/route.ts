import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendText } from "@/lib/openwa";
import { canUsePremium } from "@/lib/license-status";
import { findLicenseByKey } from "@/lib/licenses";
import {
  assertSiteBound,
  clientIp,
  normalizeE164,
  normalizeSiteUrl,
  rateLimited,
  waDailyQuota,
  waTextMaxChars,
} from "@/lib/security";

/** Plugin premium WhatsApp send — license key in header or body. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    license_key?: string;
    to?: string;
    text?: string;
    site_url?: string;
  };
  const headerKey = req.headers.get("x-prime-fleet-license") || "";
  const key = String(body.license_key || headerKey || "").trim();
  const toRaw = String(body.to || "").trim();
  const text = String(body.text || "").trim();
  const siteUrl = normalizeSiteUrl(String(body.site_url || "").trim());
  const ip = clientIp(req);

  if (!key) return NextResponse.json({ error: "Missing license_key" }, { status: 400 });

  const byLic = rateLimited(`wa:lic:${key.slice(0, 24)}`, 40, 60_000);
  if (byLic) {
    return NextResponse.json(
      { error: "Rate limit — too many WhatsApp sends for this license. Retry shortly." },
      { status: 429, headers: byLic.headers }
    );
  }
  const byIp = rateLimited(`wa:ip:${ip}`, 80, 60_000);
  if (byIp) return byIp;

  const to = normalizeE164(toRaw);
  if (!to) {
    return NextResponse.json(
      { error: "Invalid destination. Use international format (E.164), e.g. +14155552671." },
      { status: 400 }
    );
  }
  const maxChars = waTextMaxChars();
  if (!text) return NextResponse.json({ error: "to and text required" }, { status: 400 });
  if (text.length > maxChars) {
    return NextResponse.json(
      { error: `Message too long (max ${maxChars} characters).` },
      { status: 400 }
    );
  }

  const byTo = rateLimited(`wa:to:${key.slice(0, 24)}:${to}`, 8, 60_000);
  if (byTo) {
    return NextResponse.json(
      { error: "Rate limit — too many messages to this number. Retry shortly." },
      { status: 429, headers: byTo.headers }
    );
  }

  const license = await findLicenseByKey(key);
  if (!license) {
    return NextResponse.json({ error: "Invalid or inactive license" }, { status: 403 });
  }

  const siteCheck = assertSiteBound(license, siteUrl);
  if (!siteCheck.ok) {
    return NextResponse.json({ error: siteCheck.error }, { status: 403 });
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

  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  const sentToday = await prisma.messageLog.count({
    where: {
      licenseId: license.id,
      createdAt: { gte: dayStart },
      status: { not: "failed" },
    },
  });
  const quota = waDailyQuota();
  if (sentToday >= quota) {
    return NextResponse.json(
      { error: `Daily WhatsApp quota reached (${quota}). Try again tomorrow.` },
      { status: 429 }
    );
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
