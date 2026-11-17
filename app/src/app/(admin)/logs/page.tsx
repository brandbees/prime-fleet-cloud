"use client";

import { useEffect, useState } from "react";
import { Loader, PanelLoader } from "@/components/Loader";

type Log = {
  id: string;
  to: string;
  preview: string;
  status: string;
  providerId: string;
  error: string;
  createdAt: string;
  license?: { label: string; key: string } | null;
};

export default function LogsPage() {
  const [logs, setLogs] = useState<Log[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  async function load(isRefresh = false) {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    try {
      const res = await fetch("/api/logs");
      const data = await res.json();
      if (res.ok) setLogs(data.logs || []);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="stack">
      <div className="page-head">
        <div className="page-head__copy">
          <h1>Send logs</h1>
          <p className="muted">Last 100 WhatsApp sends through the cloud API.</p>
        </div>
        <div className="page-head__actions">
          {refreshing ? <Loader label="Refreshing…" /> : null}
          <button type="button" className="btn" onClick={() => load(true)} disabled={loading || refreshing}>
            Refresh
          </button>
        </div>
      </div>
      <div className="card">
        {loading ? (
          <PanelLoader label="Loading send logs…" />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>License</th>
                  <th>To</th>
                  <th>Status</th>
                  <th>Preview</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((l) => (
                  <tr key={l.id}>
                    <td className="muted" style={{ whiteSpace: "nowrap" }}>
                      {new Date(l.createdAt).toLocaleString()}
                    </td>
                    <td>{l.license?.label || "—"}</td>
                    <td className="mono" style={{ whiteSpace: "nowrap" }}>
                      {l.to}
                    </td>
                    <td>
                      <span className={`badge ${l.status === "sent" ? "ok" : "off"}`}>{l.status}</span>
                      {l.error ? <div className="muted cell-notes">{l.error}</div> : null}
                    </td>
                    <td className="cell-notes">{l.preview}</td>
                  </tr>
                ))}
                {!logs.length ? (
                  <tr>
                    <td colSpan={5} className="muted">
                      No sends yet.
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
