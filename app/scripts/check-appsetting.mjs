import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
console.log("appSetting", typeof p.appSetting);
await p.appSetting.upsert({
  where: { key: "_ping" },
  create: { key: "_ping", value: "1" },
  update: { value: "1" },
});
console.log("upsert ok");
await p.$disconnect();
