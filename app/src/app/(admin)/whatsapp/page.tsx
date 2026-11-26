"use client";

import { FormEvent, useEffect, useState } from "react";
import { Loader, PanelLoader } from "@/components/Loader";

type LicenseSession = {
  licenseId: string;
  label: string;
  siteUrl: string | null;
  sessionId: string | null;
  status: string;
  phone: string;
  ok: boolean;
  health?: string;
  needsReconnect?: boolean;
};

function sessionBadgeClass(s: LicenseSession) {
  if (s.status === "ready" || s.health === "ready") return "ok";
  if (s.needsReconnect || s.health === "needs_reconnect") return "warn";
  return "off";
}

function sessionBadgeLabel(s: LicenseSession) {
  if (s.status === "ready" || s.health === "ready") return "ready";
  if (s.needsReconnect || s.health === "needs_reconnect") return "needs reconnect";
  return s.status || "—";
}

type Status = {
  baseUrl?: string;
  hasApiKey?: boolean;
  configured?: boolean;
  source?: { baseUrl?: string; apiKey?: string };
  sessionId?: string | null;
  health?: { ok: boolean; http: number; body: unknown };
  session?: { ok: boolean; status: string; http: number };
  licenseSessions?: LicenseSession[];
  summary?: { linkedLicenses: number; ready: number; needsReconnect?: number; note: string };
  error?: string;
};

type GatewaySettings = {
  base_url: string;
  api_key_set: boolean;
  api_key_masked: string;
  configured: boolean;
  health_ok: boolean;
  health_http: number;
  dashboard_url: string;
  note?: string;
  source?: { baseUrl?: string; apiKey?: string };
};

