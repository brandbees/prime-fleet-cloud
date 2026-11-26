import { NextResponse } from "next/server";
import { activatePaid, stripeConfigured, verifyPayToken } from "@/lib/billing";
import { clientIp, mockCheckoutAllowed, rateLimited } from "@/lib/security";
import { consumeJti } from "@/lib/tokens";

/** Local / no-Stripe: confirm mock payment → activate paid license. */
export async function POST(req: Request) {
  if (!mockCheckoutAllowed()) {
    return NextResponse.json(
      { error: "Mock checkout disabled. Configure Stripe Billing in the portal." },
      { status: 403 }
    );
  }
  const limited = await rateLimited(`pay:mock:${clientIp(req)}`, 15, 60_000);
  if (limited) return limited;

  if (await stripeConfigured()) {
    return NextResponse.json({ error: "Use Stripe checkout in production." }, { status: 400 });
  }
  const body = (await req.json().catch(() => ({}))) as { token?: string; plan?: string };
  const token = String(body.token || "").trim();
  if (!token) return NextResponse.json({ error: "Missing token" }, { status: 400 });

  try {
    const parsed = await verifyPayToken(token);
    if (parsed.jti) {
      const exp = parsed.exp ? new Date(parsed.exp * 1000) : new Date(Date.now() + 2 * 3600_000);
      const first = await consumeJti(parsed.jti, "pay_mock", exp);
      if (!first) {
        return NextResponse.json({ error: "Pay token already used" }, { status: 400 });
      }
    }
    const plan = parsed.plan;
    await activatePaid(parsed.licenseId, `Paid via mock checkout (${plan})`, { plan });
    return NextResponse.json({ ok: true, plan });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Invalid token";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
