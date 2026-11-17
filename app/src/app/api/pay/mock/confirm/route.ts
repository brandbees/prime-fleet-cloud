import { NextResponse } from "next/server";
import { activatePaid, stripeConfigured, verifyPayToken } from "@/lib/billing";

/** Local / no-Stripe: confirm mock payment → activate paid license. */
export async function POST(req: Request) {
  const allowMock =
    process.env.ALLOW_MOCK_CHECKOUT === "1" || process.env.NODE_ENV !== "production";
  if (!allowMock) {
    return NextResponse.json(
      { error: "Mock checkout disabled. Configure Stripe Billing in the portal." },
      { status: 403 }
    );
  }
  if (await stripeConfigured()) {
    return NextResponse.json({ error: "Use Stripe checkout in production." }, { status: 400 });
  }
  const body = (await req.json().catch(() => ({}))) as { token?: string };
  const token = String(body.token || "").trim();
  if (!token) return NextResponse.json({ error: "Missing token" }, { status: 400 });

  try {
    const { licenseId } = await verifyPayToken(token);
    await activatePaid(licenseId, "Paid via mock checkout");
    return NextResponse.json({ ok: true, plan: "paid" });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Invalid token";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
