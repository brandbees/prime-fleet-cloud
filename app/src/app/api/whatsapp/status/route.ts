import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { classifySessionHealth } from "@/lib/license-status";
import { health, sessionById, sessionStatus } from "@/lib/openwa";
import { openwaSettings } from "@/lib/settings";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const cfg = await openwaSettings();
  try {
    const h = await health();
    const envSession = await sessionStatus();

    const licenses = await prisma.license.findMany({
      where: { active: true, openwaSessionId: { not: "" } },
      select: { id: true, label: true, key: true, openwaSessionId: true, siteUrl: true },
      take: 40,
      orderBy: { createdAt: "desc" },
    });

    const licenseSessions = [];
    for (const lic of licenses) {
      const sid = (lic.openwaSessionId || "").trim();
      const live = sid
        ? await sessionById(sid)
        : { ok: false, status: "none", phone: "", http: 0, body: null as unknown };
      const phoneConnected =
        live.ok && ["ready", "connected", "open"].includes(String(live.status || "").toLowerCase());
      const sessHealth = classifySessionHealth({
        hasSessionId: Boolean(sid),
        sessionStatus: live.status,
        phoneConnected,
      });
      licenseSessions.push({
        licenseId: lic.id,
        label: lic.label || lic.key.slice(0, 16),
        siteUrl: lic.siteUrl,
        sessionId: sid || null,
        status: live.status,
        phone: live.phone || "",
        ok: live.ok,
        health: sessHealth,
        needsReconnect: sessHealth === "needs_reconnect",
      });
    }

    const readyCount = licenseSessions.filter((s) => s.health === "ready").length;
    const dropCount = licenseSessions.filter((s) => s.needsReconnect).length;

    return NextResponse.json({
      baseUrl: cfg.baseUrl,
      hasApiKey: Boolean(cfg.apiKey),
      configured: cfg.configured,
      source: cfg.source,
      sessionId: cfg.sessionId || null,
      health: h,
      session: envSession,
      licenseSessions,
      summary: {
        linkedLicenses: licenseSessions.length,
        ready: readyCount,
        needsReconnect: dropCount,
        note:
          dropCount > 0
            ? `${dropCount} license phone link(s) need reconnect — ask the site admin to scan QR again in Settings → WhatsApp.`
            : readyCount > 0
              ? `${readyCount} license phone(s) ready — sessions are per site`
              : "No ready license sessions yet. Connect phone from WordPress Settings → WhatsApp (QR).",
      },
    });
  } catch (e) {
    return NextResponse.json(
      {
        baseUrl: cfg.baseUrl,
        hasApiKey: Boolean(cfg.apiKey),
        configured: cfg.configured,
        source: cfg.source,
        sessionId: cfg.sessionId || null,
        error: e instanceof Error ? e.message : "OpenWA unreachable",
      },
      { status: 502 }
    );
  }
}
