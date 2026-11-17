"use client";

import { FormEvent, useEffect, useState } from "react";
import { Loader, PanelLoader } from "@/components/Loader";

type License = {
  id: string;
  key: string;
  label: string;
  siteUrl: string;
  plan: string;
  expiresAt: string | null;
  active: boolean;
  notes: string;
  createdAt: string;
  usable?: boolean;
  gateReason?: string;
  daysLeft?: number | null;
};

function planBadge(r: License) {
  if (!r.active) return <span className="badge off">off</span>;
  if (r.gateReason === "trial_expired" || r.gateReason === "expired") {
    return <span className="badge off">{r.plan === "trial" ? "trial expired" : "expired"}</span>;
  }
  if (r.plan === "trial") {
    const left = typeof r.daysLeft === "number" ? r.daysLeft : null;
    return (
      <span className="badge warn">
        trial{left !== null ? ` · ${left}d left` : ""}
      </span>
    );
  }
  return <span className="badge ok">paid</span>;
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
    setBusy(true);
    const fd = new FormData(e.currentTarget);
    const res = await fetch("/api/licenses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        label: fd.get("label"),
        siteUrl: fd.get("siteUrl"),
        notes: fd.get("notes"),
        plan: fd.get("plan") === "trial" ? "trial" : "paid",
      }),
    });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "Create failed");
      return;
    }
    e.currentTarget.reset();
    await load();
  }

  async function patch(id: string, body: Record<string, unknown>) {
    await fetch(`/api/licenses/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    await load();
  }

  async function remove(id: string) {
    if (!confirm("Delete this license?")) return;
    await fetch(`/api/licenses/${id}`, { method: "DELETE" });
    await load();
  }

  return (
    <div className="stack">
      <div className="page-head">
        <div className="page-head__copy">
          <h1>Licenses</h1>
          <p className="muted">
            Issue a 14-day trial or paid key. After trial ends, WhatsApp stays off until converted to paid.
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
            <label htmlFor="plan">Plan</label>
            <select
              id="plan"
              name="plan"
              defaultValue="trial"
              style={{
                height: 40,
                padding: "0 12px",
                borderRadius: 8,
                border: "1px solid var(--line-strong)",
                background: "#fff",
              }}
            >
              <option value="trial">14-day free trial</option>
              <option value="paid">Paid (no expiry)</option>
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
                  <th>Plan</th>
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
                      {r.expiresAt ? (
                        <div className="muted">Expires {new Date(r.expiresAt).toLocaleDateString()}</div>
                      ) : (
                        <div className="muted">No expiry</div>
                      )}
                    </td>
                    <td>
                      <div className="key-cell">
                        <code className="key-cell__value" title={r.key}>
                          {r.key}
                        </code>
                        <CopyKeyButton value={r.key} />
                      </div>
                    </td>
                    <td className="muted cell-clamp" title={r.siteUrl || undefined}>
                      {r.siteUrl || "—"}
                    </td>
                    <td className="plan-cell">{planBadge(r)}</td>
                    <td>
                      <div className="actions">
                        {r.plan === "trial" || r.gateReason === "trial_expired" ? (
                          <button
                            type="button"
                            className="btn btn-primary"
                            onClick={() => patch(r.id, { plan: "paid" })}
                          >
                            Convert to paid
                          </button>
                        ) : null}
                        <button type="button" className="btn" onClick={() => patch(r.id, { active: !r.active })}>
                          {r.active ? "Disable" : "Enable"}
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
                    <td colSpan={5} className="muted">
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
