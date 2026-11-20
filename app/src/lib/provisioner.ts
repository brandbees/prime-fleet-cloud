/**
 * Hosted WhatsApp instance provisioner.
 * Webdock is HOLD — default provider is mock (local). Swap provider later without changing call sites.
 */
import { prisma } from "./prisma";
import { canUseWhatsApp, normalizeWaEntitlement } from "./license-status";

export type InstanceStatus = "none" | "provisioning" | "running" | "error" | "stopped";

const MOCK_PROVISION_MS = 4_000;

function mockIpFor(licenseId: string) {
  // Deterministic fake public IP for local demos (not routable).
  let h = 0;
  for (let i = 0; i < licenseId.length; i++) h = (h * 31 + licenseId.charCodeAt(i)) >>> 0;
  const a = 10;
  const b = (h >> 16) & 0xff;
  const c = (h >> 8) & 0xff;
  const d = (h & 0xfe) + 1;
  return `${a}.${b}.${c}.${d}`;
}

async function syncLicenseMirror(licenseId: string, status: InstanceStatus, ip: string) {
  await prisma.license.update({
    where: { id: licenseId },
    data: { serverStatus: status, serverIp: ip },
  });
}

export async function getInstanceForLicense(licenseId: string) {
  return prisma.waInstance.findUnique({ where: { licenseId } });
}

export async function listInstances() {
  return prisma.waInstance.findMany({
    orderBy: { updatedAt: "desc" },
    include: {
      license: {
        select: {
          id: true,
          key: true,
          label: true,
          siteUrl: true,
          waEntitlement: true,
          plan: true,
          active: true,
        },
      },
    },
  });
}

/**
 * Start (or restart) mock provision after WA paid / operator retry.
 * Idempotent: one instance row per license.
 */
export async function startProvision(licenseId: string, note = "mock provision started") {
  const license = await prisma.license.findUnique({ where: { id: licenseId } });
  if (!license) throw new Error("License not found");
  const wa = canUseWhatsApp(license);
  if (!wa.ok) throw new Error("Hosted WhatsApp entitlement required before provision");

  const provider = process.env.WA_PROVIDER || "mock";
  if (provider !== "mock") {
    throw new Error(`Provider "${provider}" not implemented yet (Webdock HOLD). Use mock.`);
  }

  const existing = await prisma.waInstance.findUnique({ where: { licenseId } });
  if (existing?.status === "running" && existing.ip) {
    await syncLicenseMirror(licenseId, "running", existing.ip);
    return existing;
  }

  const row = await prisma.waInstance.upsert({
    where: { licenseId },
    create: {
      licenseId,
      provider: "mock",
      providerId: `mock-${licenseId.slice(-8)}`,
      status: "provisioning",
      ip: "",
      openwaBaseUrl: "",
      lastError: "",
      provisionedAt: null,
      poweredOffAt: null,
    },
    update: {
      provider: "mock",
      status: "provisioning",
      ip: "",
      openwaBaseUrl: "",
      lastError: "",
      provisionedAt: null,
      poweredOffAt: null,
    },
  });

  await prisma.license.update({
    where: { id: licenseId },
    data: {
      serverStatus: "provisioning",
      serverIp: "",
      notes: note.slice(0, 500),
    },
  });

  return row;
}

/** Advance mock boxes that have been provisioning long enough. Safe to call on every status poll. */
export async function tickMockProvision(licenseId: string) {
  const inst = await prisma.waInstance.findUnique({ where: { licenseId } });
  if (!inst || inst.provider !== "mock") return inst;
  if (inst.status !== "provisioning") return inst;

  const age = Date.now() - new Date(inst.updatedAt).getTime();
  if (age < MOCK_PROVISION_MS) return inst;

  const ip = mockIpFor(licenseId);
  let openwaBaseUrl = process.env.OPENWA_BASE_URL || "http://127.0.0.1:2785";
  try {
    const { openwaSettings } = await import("./settings");
    const s = await openwaSettings();
    if (s.baseUrl) openwaBaseUrl = s.baseUrl;
  } catch {
    /* keep env fallback */
  }
  const updated = await prisma.waInstance.update({
    where: { id: inst.id },
    data: {
      status: "running",
      ip,
      openwaBaseUrl,
      lastError: "",
      provisionedAt: new Date(),
      poweredOffAt: null,
    },
  });
  await syncLicenseMirror(licenseId, "running", ip);
  return updated;
}

export async function powerOffInstance(licenseId: string) {
  const inst = await prisma.waInstance.findUnique({ where: { licenseId } });
  if (!inst) throw new Error("No instance for this license");

  // Webdock HOLD: mock power-off only (no destroy).
  const updated = await prisma.waInstance.update({
    where: { id: inst.id },
    data: {
      status: "stopped",
      lastError: "",
      poweredOffAt: new Date(),
    },
  });
  await syncLicenseMirror(licenseId, "stopped", updated.ip);
  return updated;
}

/** Drop WA entitlement + power-off box (cancel / unpaid path). */
export async function suspendHostedForUnpaid(licenseId: string, note = "WA unpaid — powered off") {
  const { waWriteFields } = await import("./license-status");
  await prisma.license.update({
    where: { id: licenseId },
    data: {
      ...waWriteFields("none", null),
      notes: note.slice(0, 500),
    },
  });
  const inst = await prisma.waInstance.findUnique({ where: { licenseId } });
  if (inst && inst.status !== "none") {
    return powerOffInstance(licenseId);
  }
  await syncLicenseMirror(licenseId, "none", "");
  return null;
}

export async function forceDestroyInstance(licenseId: string) {
  const inst = await prisma.waInstance.findUnique({ where: { licenseId } });
  if (!inst) {
    await syncLicenseMirror(licenseId, "none", "");
    return null;
  }
  await prisma.waInstance.delete({ where: { id: inst.id } });
  await syncLicenseMirror(licenseId, "none", "");
  return { ok: true as const };
}

export async function markInstanceError(licenseId: string, message: string) {
  const inst = await prisma.waInstance.findUnique({ where: { licenseId } });
  if (!inst) throw new Error("No instance for this license");
  const updated = await prisma.waInstance.update({
    where: { id: inst.id },
    data: { status: "error", lastError: message.slice(0, 500) },
  });
  await syncLicenseMirror(licenseId, "error", updated.ip);
  return updated;
}

/** After converting to paid in admin — kick mock provision if none/stopped. */
export async function maybeProvisionAfterWaPaid(licenseId: string) {
  const license = await prisma.license.findUnique({ where: { id: licenseId } });
  if (!license) return null;
  if (normalizeWaEntitlement(license) === "none") return null;
  const wa = canUseWhatsApp(license);
  if (!wa.ok) return null;
  const inst = await prisma.waInstance.findUnique({ where: { licenseId } });
  if (inst?.status === "running") return inst;
  return startProvision(licenseId, "auto provision after WA paid");
}
