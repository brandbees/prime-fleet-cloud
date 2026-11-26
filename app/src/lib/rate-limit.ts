/**
 * Durable rate limiter: Postgres-backed with in-memory fast path.
 * Works across multiple Node processes (panel replicas).
 */
import { prisma } from "./prisma";

type Bucket = { count: number; resetAt: number };

const memory = new Map<string, Bucket>();

export function allowRateMemory(
  key: string,
  max: number,
  windowMs: number
): { ok: true } | { ok: false; retryAfterSec: number } {
  const now = Date.now();
  const cur = memory.get(key);
  if (!cur || now >= cur.resetAt) {
    memory.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true };
  }
  if (cur.count >= max) {
    return { ok: false, retryAfterSec: Math.max(1, Math.ceil((cur.resetAt - now) / 1000)) };
  }
  cur.count += 1;
  return { ok: true };
}

/** @deprecated use allowRateDurable — kept for sync call sites during migrate */
export function allowRate(key: string, max: number, windowMs: number) {
  return allowRateMemory(key, max, windowMs);
}

export async function allowRateDurable(
  key: string,
  max: number,
  windowMs: number
): Promise<{ ok: true } | { ok: false; retryAfterSec: number }> {
  const now = Date.now();
  const mem = allowRateMemory(key, max, windowMs);
  if (!mem.ok) return mem;

  try {
    const row = await prisma.rateLimitBucket.findUnique({ where: { key } });
    if (!row || row.resetAt.getTime() <= now) {
      await prisma.rateLimitBucket.upsert({
        where: { key },
        create: { key, count: 1, resetAt: new Date(now + windowMs) },
        update: { count: 1, resetAt: new Date(now + windowMs) },
      });
      return { ok: true };
    }
    if (row.count >= max) {
      /* roll back optimistic memory increment */
      const b = memory.get(key);
      if (b && b.count > 0) b.count -= 1;
      return {
        ok: false,
        retryAfterSec: Math.max(1, Math.ceil((row.resetAt.getTime() - now) / 1000)),
      };
    }
    await prisma.rateLimitBucket.update({
      where: { key },
      data: { count: { increment: 1 } },
    });
    return { ok: true };
  } catch {
    /* DB down — memory already applied */
    return { ok: true };
  }
}
