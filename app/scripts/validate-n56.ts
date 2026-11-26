import { prisma } from "../src/lib/prisma";
import { keyPrefixOf } from "../src/lib/licenses";
import { encryptSecret, decryptSecret } from "../src/lib/secrets";
import { allowRateDurable } from "../src/lib/rate-limit";
import { hashLicenseKey, signValidatePayload } from "../src/lib/security";
import { writeAudit } from "../src/lib/audit";
import { classifySessionHealth } from "../src/lib/license-status";
import { friendlyOpenWaMessage } from "../src/lib/openwa";
import fs from "fs";
import path from "path";

let fail = 0;
function pass(m: string) {
  console.log("PASS", m);
}
function bad(m: string) {
  console.log("FAIL", m);
  fail++;
}

async function main() {
  /* —— N5/N6 core —— */
  const rows = await prisma.license.findMany();
  let n = 0;
  for (const r of rows) {
    if (r.keyPrefix) continue;
    if (!r.key || r.key.startsWith("PF-HASHONLY-")) continue;
    await prisma.license.update({
      where: { id: r.id },
      data: { keyPrefix: keyPrefixOf(r.key), keyHash: r.keyHash || hashLicenseKey(r.key) },
    });
    n++;
  }
  pass(`keyPrefix backfill ${n}`);

  const enc = encryptSecret("sk_test_hello");
  const dec = decryptSecret(enc);
  if (dec === "sk_test_hello") pass("secrets roundtrip");
  else bad("secrets roundtrip");

  const k = `n56:block:${Date.now()}`;
  await allowRateDurable(k, 1, 60_000);
  const blocked = await allowRateDurable(k, 1, 60_000);
  if (!blocked.ok) pass("durable rate block");
  else bad("durable rate block");

  const signed = signValidatePayload({ valid: true, plan: "paid" });
  if (signed.sig && signed.ts) pass("hmac fields");
  else bad("hmac fields");

  await writeAudit({ action: "test.n56", actor: "validate", meta: { ok: true } });
  const audit = await prisma.auditLog.findFirst({
    where: { action: "test.n56" },
    orderBy: { createdAt: "desc" },
  });
  if (audit) pass("audit write");
  else bad("audit write");

  const rl = await prisma.rateLimitBucket.findFirst();
  if (rl) pass("RateLimitBucket rows");
  else pass("RateLimitBucket empty-ok");

  /* —— N2 health —— */
  const h = classifySessionHealth({
    hasSessionId: true,
    sessionStatus: "logged_out",
    phoneConnected: false,
  });
  if (h === "needs_reconnect") pass("N2 session health");
  else bad("N2 session health");

  const friendly = friendlyOpenWaMessage(
    "Session is not started. Call POST /sessions/:sessionId/start first."
  );
  if (friendly.includes("Starting") && !friendly.includes("POST")) pass("N2 friendly OpenWA msg");
  else bad("N2 friendly OpenWA msg");

  /* —— N1 / N3 file checks (WP + panel) —— */
  const root = path.resolve(__dirname, "../../..");
  const settings = fs.readFileSync(
    path.join(root, "prime-fleet/includes/Admin/Pages/Settings.php"),
    "utf8"
  );
  if (settings.includes("dedicated server") && !settings.includes("roll out after")) {
    pass("N1 product dedicated copy");
  } else bad("N1 product dedicated copy");
  if (!settings.includes("data-pf-wa-server-ready")) pass("N3 no ready+IP banner");
  else bad("N3 no ready+IP banner");
  if (settings.includes("data-pf-wa-server-stopped") && settings.includes("data-pf-wa-provision")) {
    pass("N3 lifecycle banners");
  } else bad("N3 lifecycle banners");
  if (settings.includes("data-pf-wa-health") || settings.includes("Phone link")) {
    pass("N2 phone link UI");
  } else bad("N2 phone link UI");

  const instances = fs.readFileSync(
    path.join(root, "prime-fleet-cloud/app/src/app/(admin)/instances/page.tsx"),
    "utf8"
  );
  if (instances.includes("Powered off") && instances.includes("Retry provision")) {
    pass("N3 Instances labels");
  } else bad("N3 Instances labels");

  const middleware = fs.readFileSync(
    path.join(root, "prime-fleet-cloud/app/src/middleware.ts"),
    "utf8"
  );
  if (middleware.includes("Content-Security-Policy")) pass("N5 CSP middleware");
  else bad("N5 CSP middleware");

  const httpsDoc = path.join(root, "prime-fleet/docs/PANEL_HTTPS.md");
  if (fs.existsSync(httpsDoc)) pass("N5 HTTPS doc");
  else bad("N5 HTTPS doc");

  const boss = path.join(root, "prime-fleet/docs/BOSS_DECISIONS_HOSTED_WA.md");
  if (fs.existsSync(boss)) pass("N1 boss one-pager");
  else bad("N1 boss one-pager");

  await prisma.$disconnect();
  if (fail) {
    console.log(`VALIDATE FAIL (${fail})`);
    process.exit(1);
  }
  console.log("VALIDATE N1 N2 N3 N5 N6 OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
