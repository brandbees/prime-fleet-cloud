import { randomBytes } from "crypto";

export function generateLicenseKey() {
  const a = randomBytes(4).toString("hex").toUpperCase();
  const b = randomBytes(4).toString("hex").toUpperCase();
  const c = randomBytes(4).toString("hex").toUpperCase();
  return `PF-${a}-${b}-${c}`;
}
