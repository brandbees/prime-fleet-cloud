/**
 * N8 grace unit checks (no DB). Usage: npx tsx scripts/validate-n8-grace.ts
 */
import { graceDays, graceCutoff } from "../src/lib/grace";

let fail = 0;

const days = graceDays();
if (days !== 3) {
  console.log("FAIL default grace days", days);
  fail++;
} else {
  console.log("PASS grace days = 3");
}

const now = new Date("2026-11-26T12:00:00.000Z");
const cut = graceCutoff(now);
const expected = new Date("2026-11-23T12:00:00.000Z");
if (cut.getTime() !== expected.getTime()) {
  console.log("FAIL cutoff", cut.toISOString(), expected.toISOString());
  fail++;
} else {
  console.log("PASS cutoff = now − 3d");
}

console.log(fail === 0 ? "N8 GRACE UNIT OK" : "N8 GRACE UNIT FAIL");
process.exit(fail === 0 ? 0 : 1);
