import { prisma } from "./prisma";
import { env } from "./env";

const cache = new Map<string, { v: string; at: number }>();
const TTL = 15_000;

export async function getSetting(key: string, fallback = "") {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.v || fallback;
  try {
    const row = await prisma.appSetting.findUnique({ where: { key } });
    const v = row?.value ?? "";
    cache.set(key, { v, at: Date.now() });
    return v || fallback;
  } catch {
    return fallback;
  }
}

export async function setSetting(key: string, value: string) {
  await prisma.appSetting.upsert({
    where: { key },
    create: { key, value },
    update: { value },
  });
  cache.set(key, { v: value, at: Date.now() });
}

export async function stripeSettings() {
  const secret = (await getSetting("stripe_secret_key")) || env("STRIPE_SECRET_KEY");
  const webhook = (await getSetting("stripe_webhook_secret")) || env("STRIPE_WEBHOOK_SECRET");
  const priceId = (await getSetting("stripe_price_id")) || env("STRIPE_PRICE_ID");
  const amountRaw = (await getSetting("stripe_amount_cents")) || env("STRIPE_AMOUNT_CENTS", "9900");
  const currency = ((await getSetting("stripe_currency")) || env("STRIPE_CURRENCY", "usd")).toLowerCase();
  const amountCents = Number(amountRaw) || 9900;
  return {
    secretKey: secret.trim(),
    webhookSecret: webhook.trim(),
    priceId: priceId.trim(),
    amountCents,
    currency,
    configured: Boolean(secret.trim()),
  };
}
