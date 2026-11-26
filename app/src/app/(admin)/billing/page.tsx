"use client";

import { FormEvent, useEffect, useState } from "react";
import { PanelLoader } from "@/components/Loader";

type BillingSettings = {
  configured: boolean;
  stripe_secret_key_set: boolean;
  stripe_secret_key_masked: string;
  stripe_webhook_secret_set: boolean;
  stripe_webhook_secret_masked: string;
  stripe_price_id_monthly: string;
  stripe_price_id_yearly: string;
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
          stripe_price_id_monthly: String(fd.get("stripe_price_id_monthly") || ""),
          stripe_price_id_yearly: String(fd.get("stripe_price_id_yearly") || ""),
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
          ? "Saved. Hosted WA checkout uses Stripe Subscriptions (monthly / yearly)."
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
            Hosted WhatsApp subscriptions: <strong>$15/mo</strong> monthly ·{" "}
            <strong>$10/mo</strong> yearly ($120/yr). Create two recurring Prices in Stripe, paste IDs
            below. Webhook activates the matching plan.
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
          <span className="muted">Dashboard webhook or `stripe listen` → forward to URL below.</span>
        </label>

        <label className="field">
          <span>Webhook URL</span>
          <input readOnly value={data?.webhook_url || ""} onFocus={(e) => e.currentTarget.select()} />
          <span className="muted">
            Events: checkout.session.completed · customer.subscription.deleted · charge.refunded ·
            charge.dispute.created
          </span>
        </label>

        <label className="field">
          <span>Monthly price ID ($15 / month)</span>
          <input
            name="stripe_price_id_monthly"
            defaultValue={data?.stripe_price_id_monthly || ""}
            placeholder="price_… recurring monthly"
          />
        </label>

        <label className="field">
          <span>Yearly price ID ($10/mo → $120 / year)</span>
          <input
            name="stripe_price_id_yearly"
            defaultValue={data?.stripe_price_id_yearly || ""}
            placeholder="price_… recurring yearly"
          />
        </label>

        <label className="field">
          <span>Currency</span>
          <input name="stripe_currency" defaultValue={data?.stripe_currency || "usd"} />
          <span className="muted">
            If a Price ID is empty, Checkout builds price_data at $15/mo or $120/yr for that plan
            (still subscription mode — Dashboard Prices recommended for production).
          </span>
        </label>

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
