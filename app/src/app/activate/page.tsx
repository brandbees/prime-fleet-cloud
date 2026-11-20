"use client";

import { FormEvent, Suspense, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

function ActivateForm() {
  const params = useSearchParams();
  const returnTo = params.get("return_to") || "";
  const siteUrl = params.get("site_url") || "";
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [doneKey, setDoneKey] = useState("");

  const canReturn = useMemo(() => {
    try {
      if (!returnTo) return false;
      const u = new URL(returnTo);
      if (u.protocol !== "http:" && u.protocol !== "https:") return false;
      if (u.username || u.password) return false;
      const host = u.hostname.toLowerCase().replace(/^www\./, "");
      if (!siteUrl) {
        return host === "localhost" || host === "127.0.0.1" || host.endsWith(".local");
      }
      const site = new URL(siteUrl.includes("://") ? siteUrl : `https://${siteUrl}`);
      const siteHost = site.hostname.toLowerCase().replace(/^www\./, "");
      return host === siteHost;
    } catch {
      return false;
    }
  }, [returnTo, siteUrl]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setDoneKey("");
    try {
      const res = await fetch("/api/v1/marketplace/envato", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          purchase_code: code.trim(),
          site_url: siteUrl,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Could not verify purchase code.");
        return;
      }
      const token = String(data.activate_token || "");
      const key = String(data.license_key || "");
      if (canReturn && token) {
        const u = new URL(returnTo);
        u.searchParams.set("pf_act", token);
        u.searchParams.set("panel", "settings");
        u.searchParams.set("stab", "general");
        window.location.assign(u.toString());
        return;
      }
      setDoneKey(key);
    } catch {
      setError("Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: 24,
        background: "linear-gradient(160deg, #eef1f4 0%, #dfe8e3 50%, #eef1f4 100%)",
        fontFamily: "var(--font), system-ui, sans-serif",
      }}
    >
      <div
        className="card"
        style={{
          width: "100%",
          maxWidth: 440,
          padding: 28,
          borderRadius: 16,
          border: "1px solid var(--line)",
          background: "#fff",
          boxShadow: "0 18px 40px rgba(15, 23, 42, 0.08)",
        }}
      >
        <p className="muted" style={{ margin: "0 0 6px", fontSize: 13, letterSpacing: "0.04em" }}>
          PRIME FLEET
        </p>
        <h1 style={{ margin: "0 0 8px", fontFamily: "var(--display), Georgia, serif", fontSize: 28 }}>
          Activate your license
        </h1>
        <p className="muted" style={{ margin: "0 0 20px", lineHeight: 1.45 }}>
          Enter your Envato purchase code. We’ll issue a license key and send you back to WordPress when
          possible.
        </p>

        <form onSubmit={onSubmit} className="stack" style={{ gap: 14 }}>
          <div className="field">
            <label htmlFor="purchase_code">Purchase code</label>
            <input
              id="purchase_code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
              required
              autoComplete="off"
              spellCheck={false}
              disabled={busy}
            />
          </div>
          {siteUrl ? (
            <p className="muted" style={{ margin: 0, fontSize: 12 }}>
              Site: {siteUrl}
            </p>
          ) : null}
          {error ? <p style={{ color: "var(--danger)", margin: 0 }}>{error}</p> : null}
          {doneKey ? (
            <div
              style={{
                padding: 12,
                borderRadius: 10,
                background: "#ecfdf5",
                border: "1px solid #bbf7d0",
                color: "#166534",
                fontSize: 13,
                lineHeight: 1.45,
              }}
            >
              License ready. Paste this key in WP → Settings → License:
              <br />
              <code style={{ wordBreak: "break-all" }}>{doneKey}</code>
            </div>
          ) : null}
          <button className="btn btn-primary" type="submit" disabled={busy || !code.trim()}>
            {busy ? "Verifying…" : "Activate"}
          </button>
        </form>

        <p className="muted" style={{ margin: "18px 0 0", fontSize: 12, lineHeight: 1.4 }}>
          Local test without Envato API: use a code like <code>MOCK-DEMO-001</code>.
        </p>
      </div>
    </main>
  );
}

export default function ActivatePage() {
  return (
    <Suspense fallback={<main style={{ padding: 40 }}>Loading…</main>}>
      <ActivateForm />
    </Suspense>
  );
}
