const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
p.messageLog
  .findMany({
    where: { to: { contains: "923457991784" } },
    orderBy: { id: "desc" },
    take: 8,
  })
  .then(async (r) => {
    console.log(JSON.stringify(r, null, 2));
    await p.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await p.$disconnect();
    process.exit(1);
  });
