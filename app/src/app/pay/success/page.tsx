"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

type Phase = "loading" | "ok" | "error";

function PaySuccessInner() {
  const sp = useSearchParams();
  const sessionId = sp.get("session_id") || "";
  const returnTo = sp.get("return_to") || "";
  const [phase, setPhase] = useState<Phase>("loading");
  const [msg, setMsg] = useState("Confirming your payment…");
  const [countdown, setCountdown] = useState(3);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!sessionId) {
        setPhase("ok");
        setMsg("Payment received. Taking you back to WordPress…");
        return;
      }
      try {
        const res = await fetch("/api/v1/billing/confirm", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ session_id: sessionId }),
        });
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) {
          setPhase("error");
          setMsg(
            typeof data.error === "string"
              ? data.error
              : "Could not activate the plan yet. Keep Stripe CLI running and try Update Plan again."
          );
          return;
        }
        setPhase("ok");
        setMsg("Payment done. Your Pro plan is active — WhatsApp is unlocked.");
      } catch {
        if (!cancelled) {
          setPhase("error");
          setMsg("Network error while confirming payment.");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  useEffect(() => {
    if (phase !== "ok" || !returnTo) return;
    setCountdown(3);
    const tick = setInterval(() => {
      setCountdown((n) => Math.max(0, n - 1));
    }, 1000);
    const go = setTimeout(() => {
      window.location.href = returnTo;
    }, 3200);
    return () => {
      clearInterval(tick);
      clearTimeout(go);
    };
  }, [phase, returnTo]);

  return (
    <div className="pay-shell">
      <div className={`pay-card pay-card--${phase}`} role="status" aria-live="polite">
        <div className="pay-card__glow" aria-hidden />
        {phase === "loading" ? (
          <div className="pay-card__icon pay-card__icon--spin" aria-hidden>
            <span className="pay-spin" />
          </div>
        ) : null}
        {phase === "ok" ? (
          <div className="pay-card__icon pay-card__icon--ok" aria-hidden>
            ✓
          </div>
        ) : null}
        {phase === "error" ? (
          <div className="pay-card__icon pay-card__icon--err" aria-hidden>
            !
          </div>
        ) : null}

        <p className="pay-card__eyebrow">Prime Fleet</p>
        <h1 className="pay-card__title">
          {phase === "loading" ? "Almost done" : phase === "ok" ? "Payment done" : "Something went wrong"}
        </h1>
        <p className="pay-card__msg">{msg}</p>

        {phase === "loading" ? (
          <div className="pay-progress" aria-hidden>
            <span className="pay-progress__bar" />
          </div>
        ) : null}

        {phase === "ok" && returnTo ? (
          <p className="pay-card__hint">
            Returning to WordPress{countdown > 0 ? ` in ${countdown}s` : "…"}
          </p>
        ) : null}

        {phase === "ok" && returnTo ? (
          <a className="pay-card__btn" href={returnTo}>
            Back to WhatsApp settings
          </a>
        ) : null}

        {phase === "error" && returnTo ? (
          <a className="pay-card__btn pay-card__btn--ghost" href={returnTo}>
            Back to WordPress
          </a>
        ) : null}
      </div>

      <style>{`
        .pay-shell {
          min-height: 100vh;
          display: grid;
          place-items: center;
          padding: 24px;
          background:
            radial-gradient(900px 420px at 50% -10%, rgba(15, 61, 46, 0.12), transparent 60%),
            linear-gradient(180deg, #eef2f6 0%, #e8edf2 100%);
          font-family: "Plus Jakarta Sans", system-ui, sans-serif;
          box-sizing: border-box;
        }
        .pay-card {
          position: relative;
          width: min(420px, 100%);
          padding: 28px 26px 24px;
          border-radius: 18px;
          background: #fff;
          border: 1px solid rgba(15, 23, 42, 0.08);
          box-shadow:
            0 1px 2px rgba(15, 23, 42, 0.04),
            0 18px 40px rgba(15, 23, 42, 0.1);
          text-align: center;
          overflow: hidden;
          animation: pay-in 0.45s ease both;
        }
        .pay-card__glow {
          position: absolute;
          inset: -40% -20% auto;
          height: 120px;
          background: radial-gradient(circle, rgba(212, 175, 55, 0.18), transparent 70%);
          pointer-events: none;
        }
        .pay-card__icon {
          width: 56px;
          height: 56px;
          margin: 0 auto 14px;
          border-radius: 50%;
          display: grid;
          place-items: center;
          font-size: 24px;
          font-weight: 700;
        }
        .pay-card__icon--spin {
          background: #f1f5f9;
        }
        .pay-card__icon--ok {
          background: #ecfdf5;
          color: #047857;
          animation: pop 0.4s ease both;
        }
        .pay-card__icon--err {
          background: #fef2f2;
          color: #b91c1c;
        }
        .pay-spin {
          width: 26px;
          height: 26px;
          border: 3px solid #cbd5e1;
          border-top-color: #0f3d2e;
          border-radius: 50%;
          animation: spin 0.75s linear infinite;
        }
        .pay-card__eyebrow {
          margin: 0 0 6px;
          font-size: 12px;
          font-weight: 700;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: #64748b;
        }
        .pay-card__title {
          margin: 0 0 8px;
          font-size: 1.55rem;
          line-height: 1.2;
          color: #0f172a;
        }
        .pay-card__msg {
          margin: 0;
          color: #64748b;
          font-size: 0.95rem;
          line-height: 1.5;
        }
        .pay-card__hint {
          margin: 14px 0 0;
          font-size: 0.85rem;
          color: #94a3b8;
        }
        .pay-progress {
          margin: 18px auto 0;
          width: 70%;
          height: 4px;
          border-radius: 999px;
          background: #e2e8f0;
          overflow: hidden;
        }
        .pay-progress__bar {
          display: block;
          height: 100%;
          width: 40%;
          border-radius: inherit;
          background: linear-gradient(90deg, #0f3d2e, #d4af37);
          animation: slide 1.1s ease-in-out infinite;
        }
        .pay-card__btn {
          display: inline-flex;
          margin-top: 18px;
          padding: 11px 16px;
          border-radius: 10px;
          background: #0f3d2e;
          color: #fff;
          text-decoration: none;
          font-weight: 650;
          font-size: 0.9rem;
        }
        .pay-card__btn--ghost {
          background: #fff;
          color: #0f3d2e;
          border: 1px solid #cbd5e1;
        }
        @keyframes spin {
          to {
            transform: rotate(360deg);
          }
        }
        @keyframes slide {
          0% {
            transform: translateX(-120%);
          }
          100% {
            transform: translateX(280%);
          }
        }
        @keyframes pay-in {
          from {
            opacity: 0;
            transform: translateY(12px) scale(0.98);
          }
          to {
            opacity: 1;
            transform: none;
          }
        }
        @keyframes pop {
          from {
            transform: scale(0.7);
            opacity: 0;
          }
          to {
            transform: scale(1);
            opacity: 1;
          }
        }
      `}</style>
    </div>
  );
}

export default function PaySuccessPage() {
  return (
    <Suspense
      fallback={
        <div style={{ minHeight: "100vh", display: "grid", placeItems: "center" }}>
          Confirming…
        </div>
      }
    >
      <PaySuccessInner />
    </Suspense>
  );
}
