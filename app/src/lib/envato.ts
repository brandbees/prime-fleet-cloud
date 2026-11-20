/**
 * Envato Market purchase-code verify (Sprint 4).
 * Live: ENVATO_PERSONAL_TOKEN + ENVATO_ITEM_ID.
 * Local: ALLOW_MOCK_ENVATO=1 (or non-production) accepts codes starting with MOCK- / TEST-.
 */
import { env } from "./env";
import { mockEnvatoAllowed } from "./security";

export type EnvatoVerifyOk = {
  ok: true;
  buyer: string;
  itemId: string;
  itemName: string;
  soldAt: string;
  license: string;
  mock: boolean;
};

export type EnvatoVerifyFail = {
  ok: false;
  error: string;
};

export type EnvatoVerifyResult = EnvatoVerifyOk | EnvatoVerifyFail;

export function mockAllowed() {
  return mockEnvatoAllowed();
}

export function envatoConfigured() {
  return Boolean(env("ENVATO_PERSONAL_TOKEN") && env("ENVATO_ITEM_ID"));
}

export async function verifyEnvatoPurchaseCode(code: string): Promise<EnvatoVerifyResult> {
  const purchaseCode = String(code || "").trim();
  if (!purchaseCode) {
    return { ok: false, error: "Enter your Envato purchase code." };
  }

  const token = env("ENVATO_PERSONAL_TOKEN");
  const itemId = env("ENVATO_ITEM_ID");

  if (!token || !itemId) {
    if (!mockAllowed()) {
      return {
        ok: false,
        error: "Envato is not configured on the panel. Contact the seller.",
      };
    }
    // Local / QA: MOCK-… or TEST-… codes issue a plugin license without calling Envato.
    if (!/^(MOCK|TEST)[-_]/i.test(purchaseCode)) {
      return {
        ok: false,
        error:
          "Envato API not configured. For local test use a code starting with MOCK- (e.g. MOCK-DEMO-001).",
      };
    }
    return {
      ok: true,
      buyer: "mock-buyer",
      itemId: itemId || "0",
      itemName: "Prime Fleet (mock)",
      soldAt: new Date().toISOString(),
      license: "Regular License",
      mock: true,
    };
  }

  const url = `https://api.envato.com/v3/market/author/sale?code=${encodeURIComponent(purchaseCode)}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
    cache: "no-store",
  });
  const data = (await res.json().catch(() => ({}))) as {
    error?: string;
    description?: string;
    item?: { id?: number | string; name?: string };
    buyer?: string;
    sold_at?: string;
    license?: string;
  };

  if (!res.ok) {
    const msg =
      data.error ||
      data.description ||
      (res.status === 404 ? "Invalid purchase code." : "Could not verify purchase code.");
    return { ok: false, error: String(msg) };
  }

  const saleItemId = String(data.item?.id ?? "");
  if (saleItemId && saleItemId !== String(itemId)) {
    return { ok: false, error: "This purchase code is for a different item." };
  }

  return {
    ok: true,
    buyer: String(data.buyer || ""),
    itemId: saleItemId || String(itemId),
    itemName: String(data.item?.name || "Prime Fleet"),
    soldAt: String(data.sold_at || ""),
    license: String(data.license || ""),
    mock: false,
  };
}
