import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { createHash } from "crypto";

const prisma = new PrismaClient();

function hashLicenseKey(key: string) {
  return createHash("sha256").update(String(key || "").trim().toUpperCase(), "utf8").digest("hex");
}

async function main() {
  const email = process.env.SEED_ADMIN_EMAIL || "admin@primefleet.local";
  const password = process.env.SEED_ADMIN_PASSWORD || "admin12345";
  const isProd = process.env.NODE_ENV === "production";

  if (isProd) {
    if (!process.env.SEED_ADMIN_PASSWORD || password === "admin12345" || password.length < 12) {
      throw new Error(
        "Refuse to seed weak admin password in production. Set SEED_ADMIN_PASSWORD (12+ chars)."
      );
    }
  }

  const hash = await bcrypt.hash(password, 12);
  const existing = await prisma.adminUser.findUnique({ where: { email } });

  if (existing) {
    if (process.env.SEED_RESET_ADMIN_PASSWORD === "1") {
      await prisma.adminUser.update({
        where: { email },
        data: { passwordHash: hash },
      });
      console.log(`Reset admin password for ${email}`);
    } else {
      console.log(`Admin ${email} exists — password unchanged (SEED_RESET_ADMIN_PASSWORD=1 to overwrite)`);
    }
  } else {
    await prisma.adminUser.create({
      data: { email, passwordHash: hash, name: "Prime Fleet Admin" },
    });
    console.log(`Seeded admin ${email}`);
  }

  /* Backfill keyHash for legacy licenses. */
  let fixed = 0;
  for (const row of await prisma.license.findMany({ select: { id: true, key: true, keyHash: true } })) {
    const want = hashLicenseKey(row.key);
    if (row.keyHash !== want) {
      try {
        await prisma.license.update({ where: { id: row.id }, data: { keyHash: want } });
        fixed += 1;
      } catch {
        /* skip collisions */
      }
    }
  }
  if (fixed) console.log(`Backfilled keyHash on ${fixed} license(s)`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
