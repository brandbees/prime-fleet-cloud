import { prisma } from "./prisma";

export async function writeAudit(opts: {
  action: string;
  actor?: string;
  licenseId?: string;
  ip?: string;
  meta?: Record<string, unknown> | string;
}) {
  try {
    const meta =
      typeof opts.meta === "string"
        ? opts.meta.slice(0, 2000)
        : opts.meta
          ? JSON.stringify(opts.meta).slice(0, 2000)
          : "";
    await prisma.auditLog.create({
      data: {
        action: String(opts.action || "unknown").slice(0, 120),
        actor: String(opts.actor || "").slice(0, 200),
        licenseId: String(opts.licenseId || "").slice(0, 64),
        ip: String(opts.ip || "").slice(0, 128),
        meta,
      },
    });
  } catch {
    /* never block primary flow */
  }
}
