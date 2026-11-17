import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
const key = process.argv[2] || "PF-C5A7BAB0-C124D087-E6F13FA1";
const r = await p.license.findUnique({ where: { key } });
console.log(JSON.stringify(r && { plan: r.plan, expiresAt: r.expiresAt, notes: r.notes, active: r.active, openwaSessionId: r.openwaSessionId }, null, 2));
await p.$disconnect();
