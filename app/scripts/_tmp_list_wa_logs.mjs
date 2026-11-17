import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
const rows = await p.messageLog.findMany({
  where: { to: { contains: "923457991784" } },
  orderBy: { id: "desc" },
  take: 5,
});
console.log(JSON.stringify(rows, null, 2));
await p.$disconnect();