export default function WhatsAppPage() {
  const [status, setStatus] = useState<Status | null>(null);
  const [settings, setSettings] = useState<GatewaySettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  async function load(isRefresh = false) {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    try {
      const [stRes, setRes] = await Promise.all([
        fetch("/api/whatsapp/status", { credentials: "same-origin" }),
        fetch("/api/whatsapp/settings", { credentials: "same-origin" }),
      ]);
      const st = await stRes.json().catch(() => ({}));
      const se = await setRes.json().catch(() => ({}));
      setStatus(st);
      if (setRes.ok) setSettings(se);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function onSave(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    setMsg("");
    const fd = new FormData(e.currentTarget);
    try {
      const res = await fetch("/api/whatsapp/settings", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          base_url: String(fd.get("base_url") || ""),
          api_key: String(fd.get("api_key") || ""),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(typeof data.error === "string" ? data.error : "Save failed");
        return;
      }
      setSettings(data);
      setMsg(
        data.health_ok
          ? `Saved. Gateway healthy (HTTP ${data.health_http}).`
          : `Saved. Gateway check HTTP ${data.health_http || "—"} — check URL/key/firewall.`
      );
      await load(true);
    } catch {
      setErr("Network error while saving");
    } finally {
      setBusy(false);
    }
  }

  const sessions = status?.licenseSessions || [];
  const dashUrl = settings?.dashboard_url || status?.baseUrl || "http://127.0.0.1:2785";

  return (
    <div className="stack">
      <div className="page-head">
        <div className="page-head__copy">
          <h1>WhatsApp / OpenWA</h1>
          <p className="muted">
            Shared / demo OpenWA gateway for paid Hosted WA (until dedicated Webdock VPS). WordPress sites
            connect through the panel — no <span className="mono">.env</span> edit for day-to-day use.
          </p>
        </div>
        <div className="page-head__actions">
          {refreshing ? <Loader label="Refreshing…" /> : null}
          <button type="button" className="btn" onClick={() => load(true)} disabled={loading || refreshing}>
            Refresh
          </button>
          <a className="btn btn-primary" href={dashUrl} target="_blank" rel="noreferrer">
            OpenWA dashboard
          </a>
        </div>
      </div>

      <div className="card stack">
        <h2 style={{ margin: 0 }}>Gateway (panel-managed)</h2>
        <p className="muted" style={{ margin: 0 }}>
          Interim shared gateway (e.g. DPS) + API key. After Webdock: each paid license gets its own host
          under <strong>Instances</strong>.
        </p>
        {loading && !settings ? <PanelLoader label="Loading settings…" /> : null}
        {settings ? (
          <form className="stack" onSubmit={onSave} style={{ gap: 12 }}>
            <div className="field">
              <label htmlFor="base_url">OpenWA base URL</label>
              <input
                id="base_url"
                name="base_url"
                defaultValue={settings.base_url}
                placeholder="http://193.182.128.85:2785"
                required
                autoComplete="off"
              />
            </div>
            <div className="field">
              <label htmlFor="api_key">API key</label>
              <input
                id="api_key"
                name="api_key"
                type="password"
                placeholder={
                  settings.api_key_set
                    ? `Saved (${settings.api_key_masked}) — paste to replace`
                    : "owa_k1_…"
                }
                autoComplete="new-password"
              />
              <p className="muted" style={{ margin: "6px 0 0", fontSize: 12 }}>
                Leave blank to keep the current key. Source: base={settings.source?.baseUrl || "—"}, key=
                {settings.source?.apiKey || "—"}.
              </p>
            </div>
            {err ? <p style={{ color: "var(--danger)", margin: 0 }}>{err}</p> : null}
            {msg ? <p style={{ color: "var(--ok, #047857)", margin: 0 }}>{msg}</p> : null}
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button className="btn btn-primary" type="submit" disabled={busy}>
                {busy ? "Saving…" : "Save gateway"}
              </button>
              <span className={`badge ${settings.health_ok ? "ok" : "off"}`}>
                Health {settings.health_ok ? "OK" : "check"} · HTTP {settings.health_http || "—"}
              </span>
            </div>
          </form>
        ) : null}
      </div>

      <div className="card stack">
        {loading ? <PanelLoader label="Checking gateway…" /> : null}
        {!loading && status?.error ? <p style={{ color: "var(--danger)" }}>{status.error}</p> : null}
        {!loading && status ? (
          <div className="grid grid-2">
            <div>
              <div className="muted">Active base URL</div>
              <div className="mono">{status.baseUrl}</div>
            </div>
            <div>
              <div className="muted">API key</div>
              <div>
                {status.hasApiKey ? <span className="badge ok">set</span> : <span className="badge off">missing</span>}
              </div>
            </div>
            <div>
              <div className="muted">Gateway health</div>
              <div>
                {status.health?.ok ? (
                  <span className="badge ok">HTTP {status.health.http}</span>
                ) : (
                  <span className="badge off">HTTP {status.health?.http ?? "—"}</span>
                )}
              </div>
            </div>
            <div>
              <div className="muted">License phones ready</div>
              <div>
                <span className={`badge ${status.summary?.ready ? "ok" : "off"}`}>
                  {status.summary?.ready ?? 0} / {status.summary?.linkedLicenses ?? 0}
                </span>
              </div>
            </div>
          </div>
        ) : null}
        {!loading && status?.summary?.note ? (
          <p className="muted" style={{ margin: "14px 0 0" }}>
            {status.summary.note}
            {status.summary.needsReconnect ? (
              <>
                {" "}
                Reconnect steps on the WP site: Connect phone → WhatsApp Linked devices → scan QR → wait for Connected.
              </>
            ) : null}
          </p>
        ) : null}
      </div>

      {!loading && sessions.length > 0 ? (
        <div className="card stack">
          <h2 style={{ margin: 0 }}>Linked license sessions</h2>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>License</th>
                  <th>Site</th>
                  <th>Status</th>
                  <th>Phone</th>
                  <th>Session</th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((s) => (
                  <tr key={s.licenseId}>
                    <td>
                      <strong>{s.label}</strong>
                    </td>
                    <td className="mono cell-clamp" title={s.siteUrl || undefined}>
                      {s.siteUrl || "—"}
                    </td>
                    <td className="plan-cell">
                      <span className={`badge ${sessionBadgeClass(s)}`}>{sessionBadgeLabel(s)}</span>
                    </td>
                    <td className="mono" style={{ whiteSpace: "nowrap" }}>
                      {s.phone ? `+${String(s.phone).replace(/\D/g, "")}` : "—"}
                    </td>
                    <td className="mono cell-clamp" title={s.sessionId || undefined}>
                      {s.sessionId || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  );
}
