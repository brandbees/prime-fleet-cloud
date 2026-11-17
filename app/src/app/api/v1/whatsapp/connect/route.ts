import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canUsePremium } from "@/lib/license-status";
import { ensureSession, getQr, sessionById, startSession } from "@/lib/openwa";
import { openwaConfig } from "@/lib/env";

/**
 * Plugin QR connect — no OpenWA credentials on the WordPress side.
 * Body: { license_key }
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { license_key?: string };
  const key = String(body.license_key || req.headers.get("x-prime-fleet-license") || "").trim();
  if (!key) return NextResponse.json({ error: "Missing license_key" }, { status: 400 });

  const cfg = openwaConfig();
  if (!cfg.apiKey) {
    return NextResponse.json({ error: "Messaging gateway is not configured on the server." }, { status: 503 });
  }

  const license = await prisma.license.findUnique({ where: { key } });
  if (!license) return NextResponse.json({ error: "Invalid license" }, { status: 403 });
  const gate = canUsePremium(license);
  if (!gate.ok) {
    return NextResponse.json(
      {
        error:
          gate.reason === "trial_expired"
            ? "Trial expired — contact support to continue WhatsApp."
            : "License inactive or expired.",
        reason: gate.reason,
      },
      { status: 403 }
    );
  }

  try {
    const sessionName = `pf-${license.id.slice(0, 8)}`;
    const session = await ensureSession(sessionName, license.openwaSessionId || "");
    if (session.id !== license.openwaSessionId) {
      await prisma.license.update({
        where: { id: license.id },
        data: { openwaSessionId: session.id },
      });
    }

    let status = await fetchSessionStatus(session.id);
    if (status !== "ready" && status !== "qr_ready") {
      await startSession(session.id);
      await new Promise((r) => setTimeout(r, 600));
      status = await fetchSessionStatus(session.id);
    }

    if (status === "ready") {
      const live = await sessionById(session.id);
      const phone = live.phone || "";
      return NextResponse.json({
        status: "connected",
        session_id: session.id,
        phone,
        qr: null,
        message: phone ? `Phone connected · ${phone}` : "Phone connected.",
      });
    }

    const qr = await getQr(session.id);
    if (qr.ok && qr.qr) {
      const dataUrl = qr.qr.startsWith("data:") ? qr.qr : `data:image/png;base64,${qr.qr.replace(/^base64,/, "")}`;
      return NextResponse.json({
        status: status || "qr_ready",
        session_id: session.id,
        qr: dataUrl,
        message: "Scan this QR with WhatsApp on your phone.",
      });
    }

    return NextResponse.json({
      status: status || "starting",
      session_id: session.id,
      qr: null,
      message: qr.message || "Preparing QR… try again in a moment.",
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Connect failed";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}

async function fetchSessionStatus(sessionId: string) {
  // Prefer dedicated helper if session id matches env; otherwise query by id.
  const { baseUrl, apiKey } = openwaConfig();
  if (!apiKey) return "unknown";
  const res = await fetch(`${baseUrl}/api/sessions/${encodeURIComponent(sessionId)}`, {
    headers: { "X-API-Key": apiKey },
    cache: "no-store",
  });
  if (!res.ok) return "unknown";
  const data = (await res.json().catch(() => ({}))) as { status?: string };
  return typeof data.status === "string" ? data.status : "unknown";
}
