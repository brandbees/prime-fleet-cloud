import { PrismaClient } from "@prisma/client";

const key = process.argv[2] || "PF-C5A7BAB0-C124D087-E6F13FA1";
const p = new PrismaClient();
const d = new Date();
d.setDate(d.getDate() - 1);
const r = await p.license.update({
  where: { key },
  data: { plan: "trial", expiresAt: d, notes: "force-expired-for-billing-test" },
});
console.log(JSON.stringify({ plan: r.plan, expiresAt: r.expiresAt }));
await p.$disconnect();
