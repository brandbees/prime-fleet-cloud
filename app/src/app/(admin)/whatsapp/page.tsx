"use client";

import { useEffect, useState } from "react";
import { Loader, PanelLoader } from "@/components/Loader";

type LicenseSession = {
  licenseId: string;
  label: string;
  siteUrl: string | null;
  sessionId: string | null;
  status: string;
  phone: string;
  ok: boolean;
};

type Status = {
  baseUrl?: string;
  hasApiKey?: boolean;
  sessionId?: string | null;
  health?: { ok: boolean; http: number; body: unknown };
  session?: { ok: boolean; status: string; http: number };
  licenseSessions?: LicenseSession[];
  summary?: { linkedLicenses: number; ready: number; note: string };
  error?: string;
};

export default function WhatsAppPage() {
  const [status, setStatus] = useState<Status | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  async function load(isRefresh = false) {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    try {
      const res = await fetch("/api/whatsapp/status");
      const data = await res.json();
      setStatus(data);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const sessions = status?.licenseSessions || [];

  return (
    <div className="stack">
      <div className="page-head">
        <div className="page-head__copy">
          <h1>WhatsApp / OpenWA</h1>
          <p className="muted">
            Gateway health for this stack. Phone sessions are stored <strong>per license</strong> when a
            site scans QR in WordPress Settings → WhatsApp —{" "}
            <span className="mono">OPENWA_SESSION_ID</span> in <span className="mono">.env</span> is
            optional (legacy / single-tenant only).
          </p>
        </div>
        <div className="page-head__actions">
          {refreshing ? <Loader label="Refreshing…" /> : null}
          <button type="button" className="btn" onClick={() => load(true)} disabled={loading || refreshing}>
            Refresh
          </button>
          <a className="btn btn-primary" href="http://127.0.0.1:2785" target="_blank" rel="noreferrer">
            OpenWA dashboard
          </a>
        </div>
      </div>

      <div className="card stack">
        {loading ? <PanelLoader label="Checking gateway…" /> : null}
        {!loading && status?.error ? <p style={{ color: "var(--danger)" }}>{status.error}</p> : null}
        {!loading && status ? (
          <div className="grid grid-2">
            <div>
              <div className="muted">Base URL</div>
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
                      <span className={`badge ${s.status === "ready" ? "ok" : "off"}`}>{s.status}</span>
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

      {!loading && status?.sessionId ? (
        <div className="card stack">
          <h2 style={{ margin: 0 }}>.env fallback session</h2>
          <p className="muted">Only used if a license has no <span className="mono">openwaSessionId</span>.</p>
          <div className="mono">{status.sessionId}</div>
          <div>Status: {status.session?.status || "—"}</div>
        </div>
      ) : null}
    </div>
  );
}
