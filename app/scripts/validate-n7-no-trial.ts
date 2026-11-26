import { normalizeWaEntitlement, canUseWhatsApp, waWriteFields } from "../src/lib/license-status";

const cases = [
  { active: true, plan: "trial", waEntitlement: "trial", expect: "none", waOk: false },
  { active: true, plan: "none", waEntitlement: "none", expect: "none", waOk: false },
  { active: true, plan: "paid", waEntitlement: "monthly", expect: "monthly", waOk: true },
  { active: true, plan: "paid", waEntitlement: "paid", expect: "paid", waOk: true },
];

let fail = 0;
for (const c of cases) {
  const got = normalizeWaEntitlement(c);
  const wa = canUseWhatsApp(c);
  if (got !== c.expect || wa.ok !== c.waOk) {
    console.log("FAIL", c, got, wa);
    fail++;
  } else {
    console.log("PASS", c.expect, wa.reason);
  }
}
const w = waWriteFields("none", null);
if (w.plan !== "none" || w.waEntitlement !== "none") {
  console.log("FAIL write", w);
  fail++;
} else {
  console.log("PASS waWrite none");
}
console.log(fail === 0 ? "N7 UNIT OK" : "N7 UNIT FAIL");
process.exit(fail === 0 ? 0 : 1);
