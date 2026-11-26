"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

function safeReturnTo(raw: string) {
  try {
    if (!raw) return "";
    const u = new URL(raw);
    if (u.protocol !== "http:" && u.protocol !== "https:") return "";
    if (u.username || u.password) return "";
    return raw;
  } catch {
    return "";
  }
}

function PayCancelInner() {
  const sp = useSearchParams();
  const returnTo = safeReturnTo(sp.get("return_to") || "");
  const [countdown, setCountdown] = useState(returnTo ? 2 : 0);

  useEffect(() => {
    if (!returnTo) return;
    setCountdown(2);
    const tick = setInterval(() => {
      setCountdown((n) => Math.max(0, n - 1));
    }, 1000);
    const go = setTimeout(() => {
      window.location.href = returnTo;
    }, 2200);
    return () => {
      clearInterval(tick);
      clearTimeout(go);
    };
  }, [returnTo]);

  const hint = returnTo
    ? countdown > 0
      ? `Returning to WordPress in ${countdown}s…`
      : "Returning to WordPress…"
    : "Open WordPress → Settings → WhatsApp to try again.";

  return (
    <div className="pay-shell">
      <div className="pay-card" role="status" aria-live="polite">
        <div className="pay-card__glow" aria-hidden />
        <div className="pay-card__icon" aria-hidden>
          ✕
        </div>
        <p className="pay-card__eyebrow">Prime Fleet</p>
        <h1 className="pay-card__title">Checkout cancelled</h1>
        <p className="pay-card__msg">No charge was made. {hint}</p>
        {returnTo ? (
          <a className="pay-card__btn" href={returnTo}>
            Back to WhatsApp settings
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
            radial-gradient(900px 420px at 50% -10%, rgba(15, 61, 46, 0.1), transparent 60%),
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
          background: radial-gradient(circle, rgba(148, 163, 184, 0.2), transparent 70%);
          pointer-events: none;
        }
        .pay-card__icon {
          width: 56px;
          height: 56px;
          margin: 0 auto 14px;
          border-radius: 50%;
          display: grid;
          place-items: center;
          font-size: 22px;
          font-weight: 700;
          background: #f1f5f9;
          color: #64748b;
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
      `}</style>
    </div>
  );
}

export default function PayCancelPage() {
  return (
    <Suspense
      fallback={
        <div
          style={{
            minHeight: "100vh",
            display: "grid",
            placeItems: "center",
            background: "#eef2f6",
            color: "#64748b",
            fontFamily: "system-ui, sans-serif",
          }}
        >
          Checkout cancelled…
        </div>
      }
    >
      <PayCancelInner />
    </Suspense>
  );
}
