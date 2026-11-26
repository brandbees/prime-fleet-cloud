/**
 * Validate shared-VPS pay → bootstrap → session bind.
 * Usage: npx tsx scripts/validate-shared-provision.ts
 */
import { prisma } from "../src/lib/prisma";
import { setSetting, openwaSettings } from "../src/lib/settings";
import { maybeProvisionAfterWaPaid } from "../src/lib/provisioner";
import { ensureSharedOpenWa, sharedEnvSummary } from "../src/lib/vps-bootstrap";
import { sessionById } from "../src/lib/openwa";
import { waWriteFields } from "../src/lib/license-status";

async function main() {
  console.log("env", sharedEnvSummary());

  console.log("\n=== 1) SSH bootstrap (idempotent) ===");
  const ready = await ensureSharedOpenWa();
  console.log("ready", {
    ip: ready.ip,
    baseUrl: ready.baseUrl,
    alreadyRunning: ready.alreadyRunning,
    apiKeyPrefix: ready.apiKey.slice(0, 12) + "…",
  });

  const cfg = await openwaSettings();
  console.log("panel openwa", {
    baseUrl: cfg.baseUrl,
    configured: cfg.configured,
    source: cfg.source,
  });

  console.log("\n=== 2) Pick / mint license with WA paid ===");
  let license = await prisma.license.findFirst({
    where: { active: true },
    orderBy: { updatedAt: "desc" },
  });
  if (!license) {
    license = await prisma.license.create({
      data: {
        key: `PF-TEST-SHARED-${Date.now()}`,
        label: "shared-provision-validate",
        siteUrl: "https://example.test",
        active: true,
        plan: "paid",
        ...waWriteFields("monthly", null),
      },
    });
    console.log("created license", license.id);
  } else {
    license = await prisma.license.update({
      where: { id: license.id },
      data: {
        active: true,
        ...waWriteFields("monthly", null),
        // Force re-bind for this validate run
        openwaSessionId: "",
        serverStatus: "none",
        serverIp: "",
      },
    });
    console.log("using license", license.id, license.keyPrefix || license.key.slice(0, 16));
  }

  // Clear prior instance so provision runs fresh
  await prisma.waInstance.deleteMany({ where: { licenseId: license.id } });

  console.log("\n=== 3) maybeProvisionAfterWaPaid (pay path) ===");
  const inst = await maybeProvisionAfterWaPaid(license.id);
  console.log("instance", {
    status: inst?.status,
    ip: inst?.ip,
    provider: inst?.provider,
    openwaBaseUrl: inst?.openwaBaseUrl,
    lastError: inst?.lastError,
  });

  const after = await prisma.license.findUniqueOrThrow({ where: { id: license.id } });
  console.log("license after", {
    serverStatus: after.serverStatus,
    serverIp: after.serverIp,
    openwaSessionId: after.openwaSessionId,
    waEntitlement: after.waEntitlement,
  });

  if (inst?.status !== "running") throw new Error(`Expected running, got ${inst?.status}`);
  if (!after.openwaSessionId) throw new Error("Expected openwaSessionId on license");

  console.log("\n=== 4) Session exists on OpenWA ===");
  const live = await sessionById(after.openwaSessionId);
  console.log("session", { ok: live.ok, status: live.status, http: live.http });
  if (!live.ok) throw new Error(`Session lookup failed HTTP ${live.http}`);

  console.log("\nSHARED PROVISION VALIDATE OK");
}

main()
  .catch((e) => {
    console.error("VALIDATE FAIL", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
