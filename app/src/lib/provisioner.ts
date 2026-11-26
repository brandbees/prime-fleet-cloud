/**
 * Hosted WhatsApp instance provisioner.
 * Providers:
 *  - mock (default) — local demo IP + shared OPENWA_BASE_URL
 *  - shared — SSH bootstrap on WA_VPS_HOST, then bind OpenWA session to license
 * Webdock / dedicated VPS create remains HOLD (needs operator 2FA access).
 *
 * N8.1: provision + OpenWA bind only for paid Monthly/Yearly (never trial / none).
 */
import { prisma } from "./prisma";
import {
  normalizeWaEntitlement,
  requirePaidHostedWa,
} from "./license-status";

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

function activeProvider() {
  return (process.env.WA_PROVIDER || "mock").trim().toLowerCase();
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
 * Start (or restart) provision after WA paid / operator retry.
 * Idempotent: one instance row per license.
 * Refuses trial / none / expired (N8.1).
 */
export async function startProvision(licenseId: string, note = "provision started") {
  const license = await prisma.license.findUnique({ where: { id: licenseId } });
  if (!license) throw new Error("License not found");
  const wa = requirePaidHostedWa(license);
  if (!wa.ok) throw new Error(wa.message);

  const provider = activeProvider();
  if (provider !== "mock" && provider !== "shared") {
    throw new Error(
      `Provider "${provider}" is not enabled. Use WA_PROVIDER=mock or WA_PROVIDER=shared. Dedicated Webdock create is HOLD.`
    );
  }

  const existing = await prisma.waInstance.findUnique({ where: { licenseId } });
  if (existing?.status === "running" && existing.ip && license.openwaSessionId) {
    await syncLicenseMirror(licenseId, "running", existing.ip);
    return existing;
  }

  const row = await prisma.waInstance.upsert({
    where: { licenseId },
    create: {
      licenseId,
      provider,
      providerId: `${provider}-${licenseId.slice(-8)}`,
      status: "provisioning",
      ip: "",
      openwaBaseUrl: "",
      lastError: "",
      provisionedAt: null,
      poweredOffAt: null,
    },
    update: {
      provider,
      status: "provisioning",
      lastError: "",
      poweredOffAt: null,
    },
  });

  await prisma.license.update({
    where: { id: licenseId },
    data: {
      serverStatus: "provisioning",
      notes: note.slice(0, 500),
    },
  });

  if (provider === "shared") {
    return completeSharedProvision(licenseId, note);
  }

  return row;
}

/** Abort in-flight provision when entitlement is not paid. */
async function refuseUnpaidProvision(licenseId: string, message: string) {
  const inst = await prisma.waInstance.findUnique({ where: { licenseId } });
  if (inst && (inst.status === "provisioning" || inst.status === "running")) {
    try {
      await markInstanceError(licenseId, message);
    } catch {
      /* no row */
    }
  }
  return null;
}

/** Shared VPS: SSH bootstrap → persist gateway → ensure OpenWA session on license. */
async function completeSharedProvision(licenseId: string, note: string) {
  try {
    const license = await prisma.license.findUnique({ where: { id: licenseId } });
    if (!license) throw new Error("License not found");
    const wa = requirePaidHostedWa(license);
    if (!wa.ok) {
      await refuseUnpaidProvision(licenseId, wa.message);
      throw new Error(wa.message);
    }

    const { ensureSharedOpenWa } = await import("./vps-bootstrap");
    const ready = await ensureSharedOpenWa();

    const { ensureSession } = await import("./openwa");
    const sessionName = `pf-${licenseId.slice(0, 8)}`;
    const session = await ensureSession(sessionName, license.openwaSessionId || "");

    const updated = await prisma.waInstance.update({
      where: { licenseId },
      data: {
        provider: "shared",
        providerId: `shared-${ready.ip}`,
        status: "running",
        ip: ready.ip,
        openwaBaseUrl: ready.baseUrl,
        lastError: "",
        provisionedAt: new Date(),
        poweredOffAt: null,
      },
    });

    await prisma.license.update({
      where: { id: licenseId },
      data: {
        openwaSessionId: session.id,
        serverStatus: "running",
        serverIp: ready.ip,
        notes: `${note} → shared OpenWA session ${session.id.slice(0, 8)}`.slice(0, 500),
      },
    });

    return updated;
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Shared provision failed";
    await markInstanceError(licenseId, msg);
    throw e;
  }
}

/**
 * Advance mock boxes that have been provisioning long enough.
 * Safe to call on every status poll — no-ops (and errors the box) if not paid.
 */
export async function tickMockProvision(licenseId: string) {
  const license = await prisma.license.findUnique({ where: { id: licenseId } });
  if (!license) return null;

  const wa = requirePaidHostedWa(license);
  const inst = await prisma.waInstance.findUnique({ where: { licenseId } });
  if (!inst) return inst;

  if (!wa.ok) {
    if (inst.status === "provisioning") {
      await refuseUnpaidProvision(licenseId, wa.message);
    }
    return prisma.waInstance.findUnique({ where: { licenseId } });
  }

  if (inst.provider === "shared" && inst.status === "provisioning") {
    // Retry shared bind if a previous run left us mid-flight.
    try {
      return await completeSharedProvision(licenseId, "shared provision retry");
    } catch {
      return prisma.waInstance.findUnique({ where: { licenseId } });
    }
  }
  if (inst.provider !== "mock") return inst;
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

  // Shared VPS: keep OpenWA host running; only stop the license binding / mirror.
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

/** After converting to paid in admin — kick provision if none/stopped. Never trial. */
export async function maybeProvisionAfterWaPaid(licenseId: string) {
  const license = await prisma.license.findUnique({ where: { id: licenseId } });
  if (!license) return null;
  if (normalizeWaEntitlement(license) === "none") return null;
  const wa = requirePaidHostedWa(license);
  if (!wa.ok) return null;
  const inst = await prisma.waInstance.findUnique({ where: { licenseId } });
  if (inst?.status === "running" && license.openwaSessionId) return inst;
  return startProvision(licenseId, "auto provision after WA paid");
}
