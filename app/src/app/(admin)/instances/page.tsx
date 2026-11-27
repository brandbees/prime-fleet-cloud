"use client";

import { useEffect, useMemo, useState } from "react";
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

/** DB status → ops-facing lifecycle label (product language). */
function statusMeta(status: string): { label: string; className: string; hint: string } {
  const s = status.toLowerCase();
  if (s === "provisioning") {
    return {
      label: "Provisioning…",
      className: "badge warn",
      hint: "Creating the Hosted WhatsApp box. Usually a few seconds in demo.",
    };
  }
  if (s === "running") {
    return {
      label: "Ready",
      className: "badge ok",
      hint: "Instance is up. Site can Connect phone / send.",
    };
  }
  if (s === "stopped") {
    return {
      label: "Powered off",
      className: "badge off",
      hint: "Box is off. Retry provision to bring it back.",
    };
  }
  if (s === "error") {
    return {
      label: "Error",
      className: "badge off",
      hint: "Provision failed. Check Error column, then Retry.",
    };
  }
  return {
    label: s || "None",
    className: "badge off",
    hint: "No instance for this license yet.",
  };
}

function friendlyActionError(raw: string) {
  const msg = String(raw || "").trim();
  if (!msg) return "Action failed";
  const lower = msg.toLowerCase();
  if (lower.includes("webdock") || lower.includes("hold")) {
    return "Dedicated VPS create is on hold (Webdock). This panel uses shared/demo providers until then.";
  }
  if (lower.includes("not implemented") || lower.includes("wa_provider") || lower.includes("not enabled")) {
    return "Provider not enabled. Use WA_PROVIDER=mock or shared until Webdock access is ready.";
  }
  if (lower.includes("entitlement") || lower.includes("monthly") || lower.includes("yearly") || lower.includes("trial")) {
    return "Hosted WhatsApp requires a paid Monthly or Yearly plan before provision.";
  }
  return msg;
}

function summarize(rows: InstanceRow[]) {
  let ready = 0;
  let provisioning = 0;
  let poweredOff = 0;
  let errors = 0;
  for (const r of rows) {
    const s = String(r.status || "").toLowerCase();
    if (s === "running") ready++;
    else if (s === "provisioning") provisioning++;
    else if (s === "stopped") poweredOff++;
    else if (s === "error") errors++;
  }
  return { total: rows.length, ready, provisioning, poweredOff, errors };
}

