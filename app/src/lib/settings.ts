import { prisma } from "./prisma";
import { env } from "./env";
import { maybeDecryptSetting, maybeEncryptSetting } from "./secrets";

const cache = new Map<string, { v: string; at: number }>();
const TTL = 15_000;

export async function getSetting(key: string, fallback = "") {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.v || fallback;
  try {
    const row = await prisma.appSetting.findUnique({ where: { key } });
    const stored = row?.value ?? "";
    const v = maybeDecryptSetting(key, stored);
    cache.set(key, { v, at: Date.now() });
    return v || fallback;
  } catch {
    return fallback;
  }
}

export async function setSetting(key: string, value: string) {
  const toStore = maybeEncryptSetting(key, value);
  await prisma.appSetting.upsert({
    where: { key },
    create: { key, value: toStore },
    update: { value: toStore },
  });
  cache.set(key, { v: value, at: Date.now() });
}

/** Hosted WA SKUs: monthly $15 · yearly $10/mo ($120/yr). */
export const WA_MONTHLY_CENTS = 1500;
export const WA_YEARLY_CENTS = 12000; // $10/mo × 12

export async function stripeSettings() {
  const secret = (await getSetting("stripe_secret_key")) || env("STRIPE_SECRET_KEY");
  const webhook = (await getSetting("stripe_webhook_secret")) || env("STRIPE_WEBHOOK_SECRET");
  /* Legacy single price → treat as monthly if dedicated monthly id empty. */
  const legacyPrice =
    (await getSetting("stripe_price_id")) || env("STRIPE_PRICE_ID");
  const priceMonthly =
    (await getSetting("stripe_price_id_monthly")) ||
    env("STRIPE_PRICE_ID_MONTHLY") ||
    legacyPrice;
  const priceYearly =
    (await getSetting("stripe_price_id_yearly")) || env("STRIPE_PRICE_ID_YEARLY");
  const currency = ((await getSetting("stripe_currency")) || env("STRIPE_CURRENCY", "usd")).toLowerCase();
  return {
    secretKey: secret.trim(),
    webhookSecret: webhook.trim(),
    priceIdMonthly: priceMonthly.trim(),
    priceIdYearly: priceYearly.trim(),
    /** @deprecated kept for old Billing UI reads */
    priceId: priceMonthly.trim(),
    amountCents: WA_MONTHLY_CENTS,
    currency,
    configured: Boolean(secret.trim()),
  };
}

/** Hosted OpenWA gateway — panel DB first, .env fallback. */
export async function openwaSettings() {
  const baseFromDb = (await getSetting("openwa_base_url")).trim();
  const keyFromDb = (await getSetting("openwa_api_key")).trim();
  const sessionFromDb = (await getSetting("openwa_session_id")).trim();
  const baseUrl = (
    baseFromDb ||
    env("OPENWA_BASE_URL", "http://127.0.0.1:2785")
  )
    .replace(/\/$/, "")
    .replace(/\/api$/i, "");
  const apiKey = keyFromDb || env("OPENWA_API_KEY");
  const sessionId = sessionFromDb || env("OPENWA_SESSION_ID");
  return {
    baseUrl,
    apiKey,
    sessionId,
    configured: Boolean(baseUrl && apiKey),
    source: {
      baseUrl: baseFromDb ? ("panel" as const) : ("env" as const),
      apiKey: keyFromDb ? ("panel" as const) : apiKey ? ("env" as const) : ("none" as const),
    },
  };
}
