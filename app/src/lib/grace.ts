/**
 * Unpaid Hosted WA grace → power-off (boss L3).
 * Sends lock immediately (entitlement none); box stays up for WA_GRACE_DAYS then power-off.
 * Works on mock + shared providers. Dedicated Webdock destroy stays HOLD.
 */
import { prisma } from "./prisma";
import { waWriteFields } from "./license-status";
import { env } from "./env";

export function graceDays() {
  const n = Number(env("WA_GRACE_DAYS", "3"));
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 3;
}

export function graceCutoff(now = new Date()) {
  const ms = graceDays() * 24 * 60 * 60 * 1000;
  return new Date(now.getTime() - ms);
}

/**
 * Drop Hosted WA entitlement (stop sends) and start the unpaid clock.
 * Does **not** power-off yet — `runGracePowerOffJob` does that after grace days.
 */
export async function startUnpaidGrace(licenseId: string, note = "WA unpaid — grace started") {
  const license = await prisma.license.findUnique({ where: { id: licenseId } });
  if (!license) throw new Error("License not found");

  const updated = await prisma.license.update({
    where: { id: licenseId },
    data: {
      ...waWriteFields("none", null),
      waUnpaidAt: license.waUnpaidAt || new Date(),
      notes: note.slice(0, 500),
    },
  });

  try {
    const { writeAudit } = await import("./audit");
    await writeAudit({
      action: "license.wa_unpaid_grace",
      actor: "system",
      licenseId,
      meta: { graceDays: graceDays(), note },
    });
  } catch {
    /* optional */
  }

  return updated;
}

/** Clear unpaid clock after successful pay / admin re-grant. */
export async function clearUnpaidGrace(licenseId: string) {
  return prisma.license.update({
    where: { id: licenseId },
    data: { waUnpaidAt: null },
  });
}

export type GraceJobResult = {
  graceDays: number;
  cutoff: string;
  scanned: number;
  poweredOff: string[];
  errors: { licenseId: string; error: string }[];
};

/**
 * Power-off instances whose unpaid grace ended.
 * Safe to call from cron / admin. Idempotent.
 */
export async function runGracePowerOffJob(now = new Date()): Promise<GraceJobResult> {
  const cutoff = graceCutoff(now);
  const days = graceDays();

  const due = await prisma.license.findMany({
    where: {
      waUnpaidAt: { lte: cutoff, not: null },
      serverStatus: { in: ["running", "provisioning", "error"] },
    },
    select: { id: true, label: true, serverStatus: true, waUnpaidAt: true },
  });

  const poweredOff: string[] = [];
  const errors: { licenseId: string; error: string }[] = [];

  const { powerOffInstance } = await import("./provisioner");

  for (const row of due) {
    try {
      await powerOffInstance(row.id);
      await prisma.license.update({
        where: { id: row.id },
        data: {
          notes: `Grace ended (${days}d) — Hosted WA powered off (not destroyed)`.slice(0, 500),
        },
      });
      poweredOff.push(row.id);
      try {
        const { writeAudit } = await import("./audit");
        await writeAudit({
          action: "license.wa_grace_power_off",
          actor: "system",
          licenseId: row.id,
          meta: { waUnpaidAt: row.waUnpaidAt, graceDays: days },
        });
      } catch {
        /* optional */
      }
    } catch (e) {
      errors.push({
        licenseId: row.id,
        error: e instanceof Error ? e.message : "power-off failed",
      });
    }
  }

  return {
    graceDays: days,
    cutoff: cutoff.toISOString(),
    scanned: due.length,
    poweredOff,
    errors,
  };
}
