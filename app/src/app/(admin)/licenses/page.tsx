"use client";

import { FormEvent, useEffect, useState } from "react";
import { Loader, PanelLoader } from "@/components/Loader";

type License = {
  id: string;
  key: string;
  keyPrefix?: string;
  label: string;
  siteUrl: string;
  plan: string;
  expiresAt: string | null;
  active: boolean;
  notes: string;
  createdAt: string;
  waEntitlement?: string;
  waExpiresAt?: string | null;
  serverStatus?: string;
  serverIp?: string;
  usable?: boolean;
  pluginOk?: boolean;
  waOk?: boolean;
  gateReason?: string;
  daysLeft?: number | null;
};

function displayKey(r: License) {
  if (r.key?.startsWith("PF-HASHONLY-") || !r.key) {
    const p = (r.keyPrefix || "????").toUpperCase();
    return `PF-••••-••••-${p}`;
  }
  return r.key;
}

function pluginBadge(r: License) {
  if (!r.active || r.pluginOk === false) return <span className="badge off">plugin off</span>;
  return <span className="badge ok">plugin on</span>;
}

function waBadge(r: License) {
  const ent = (r.waEntitlement || r.plan || "none").toLowerCase();
  if (ent === "none") return <span className="badge off">WA none</span>;
  if (r.gateReason === "expired") {
    return <span className="badge off">WA expired</span>;
  }
  return <span className="badge ok">WA {ent === "paid" ? "paid" : ent}</span>;
}

function serverBadge(r: License) {
  const s = (r.serverStatus || "none").toLowerCase();
  if (s === "provisioning") return <span className="badge warn">Provisioning…</span>;
  if (s === "running") return <span className="badge ok">Ready</span>;
  if (s === "stopped") return <span className="badge off">Powered off</span>;
  if (s === "error") return <span className="badge off">Error</span>;
  return <span className="badge off">None</span>;
}

/** Checkout/system writes into notes — hide those under the label. */
function humanNotes(notes: string) {
  const n = (notes || "").trim();
  if (!n) return "";
  if (/^(stripe-confirm:|stripe:|mock-checkout|paid via|auto-bootstrap)/i.test(n)) return "";
  return n;
}

function CopyKeyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      /* ignore */
    }
  }

  return (
    <button type="button" className="btn btn-copy" onClick={copy} title="Copy license key">
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

export default function LicensesPage() {
  const [rows, setRows] = useState<License[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/licenses");
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to load");
        return;
      }
      setError("");
      setRows(data.licenses || []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    setBusy(true);
    setError("");
    const fd = new FormData(form);
    try {
      const res = await fetch("/api/licenses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: fd.get("label"),
          siteUrl: fd.get("siteUrl"),
          notes: fd.get("notes"),
          waPlan: fd.get("waPlan") || "none",
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Create failed");
        return;
      }
      form.reset();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Create failed");
    } finally {
      setBusy(false);
    }
  }

  async function patch(id: string, body: Record<string, unknown>) {
    const res = await fetch(`/api/licenses/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (body.reissueKey && data.license_key) {
      window.prompt("New license key (copy now):", String(data.license_key));
    }
    await load();
  }

  async function remove(id: string) {
    if (!confirm("Delete this license?")) return;
    await fetch(`/api/licenses/${id}`, { method: "DELETE" });
    await load();
  }

  async function instanceAct(licenseId: string, action: string) {
    setBusy(true);
    try {
      await fetch(`/api/instances/${licenseId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      await load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <div className="page-head">
        <div className="page-head__copy">
          <h1>Licenses</h1>
          <p className="muted">
            Plugin unlock ($49) is always on the key. Hosted WhatsApp is separate (Monthly / Yearly paid — no
            trial). After pay, provision runs on shared/demo now; dedicated VPS per customer after Webdock.
            Lifecycle: <strong>Instances</strong>.
          </p>
        </div>
        <div className="page-head__actions">{busy || loading ? <Loader /> : null}</div>
      </div>

      <div className="card">
        <h2>New license</h2>
        <form onSubmit={create} className="grid grid-2" style={{ marginTop: 12 }}>
          <div className="field">
            <label htmlFor="label">Label</label>
            <input id="label" name="label" placeholder="SLE VIP / Client name" required />
          </div>
          <div className="field">
            <label htmlFor="siteUrl">Site URL</label>
            <input id="siteUrl" name="siteUrl" placeholder="https://example.com" />
          </div>
          <div className="field">
            <label htmlFor="waPlan">WhatsApp entitlement</label>
            <select
              id="waPlan"
              name="waPlan"
              defaultValue="none"
              style={{
                height: 40,
                padding: "0 12px",
                borderRadius: 8,
                border: "1px solid var(--line-strong)",
                background: "#fff",
              }}
            >
              <option value="none">Plugin only (no WA)</option>
              <option value="paid">WA paid (no expiry)</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="notes">Notes</label>
            <textarea id="notes" name="notes" rows={2} placeholder="Optional" />
          </div>
          <div className="page-head__actions">
            <button className="btn btn-primary" type="submit" disabled={busy}>
              Create key
            </button>
          </div>
        </form>
        {error ? <p style={{ color: "var(--danger)" }}>{error}</p> : null}
      </div>

      <div className="card">
        {loading ? (
          <PanelLoader label="Loading licenses…" />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Label</th>
                  <th>License key</th>
                  <th>Site</th>
                  <th>Plugin</th>
                  <th>WhatsApp</th>
                  <th>Server</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <strong>{r.label}</strong>
                      {humanNotes(r.notes) ? (
                        <div className="muted cell-notes" title={humanNotes(r.notes)}>
                          {humanNotes(r.notes)}
                        </div>
                      ) : null}
                      {r.waExpiresAt || r.expiresAt ? (
                        <div className="muted">
                          WA expires {new Date(String(r.waExpiresAt || r.expiresAt)).toLocaleDateString()}
                        </div>
                      ) : (
                        <div className="muted">No WA expiry</div>
                      )}
                    </td>
                    <td>
                      <div className="key-cell">
                        <code className="key-cell__value" title={displayKey(r)}>
                          {displayKey(r)}
                        </code>
                        {!r.key?.startsWith("PF-HASHONLY-") ? <CopyKeyButton value={r.key} /> : null}
                      </div>
                    </td>
                    <td className="muted cell-clamp" title={r.siteUrl || undefined}>
                      {r.siteUrl || "—"}
                    </td>
                    <td className="plan-cell">{pluginBadge(r)}</td>
                    <td className="plan-cell">{waBadge(r)}</td>
                    <td className="plan-cell">
                      {serverBadge(r)}
                      {r.serverIp ? <div className="muted">{r.serverIp}</div> : null}
                    </td>
                    <td>
                      <div className="actions">
                        {String(r.waEntitlement || "none").toLowerCase() === "none" && (
                          <button
                            type="button"
                            className="btn btn-primary"
                            onClick={() => patch(r.id, { waPlan: "paid" })}
                          >
                            Grant WA paid
                          </button>
                        )}
                        {["paid", "monthly", "yearly"].includes(
                          String(r.waEntitlement || "").toLowerCase()
                        ) && (
                          <button
                            type="button"
                            className="btn"
                            title="Drop Hosted WA so WP Update plan → mock/Stripe checkout can run"
                            onClick={() => {
                              if (
                                confirm(
                                  "Clear Hosted WA entitlement? WP will show locked + Monthly/Yearly checkout (mock if Stripe off)."
                                )
                              ) {
                                patch(r.id, { waPlan: "none" });
                              }
                            }}
                          >
                            Clear WA (mock pay test)
                          </button>
                        )}
                        {(r.serverStatus === "none" ||
                          r.serverStatus === "stopped" ||
                          r.serverStatus === "error") &&
                          r.waOk !== false &&
                          (r.waEntitlement || r.plan) !== "none" && (
                            <button type="button" className="btn" onClick={() => instanceAct(r.id, "retry")}>
                              Provision server
                            </button>
                          )}
                        {r.serverStatus === "running" || r.serverStatus === "provisioning" ? (
                          <button type="button" className="btn" onClick={() => instanceAct(r.id, "power_off")}>
                            Power off
                          </button>
                        ) : null}
                        <button type="button" className="btn" onClick={() => patch(r.id, { active: !r.active })}>
                          {r.active ? "Revoke plugin" : "Enable plugin"}
                        </button>
                        <button
                          type="button"
                          className="btn"
                          title="Rotate key — old key stops working"
                          onClick={() => {
                            if (confirm("Re-issue license key? The old key will stop working immediately.")) {
                              patch(r.id, { reissueKey: true });
                            }
                          }}
                        >
                          Re-issue key
                        </button>
                        <button type="button" className="btn btn-danger" onClick={() => remove(r.id)}>
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {!rows.length ? (
                  <tr>
                    <td colSpan={7} className="muted">
                      No licenses yet.
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
