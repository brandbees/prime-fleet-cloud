import { prisma } from "../src/lib/prisma";
import { ensureSession, startSession, getQr, sessionById } from "../src/lib/openwa";
import { openwaSettings } from "../src/lib/settings";

async function main() {
  const lic = await prisma.license.findFirst({
    where: { openwaSessionId: { not: "" } },
    orderBy: { updatedAt: "desc" },
  });
  if (!lic) throw new Error("No license with openwaSessionId");

  const cfg = await openwaSettings();
  console.log("gateway", {
    baseUrl: cfg.baseUrl,
    hasKey: Boolean(cfg.apiKey),
    session: lic.openwaSessionId,
  });

  const session = await ensureSession(`pf-${lic.id.slice(0, 8)}`, lic.openwaSessionId);
  console.log("ensure", session);
  await startSession(session.id);
  await new Promise((r) => setTimeout(r, 1500));
  const st = await sessionById(session.id);
  console.log("status", { ok: st.ok, status: st.status, http: st.http });
  const qr = await getQr(session.id);
  console.log("qr", {
    ok: qr.ok,
    http: qr.http,
    hasQr: Boolean(qr.qr),
    message: ("engineMessage" in qr && qr.engineMessage) || qr.message || "",
  });

  if (!st.ok) throw new Error("session not ok");
  // QR may take a few seconds after start — created/starting without QR is still a valid gateway path.
  if (qr.ok && qr.qr) {
    console.log("CONNECT PATH OK (QR ready)");
  } else if (["created", "starting", "qr_ready", "SCAN_QR_CODE"].includes(String(st.status))) {
    console.log("CONNECT PATH OK (session started; QR pending/engine warming)");
  } else {
    throw new Error(`Unexpected session status ${st.status}`);
  }
}

main()
  .catch((e) => {
    console.error("CONNECT VALIDATE FAIL", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
