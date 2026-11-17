import { openwaConfig } from "./env";

export type OpenWaSendResult = {
  providerId: string;
  status: string;
};

function headers(apiKey: string) {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKey) h["X-API-Key"] = apiKey;
  return h;
}

export function toChatId(to: string) {
  const raw = to.trim();
  if (!raw) throw new Error("Empty recipient");
  if (raw.includes("@")) return raw;
  const digits = raw.replace(/\D+/g, "");
  if (digits.length < 8) throw new Error("Invalid phone");
  return `${digits}@c.us`;
}

export async function health() {
  const { baseUrl, apiKey } = openwaConfig();
  const res = await fetch(`${baseUrl}/api/health`, {
    headers: headers(apiKey),
    cache: "no-store",
  });
  const text = await res.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    /* plain */
  }
  return { ok: res.ok, http: res.status, body };
}

export async function sessionById(sessionId: string) {
  const { baseUrl, apiKey } = openwaConfig();
  if (!sessionId || !apiKey) {
    return { ok: false, status: "unconfigured", phone: "", http: 0, body: null as unknown };
  }
  const res = await fetch(`${baseUrl}/api/sessions/${encodeURIComponent(sessionId)}`, {
    headers: headers(apiKey),
    cache: "no-store",
  });
  const text = await res.text();
  let body: Record<string, unknown> | null = null;
  try {
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    body = { raw: text.slice(0, 200) };
  }
  const status = body && typeof body.status === "string" ? body.status : "unknown";
  const phone =
    (body && typeof body.phone === "string" && body.phone) ||
    (body && typeof body.pushName === "string" && body.pushName) ||
    "";
  return { ok: res.ok, status, phone, http: res.status, body };
}

export async function sessionStatus() {
  const { sessionId } = openwaConfig();
  return sessionById(sessionId || "");
}

export async function ensureSession(name: string, existingId = "") {
  const { baseUrl, apiKey } = openwaConfig();
  if (!apiKey) throw new Error("OPENWA_API_KEY missing");

  if (existingId) {
    const check = await fetch(`${baseUrl}/api/sessions/${encodeURIComponent(existingId)}`, {
      headers: headers(apiKey),
      cache: "no-store",
    });
    if (check.ok) {
      return { id: existingId };
    }
  }

  const safeName = name
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  const res = await fetch(`${baseUrl}/api/sessions`, {
    method: "POST",
    headers: headers(apiKey),
    body: JSON.stringify({ name: safeName || `site-${Date.now()}` }),
  });
  const raw = await res.text();
  let data: Record<string, unknown> = {};
  try {
    data = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    /* ignore */
  }
  if (res.status === 409) {
    // Name already exists — find by exact name.
    const list = await fetch(
      `${baseUrl}/api/sessions?name=${encodeURIComponent(safeName || "")}`,
      {
        headers: headers(apiKey),
        cache: "no-store",
      }
    );
    const rows = (await list.json().catch(() => [])) as Array<{ id?: string; name?: string }>;
    if (Array.isArray(rows) && rows[0]?.id) {
      return { id: rows[0].id };
    }
  }
  if (!res.ok) {
    const msg = typeof data.message === "string" ? data.message : raw.slice(0, 300);
    throw new Error(`Create session failed: ${msg}`);
  }
  const id = typeof data.id === "string" ? data.id : "";
  if (!id) throw new Error("Session created without id");
  return { id };
}

export async function startSession(sessionId: string) {
  const { baseUrl, apiKey } = openwaConfig();
  if (!apiKey) throw new Error("OPENWA_API_KEY missing");
  const res = await fetch(`${baseUrl}/api/sessions/${encodeURIComponent(sessionId)}/start`, {
    method: "POST",
    headers: headers(apiKey),
  });
  // 409 etc. can mean already started — continue to QR/status.
  return { http: res.status, ok: res.ok || res.status === 409 };
}

export async function getQr(sessionId: string) {
  const { baseUrl, apiKey } = openwaConfig();
  if (!apiKey) throw new Error("OPENWA_API_KEY missing");
  const res = await fetch(`${baseUrl}/api/sessions/${encodeURIComponent(sessionId)}/qr`, {
    headers: headers(apiKey),
    cache: "no-store",
  });
  const raw = await res.text();
  let data: Record<string, unknown> = {};
  try {
    data = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    /* ignore */
  }
  if (!res.ok) {
    return { ok: false as const, http: res.status, qr: "", message: typeof data.message === "string" ? data.message : raw.slice(0, 200) };
  }
  const qr =
    (typeof data.qrCode === "string" && data.qrCode) ||
    (typeof data.qr === "string" && data.qr) ||
    (typeof data.data === "string" && data.data) ||
    (typeof data.base64 === "string" && data.base64) ||
    "";
  return { ok: true as const, http: res.status, qr, message: "" };
}

export async function sendText(to: string, text: string, sessionIdOverride = ""): Promise<OpenWaSendResult> {
  const { baseUrl, apiKey, sessionId: envSession } = openwaConfig();
  const sessionId = sessionIdOverride || envSession;
  if (!apiKey) throw new Error("OPENWA_API_KEY missing");
  if (!sessionId) throw new Error("No WhatsApp session — connect the phone first.");
  const chatId = toChatId(to);
  const res = await fetch(
    `${baseUrl}/api/sessions/${encodeURIComponent(sessionId)}/messages/send-text`,
    {
      method: "POST",
      headers: headers(apiKey),
      body: JSON.stringify({ chatId, text }),
    }
  );
  const raw = await res.text();
  let data: Record<string, unknown> = {};
  try {
    data = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    /* ignore */
  }
  if (!res.ok) {
    const msg = typeof data.message === "string" ? data.message : raw.slice(0, 300);
    throw new Error(`OpenWA HTTP ${res.status}: ${msg}`);
  }
  const providerId =
    (typeof data.messageId === "string" && data.messageId) ||
    (typeof data.id === "string" && data.id) ||
    `openwa-${Date.now()}`;
  return { providerId, status: "sent" };
}
