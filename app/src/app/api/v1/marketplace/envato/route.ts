import { NextResponse } from "next/server";
import { issueLicenseFromPurchaseCode } from "@/lib/marketplace";
import { envatoConfigured, mockAllowed } from "@/lib/envato";
import { clientIp, rateLimited } from "@/lib/security";

export async function POST(req: Request) {
  const ip = clientIp(req);
  const limited =
    await rateLimited(`marketplace:envato:ip:${ip}`, 10, 60_000) ||
    await rateLimited(`marketplace:envato:global`, 40, 60_000);
  if (limited) return limited;

  const body = (await req.json().catch(() => ({}))) as {
    purchase_code?: string;
    site_url?: string;
    label?: string;
  };
  const purchaseCode = String(body.purchase_code || "").trim();
  if (!purchaseCode) {
    return NextResponse.json({ error: "Missing purchase_code" }, { status: 400 });
  }

  const codeLimit = await rateLimited(`marketplace:envato:code:${purchaseCode.slice(0, 40)}`, 5, 60_000);
  if (codeLimit) return codeLimit;

  const result = await issueLicenseFromPurchaseCode({
    purchaseCode,
    siteUrl: String(body.site_url || "").trim(),
    label: String(body.label || "").trim(),
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json({
    ok: true,
    license_key: result.license.key,
    activate_token: result.activate_token,
    label: result.license.label,
    reused: result.reused,
    mock: result.mock,
    envato_live: envatoConfigured(),
  });
}

export async function GET() {
  return NextResponse.json({
    envato_live: envatoConfigured(),
    mock_allowed: mockAllowed(),
  });
}
