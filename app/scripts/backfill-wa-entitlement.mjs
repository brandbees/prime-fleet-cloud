import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const result = await prisma.$executeRawUnsafe(`
  UPDATE "License"
  SET "waEntitlement" = "plan",
      "waExpiresAt" = "expiresAt"
  WHERE "waEntitlement" = 'none'
    AND "plan" IN ('trial', 'paid')
`);

console.log("backfilled rows:", result);
const sample = await prisma.license.findMany({
  take: 5,
  select: {
    label: true,
    plan: true,
    waEntitlement: true,
    serverStatus: true,
    active: true,
  },
});
console.log(sample);
await prisma.$disconnect();
