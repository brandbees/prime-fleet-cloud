"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

function MockPayInner() {
  const sp = useSearchParams();
  const token = sp.get("token") || "";
  const plan = (sp.get("plan") || "monthly").toLowerCase() === "yearly" ? "yearly" : "monthly";
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  const priceLabel =
    plan === "yearly" ? "$10/mo · billed yearly ($120/yr)" : "$15/mo · month-to-month";

  async function pay() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/pay/mock/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, plan }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Payment failed");
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Payment failed");
    } finally {
      setBusy(false);
    }
  }

  if (!token) {
    return <p style={{ padding: 24 }}>Missing payment token. Open Upgrade from WordPress again.</p>;
  }

  if (done) {
    return (
      <main style={wrap}>
        <h1 style={{ margin: "0 0 8px" }}>Payment complete</h1>
        <p style={{ color: "#64748b", margin: 0 }}>
          Hosted WhatsApp ({plan}) is unlocked. Return to WordPress → Settings → WhatsApp.
        </p>
      </main>
    );
  }

  return (
    <main style={wrap}>
      <h1 style={{ margin: "0 0 8px" }}>Upgrade WhatsApp</h1>
      <p style={{ color: "#64748b", margin: "0 0 8px" }}>
        Local / test checkout (Stripe not configured).
      </p>
      <p style={{ margin: "0 0 20px", fontWeight: 600 }}>
        {plan === "yearly" ? "Yearly" : "Monthly"} — {priceLabel}
      </p>
      {error ? <p style={{ color: "#b91c1c" }}>{error}</p> : null}
      <button type="button" onClick={pay} disabled={busy} style={btn}>
        {busy ? "Processing…" : "Pay & activate"}
      </button>
    </main>
  );
}

const wrap: React.CSSProperties = {
  maxWidth: 420,
  margin: "10vh auto",
  padding: 24,
  fontFamily: "system-ui, sans-serif",
};
const btn: React.CSSProperties = {
  background: "#0f172a",
  color: "#fff",
  border: 0,
  borderRadius: 8,
  padding: "12px 18px",
  fontWeight: 600,
  cursor: "pointer",
};

export default function MockPayPage() {
  return (
    <Suspense fallback={<p style={{ padding: 24 }}>Loading…</p>}>
      <MockPayInner />
    </Suspense>
  );
}
