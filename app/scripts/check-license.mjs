import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const rows = await prisma.license.findMany({
  select: {
    key: true,
    label: true,
    active: true,
    plan: true,
    waEntitlement: true,
    siteUrl: true,
  },
});
console.log(JSON.stringify(rows, null, 2));

const key = process.argv[2] || "PF-4EA00705-5CFFA3F5-7042CBDA";
const res = await fetch("http://127.0.0.1:3000/api/v1/validate", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    license_key: key,
    site_url: "http://prime-fleet-fresh.test/",
  }),
});
console.log("validate status", res.status);
console.log(await res.text());
await prisma.$disconnect();
