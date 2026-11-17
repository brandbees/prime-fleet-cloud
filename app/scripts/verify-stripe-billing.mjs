import { PrismaClient } from "@prisma/client";

const p = new PrismaClient();
const wh = await p.appSetting.findUnique({ where: { key: "stripe_webhook_secret" } });
const sk = await p.appSetting.findUnique({ where: { key: "stripe_secret_key" } });
console.log(
  JSON.stringify(
    {
      sk_prefix: (sk?.value || "").slice(0, 8),
      sk_len: (sk?.value || "").length,
      wh_full: wh?.value || "",
      wh_len: (wh?.value || "").length,
    },
    null,
    2
  )
);
await p.$disconnect();
