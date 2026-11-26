import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  canUsePlugin,
  canUseWhatsApp,
  classifySessionHealth,
  daysLeft,
  normalizeWaEntitlement,
  RECONNECT_STEPS,
  serverStatusOf,
  sessionHealthMessage,
  waExpiry,
} from "@/lib/license-status";
import { sessionById } from "@/lib/openwa";
import { findLicenseByKey } from "@/lib/licenses";
import {
  assertSiteBound,
  clientIp,
  normalizeSiteUrl,
  rateLimited,
} from "@/lib/security";

/** Plugin polls this — no key shown to the user. */
export async function POST(req: Request) {
  const limited = await rateLimited(`license:status:${clientIp(req)}`, 90, 60_000);
  if (limited) return limited;

  const body = (await req.json().catch(() => ({}))) as { license_key?: string; site_url?: string };
  const key = String(body.license_key || req.headers.get("x-prime-fleet-license") || "").trim();
  if (!key) return NextResponse.json({ error: "Missing license_key" }, { status: 400 });

  let license = await findLicenseByKey(key);
  if (!license) return NextResponse.json({ error: "Invalid license" }, { status: 403 });

  const siteUrl = normalizeSiteUrl(String(body.site_url || "").trim());
  const siteCheck = assertSiteBound(license, siteUrl);
  if (!siteCheck.ok) {
    return NextResponse.json({ error: siteCheck.error }, { status: 403 });
  }

  /* Advance mock provision while WP polls. */
  try {
    const { tickMockProvision } = await import("@/lib/provisioner");
    await tickMockProvision(license.id);
    license = (await prisma.license.findUnique({ where: { id: license.id } })) || license;
  } catch {
    /* ignore tick errors */
  }

  const plugin = canUsePlugin(license);
  const wa = canUseWhatsApp(license);
  const ent = normalizeWaEntitlement(license);
  const exp = waExpiry(license);
  const needsPayment = !wa.ok;
  const serverStatus = serverStatusOf(license);
  const serverIp = license.serverIp || "";

  let phoneConnected = false;
  let phone = "";
  let sessionStatus = "";
  const hasSessionId = Boolean(license.openwaSessionId);
  if (hasSessionId) {
    try {
      const sess = await sessionById(license.openwaSessionId!);
      sessionStatus = sess.status;
      phoneConnected = sess.ok && ["ready", "connected", "open"].includes(String(sess.status || "").toLowerCase());
      phone = phoneConnected ? String(sess.phone || "") : "";
    } catch {
      sessionStatus = "unknown";
    }
  }

  const sessionHealth = classifySessionHealth({
    hasSessionId,
    sessionStatus,
    phoneConnected,
  });
  const healthMsg = sessionHealthMessage(sessionHealth, phone);

  let waMessage = !plugin.ok
    ? "License inactive or revoked."
    : wa.ok
      ? healthMsg || "WhatsApp plan active. Connect your phone to send."
      : wa.reason === "no_wa"
        ? "No WhatsApp plan on this license. Choose Monthly or Yearly to enable hosted WhatsApp."
        : "WhatsApp plan inactive or expired. Update your plan to continue.";

  if (wa.ok && serverStatus === "provisioning") {
    waMessage = "Preparing Hosted WhatsApp… This usually takes a minute.";
  } else if (wa.ok && serverStatus === "error") {
    waMessage = "Hosted WhatsApp setup failed. Retry from the panel or contact support.";
  } else if (wa.ok && serverStatus === "stopped") {
    waMessage = "Hosted WhatsApp is paused. Update your plan or ask support to restart.";
  }

  const needsReconnect = wa.ok && sessionHealth === "needs_reconnect";

  return NextResponse.json({
    ok: wa.ok,
    plugin_ok: plugin.ok,
    plan: license.plan,
    wa_entitlement: ent,
    reason: wa.ok ? "ok" : wa.reason,
    needs_payment: needsPayment,
    expires_at: exp,
    days_left: daysLeft(exp),
    phone_connected: phoneConnected,
    phone,
    session_status: sessionStatus,
    session_health: sessionHealth,
    needs_reconnect: needsReconnect,
    reconnect_hint: needsReconnect ? RECONNECT_STEPS : "",
    server_status: serverStatus,
    server_ip: serverIp,
    message: waMessage,
  });
}
