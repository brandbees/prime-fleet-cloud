import { prisma } from "../src/lib/prisma";
import { keyPrefixOf } from "../src/lib/licenses";

async function main() {
  const rows = await prisma.license.findMany({
    where: { keyPrefix: "" },
  });
  let n = 0;
  for (const r of rows) {
    if (!r.key || r.key.startsWith("PF-HASHONLY-")) continue;
    await prisma.license.update({
      where: { id: r.id },
      data: { keyPrefix: keyPrefixOf(r.key) },
    });
    n++;
  }
  console.log("keyPrefix backfill", n);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
