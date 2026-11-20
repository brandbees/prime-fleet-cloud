import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { openwaSettings, setSetting } from "@/lib/settings";
import { health } from "@/lib/openwa";

function mask(v: string) {
  if (!v) return "";
  if (v.length <= 12) return "••••";
  return `${v.slice(0, 8)}…${v.slice(-4)}`;
}

export async function GET() {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const s = await openwaSettings();
  let healthOk = false;
  let healthHttp = 0;
  try {
    const h = await health();
    healthOk = h.ok;
    healthHttp = h.http;
  } catch {
    healthOk = false;
  }

  return NextResponse.json({
    base_url: s.baseUrl,
    api_key_set: Boolean(s.apiKey),
    api_key_masked: mask(s.apiKey),
    configured: s.configured,
    source: s.source,
    health_ok: healthOk,
    health_http: healthHttp,
    dashboard_url: s.baseUrl,
    note: "Saved in panel (AppSetting). Used for all hosted WhatsApp Connect / send until per-client VPS automation ships.",
  });
}

export async function POST(req: Request) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as {
    base_url?: string;
    api_key?: string;
  };

  let baseUrl = String(body.base_url || "").trim().replace(/\/$/, "");
  if (baseUrl) {
    try {
      const u = new URL(baseUrl);
      if (u.protocol !== "http:" && u.protocol !== "https:") {
        return NextResponse.json({ error: "Base URL must be http or https" }, { status: 400 });
      }
      baseUrl = u.toString().replace(/\/$/, "").replace(/\/api$/i, "");
    } catch {
      return NextResponse.json({ error: "Invalid base URL" }, { status: 400 });
    }
    await setSetting("openwa_base_url", baseUrl);
  }

  const apiKey = String(body.api_key || "").trim();
  if (apiKey) {
    await setSetting("openwa_api_key", apiKey);
  }

  const s = await openwaSettings();
  let healthOk = false;
  let healthHttp = 0;
  try {
    const h = await health();
    healthOk = h.ok;
    healthHttp = h.http;
  } catch {
    healthOk = false;
  }

  return NextResponse.json({
    ok: true,
    configured: s.configured,
    base_url: s.baseUrl,
    api_key_set: Boolean(s.apiKey),
    api_key_masked: mask(s.apiKey),
    health_ok: healthOk,
    health_http: healthHttp,
    dashboard_url: s.baseUrl,
  });
}
