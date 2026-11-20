"use client";

import { useEffect, useState } from "react";
import { Loader, PanelLoader } from "@/components/Loader";

type InstanceRow = {
  id: string;
  licenseId: string;
  provider: string;
  providerId: string;
  status: string;
  ip: string;
  openwaBaseUrl: string;
  lastError: string;
  provisionedAt: string | null;
  poweredOffAt: string | null;
  updatedAt: string;
  license: {
    id: string;
    key: string;
    label: string;
    siteUrl: string;
    waEntitlement: string;
    plan: string;
    active: boolean;
  };
};

function statusBadge(status: string) {
  const s = status.toLowerCase();
  if (s === "running") return <span className="badge ok">running</span>;
  if (s === "provisioning") return <span className="badge warn">provisioning</span>;
  if (s === "error") return <span className="badge off">error</span>;
  if (s === "stopped") return <span className="badge off">stopped</span>;
  return <span className="badge off">{s || "none"}</span>;
}

export default function InstancesPage() {
  const [rows, setRows] = useState<InstanceRow[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/instances");
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to load");
        return;
      }
      setError("");
      setRows(data.instances || []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    const t = window.setInterval(load, 8000);
    return () => window.clearInterval(t);
  }, []);

  async function act(licenseId: string, action: string) {
    setBusyId(licenseId);
    setError("");
    try {
      const res = await fetch(`/api/instances/${licenseId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Action failed");
        return;
      }
      await load();
    } finally {
      setBusyId("");
    }
  }

  return (
    <div className="stack">
      <div className="page-head">
        <div className="page-head__copy">
          <h1>Instances</h1>
          <p className="muted">
            Hosted WhatsApp boxes per license. Provider is <strong>mock</strong> while Webdock is on hold —
            pay / Convert WA to paid starts provision; status becomes running with a demo IP after a few seconds.
          </p>
        </div>
        <div className="page-head__actions">{busyId || loading ? <Loader /> : null}</div>
      </div>

      {error ? <p style={{ color: "var(--danger)" }}>{error}</p> : null}

      <div className="card">
        {loading && !rows.length ? (
          <PanelLoader label="Loading instances…" />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>License</th>
                  <th>Provider</th>
                  <th>Status</th>
                  <th>IP</th>
                  <th>Error</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <strong>{r.license.label}</strong>
                      <div className="muted cell-clamp" title={r.license.siteUrl || undefined}>
                        {r.license.siteUrl || "—"}
                      </div>
                    </td>
                    <td>
                      <code>{r.provider}</code>
                      {r.providerId ? <div className="muted">{r.providerId}</div> : null}
                    </td>
                    <td>{statusBadge(r.status)}</td>
                    <td className="muted">{r.ip || "—"}</td>
                    <td className="muted cell-clamp" title={r.lastError || undefined}>
                      {r.lastError || "—"}
                    </td>
                    <td>
                      <div className="actions">
                        <button
                          type="button"
                          className="btn"
                          disabled={busyId === r.licenseId}
                          onClick={() => act(r.licenseId, "retry")}
                        >
                          Retry
                        </button>
                        <button
                          type="button"
                          className="btn"
                          disabled={busyId === r.licenseId || r.status === "stopped"}
                          onClick={() => act(r.licenseId, "power_off")}
                        >
                          Power off
                        </button>
                        <button
                          type="button"
                          className="btn btn-danger"
                          disabled={busyId === r.licenseId}
                          onClick={() => {
                            if (confirm("Destroy this instance record? (mock only)")) {
                              act(r.licenseId, "destroy");
                            }
                          }}
                        >
                          Destroy
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {!rows.length ? (
                  <tr>
                    <td colSpan={6} className="muted">
                      No instances yet. Convert a license to WA paid (or complete checkout) to start mock provision.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
