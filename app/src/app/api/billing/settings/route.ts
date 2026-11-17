import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { setSetting, stripeSettings } from "@/lib/settings";
import { panelPublicUrl } from "@/lib/billing";

function mask(v: string) {
  if (!v) return "";
  if (v.length <= 10) return "••••";
  return `${v.slice(0, 7)}…${v.slice(-4)}`;
}

export async function GET() {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const s = await stripeSettings();
  return NextResponse.json({
    configured: s.configured,
    stripe_secret_key_set: Boolean(s.secretKey),
    stripe_secret_key_masked: mask(s.secretKey),
    stripe_webhook_secret_set: Boolean(s.webhookSecret),
    stripe_webhook_secret_masked: mask(s.webhookSecret),
    stripe_price_id: s.priceId,
    stripe_amount_cents: s.amountCents,
    stripe_currency: s.currency,
    webhook_url: `${panelPublicUrl()}/api/webhooks/stripe`,
    note: "One-time Checkout only — no Stripe Customer objects.",
  });
}

export async function POST(req: Request) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as Record<string, string>;
  const pairs: Array<[string, string]> = [
    ["stripe_secret_key", String(body.stripe_secret_key ?? "").trim()],
    ["stripe_webhook_secret", String(body.stripe_webhook_secret ?? "").trim()],
    ["stripe_price_id", String(body.stripe_price_id ?? "").trim()],
    ["stripe_amount_cents", String(body.stripe_amount_cents ?? "").trim()],
    ["stripe_currency", String(body.stripe_currency ?? "").trim().toLowerCase()],
  ];

  try {
    for (const [key, value] of pairs) {
      if ((key === "stripe_secret_key" || key === "stripe_webhook_secret") && value === "") {
        continue;
      }
      await setSetting(key, value);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Could not save settings";
    return NextResponse.json(
      {
        error:
          msg.includes("appSetting") || msg.includes("undefined")
            ? "Billing storage not ready — restart the cloud panel (prisma generate) and try again."
            : msg,
      },
      { status: 500 }
    );
  }

  const s = await stripeSettings();
  return NextResponse.json({
    ok: true,
    configured: s.configured,
    webhook_url: `${panelPublicUrl()}/api/webhooks/stripe`,
  });
}