export default function InstancesPage() {
  const [rows, setRows] = useState<InstanceRow[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [flash, setFlash] = useState("");

  const summary = useMemo(() => summarize(rows), [rows]);
  const failed = useMemo(
    () => rows.filter((r) => String(r.status || "").toLowerCase() === "error"),
    [rows]
  );

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/instances");
      const data = await res.json();
      if (!res.ok) {
        setError(friendlyActionError(data.error || "Failed to load"));
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
    setFlash("");
    try {
      const res = await fetch(`/api/instances/${licenseId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(friendlyActionError(data.error || "Action failed"));
        return;
      }
      if (action === "retry" || action === "provision") {
        setFlash("Provision started — status will move Provisioning… → Ready.");
      } else if (action === "power_off" || action === "stop") {
        setFlash("Instance powered off.");
      } else if (action === "destroy") {
        setFlash("Instance record removed.");
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
            Hosted WhatsApp lifecycle per license:{" "}
            <strong>Provisioning… → Ready → Powered off</strong> (or Error). Monthly/Yearly pay starts
            provision on the current <strong>shared / demo</strong> path.{" "}
            <strong>Dedicated VPS after pay</strong> (new IP per customer) lands when Webdock is unheld —
            same screen, different provider. Unpaid: 3-day grace → power-off (not destroy).
          </p>
        </div>
        <div className="page-head__actions">{busyId || loading ? <Loader /> : null}</div>
      </div>

      {!loading && rows.length > 0 ? (
        <div className="card" style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
          <strong style={{ marginRight: 4 }}>Summary</strong>
          <span className="badge ok">Ready {summary.ready}</span>
          <span className="badge warn">Provisioning {summary.provisioning}</span>
          <span className="badge off">Powered off {summary.poweredOff}</span>
          <span className={summary.errors ? "badge off" : "badge"} style={summary.errors ? undefined : { opacity: 0.7 }}>
            Errors {summary.errors}
          </span>
          <span className="muted" style={{ marginLeft: "auto", fontSize: 13 }}>
            {summary.total} total
          </span>
        </div>
      ) : null}

      {failed.length > 0 ? (
        <div
          className="card"
          role="alert"
          style={{
            borderColor: "var(--danger)",
            background: "rgba(155, 44, 44, 0.06)",
          }}
        >
          <strong style={{ color: "var(--danger)" }}>
            {failed.length} provision failure{failed.length === 1 ? "" : "s"}
          </strong>
          <p className="muted" style={{ margin: "6px 0 10px" }}>
            Hosted WhatsApp setup failed for these licenses. Open the Error column, then Retry provision.
          </p>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {failed.map((r) => (
              <li key={r.id} style={{ marginBottom: 6 }}>
                <strong>{r.license.label || r.licenseId}</strong>
                {r.lastError ? (
                  <span className="muted"> — {r.lastError}</span>
                ) : (
                  <span className="muted"> — Provision failed</span>
                )}{" "}
                <button
                  type="button"
                  className="btn"
                  style={{ marginLeft: 6 }}
                  disabled={busyId === r.licenseId}
                  onClick={() => act(r.licenseId, "retry")}
                >
                  Retry
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {error ? <p style={{ color: "var(--danger)" }}>{error}</p> : null}
      {flash ? <p style={{ color: "var(--ok, #047857)" }}>{flash}</p> : null}

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
                {rows.map((r) => {
                  const meta = statusMeta(r.status);
                  const busy = busyId === r.licenseId;
                  return (
                    <tr key={r.id}>
                      <td>
                        <strong>{r.license.label}</strong>
                        <div className="muted cell-clamp" title={r.license.siteUrl || undefined}>
                          {r.license.siteUrl || "—"}
                        </div>
                      </td>
                      <td>
                        <code>{r.provider === "mock" ? "demo" : r.provider}</code>
                        {r.providerId ? <div className="muted">{r.providerId}</div> : null}
                      </td>
                      <td>
                        <span className={meta.className} title={meta.hint}>
                          {meta.label}
                        </span>
                        {r.status === "provisioning" ? (
                          <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                            Waiting for ready…
                          </div>
                        ) : null}
                        {r.status === "stopped" && r.poweredOffAt ? (
                          <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                            Off since {new Date(r.poweredOffAt).toLocaleString()}
                          </div>
                        ) : null}
                      </td>
                      <td className="muted">{r.ip || "—"}</td>
                      <td className="muted cell-clamp" title={r.lastError || undefined}>
                        {r.status === "error"
                          ? r.lastError || "Provision failed — use Retry"
                          : r.lastError || "—"}
                      </td>
                      <td>
                        <div className="actions">
                          <button
                            type="button"
                            className="btn"
                            title="Start or restart provision (Provisioning… → Ready)"
                            disabled={busy || r.status === "provisioning"}
                            onClick={() => act(r.licenseId, "retry")}
                          >
                            Retry provision
                          </button>
                          <button
                            type="button"
                            className="btn"
                            title="Power off this instance (status → Powered off)"
                            disabled={busy || r.status === "stopped" || r.status === "none"}
                            onClick={() => {
                              if (confirm("Power off this Hosted WhatsApp instance?")) {
                                act(r.licenseId, "power_off");
                              }
                            }}
                          >
                            Power off
                          </button>
                          <button
                            type="button"
                            className="btn btn-danger"
                            title="Remove instance record (demo: no cloud destroy bill)"
                            disabled={busy}
                            onClick={() => {
                              if (
                                confirm(
                                  "Remove this instance record? The site will show no server until you provision again."
                                )
                              ) {
                                act(r.licenseId, "destroy");
                              }
                            }}
                          >
                            Remove
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {!rows.length ? (
                  <tr>
                    <td colSpan={6} className="muted">
                      No instances yet. Grant WA paid on Licenses or complete Monthly/Yearly checkout —
                      provision starts (shared/demo until dedicated Webdock). Status moves Provisioning… → Ready.
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
