"use client";

import { FormEvent, useEffect, useState } from "react";
import { PanelLoader } from "@/components/Loader";

type BillingSettings = {
  configured: boolean;
  stripe_secret_key_set: boolean;
  stripe_secret_key_masked: string;
  stripe_webhook_secret_set: boolean;
  stripe_webhook_secret_masked: string;
  stripe_price_id: string;
  stripe_amount_cents: number;
  stripe_currency: string;
  webhook_url: string;
  note: string;
};

export default function BillingPage() {
  const [data, setData] = useState<BillingSettings | null>(null);
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/billing/settings", { credentials: "same-origin" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error || "Failed to load billing settings");
        return;
      }
      setData(json);
      setError("");
    } catch {
      setError("Failed to load billing settings");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function onSave(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    setBusy(true);
    setError("");
    setOk("");
    const fd = new FormData(form);
    try {
      const res = await fetch("/api/billing/settings", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stripe_secret_key: String(fd.get("stripe_secret_key") || ""),
          stripe_webhook_secret: String(fd.get("stripe_webhook_secret") || ""),
          stripe_price_id: String(fd.get("stripe_price_id") || ""),
          stripe_amount_cents: String(fd.get("stripe_amount_cents") || "9900"),
          stripe_currency: String(fd.get("stripe_currency") || "usd"),
        }),
      });
      const raw = await res.text();
      let json: Record<string, unknown> = {};
      try {
        json = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        json = {};
      }
      if (!res.ok) {
        setError(typeof json.error === "string" ? json.error : `Save failed (HTTP ${res.status})`);
        return;
      }
      setOk(
        json.configured
          ? "Saved. Stripe checkout is live — Upgrade will open Stripe."
          : "Saved. Add a Stripe secret key to leave mock checkout."
      );
      await load();
      form.reset();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  if (loading && !data) return <PanelLoader label="Loading billing…" />;

  return (
    <div className="page">
      <header className="page__head">
        <div>
          <h1>Billing</h1>
          <p className="muted">
            Stripe one-time Checkout after trial ends. No Stripe Customers — pay once, license activates via webhook.
          </p>
        </div>
        <span className={`badge ${data?.configured ? "ok" : "warn"}`}>
          {data?.configured ? "Stripe on" : "Mock / not configured"}
        </span>
      </header>

      {error ? (
        <div className="alert alert--error" role="alert">
          {error}
        </div>
      ) : null}
      {ok ? (
        <div className="alert alert--ok" role="status">
          {ok}
        </div>
      ) : null}

      <form className="card" onSubmit={onSave} style={{ maxWidth: 560, display: "grid", gap: 14 }}>
        <label className="field">
          <span>Stripe secret key</span>
          <input
            name="stripe_secret_key"
            type="password"
            autoComplete="off"
            placeholder={data?.stripe_secret_key_set ? data.stripe_secret_key_masked : "sk_live_… or sk_test_…"}
          />
          <span className="muted">Leave blank to keep current key.</span>
        </label>

        <label className="field">
          <span>Webhook signing secret</span>
          <input
            name="stripe_webhook_secret"
            type="password"
            autoComplete="off"
            placeholder={data?.stripe_webhook_secret_set ? data.stripe_webhook_secret_masked : "whsec_…"}
          />
          <span className="muted">From `stripe listen` (whsec_…) for local tests.</span>
        </label>

        <label className="field">
          <span>Webhook URL (CLI forward / Dashboard)</span>
          <input readOnly value={data?.webhook_url || ""} onFocus={(e) => e.currentTarget.select()} />
        </label>

        <label className="field">
          <span>Price ID (optional)</span>
          <input name="stripe_price_id" defaultValue={data?.stripe_price_id || ""} placeholder="price_… (or leave empty)" />
          <span className="muted">If empty, amount below is used as a one-off line item.</span>
        </label>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <label className="field">
            <span>Amount (cents)</span>
            <input name="stripe_amount_cents" type="number" min={50} defaultValue={data?.stripe_amount_cents || 9900} />
          </label>
          <label className="field">
            <span>Currency</span>
            <input name="stripe_currency" defaultValue={data?.stripe_currency || "usd"} />
          </label>
        </div>

        <button type="submit" className="btn btn-primary" disabled={busy} aria-busy={busy}>
          {busy ? (
            <>
              <span className="loader__spin" aria-hidden />
              Saving…
            </>
          ) : (
            "Save Stripe settings"
          )}
        </button>
      </form>
    </div>
  );
}
