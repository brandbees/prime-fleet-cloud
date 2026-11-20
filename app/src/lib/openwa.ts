import { openwaSettings } from "./settings";

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

async function cfg() {
  return openwaSettings();
}

export async function health() {
  const { baseUrl, apiKey } = await cfg();
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
  const { baseUrl, apiKey } = await cfg();
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
  const { sessionId } = await cfg();
  return sessionById(sessionId || "");
}

export async function ensureSession(name: string, existingId = "") {
  const { baseUrl, apiKey } = await cfg();
  if (!apiKey) throw new Error("OpenWA API key missing — set it in Panel → WhatsApp");

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
  const { baseUrl, apiKey } = await cfg();
  if (!apiKey) throw new Error("OpenWA API key missing — set it in Panel → WhatsApp");
  const res = await fetch(`${baseUrl}/api/sessions/${encodeURIComponent(sessionId)}/start`, {
    method: "POST",
    headers: headers(apiKey),
  });
  return { http: res.status, ok: res.ok || res.status === 409 };
}

/** Best-effort logout then delete so the phone can scan a new QR. */
export async function disconnectSession(sessionId: string) {
  const { baseUrl, apiKey } = await cfg();
  if (!apiKey) throw new Error("OpenWA API key missing — set it in Panel → WhatsApp");
  if (!sessionId) return { ok: true as const, http: 204, message: "No session" };

  const logout = await fetch(`${baseUrl}/api/sessions/${encodeURIComponent(sessionId)}/logout`, {
    method: "POST",
    headers: headers(apiKey),
  });
  const del = await fetch(`${baseUrl}/api/sessions/${encodeURIComponent(sessionId)}`, {
    method: "DELETE",
    headers: headers(apiKey),
  });
  const ok = del.ok || del.status === 404 || logout.ok || logout.status === 404;
  return {
    ok,
    http: del.status || logout.status,
    message: ok ? "Session disconnected" : `OpenWA logout/delete failed (${logout.status}/${del.status})`,
  };
}

export async function getQr(sessionId: string) {
  const { baseUrl, apiKey } = await cfg();
  if (!apiKey) throw new Error("OpenWA API key missing — set it in Panel → WhatsApp");
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
    return {
      ok: false as const,
      http: res.status,
      qr: "",
      message: typeof data.message === "string" ? data.message : raw.slice(0, 200),
    };
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
  const { baseUrl, apiKey, sessionId: envSession } = await cfg();
  const sessionId = sessionIdOverride || envSession;
  if (!apiKey) throw new Error("OpenWA API key missing — set it in Panel → WhatsApp");
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
