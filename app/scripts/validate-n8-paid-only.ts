/**
 * N8.1 unit checks — provision / connect gates refuse trial & unpaid.
 * Usage: npx tsx scripts/validate-n8-paid-only.ts
 */
import {
  normalizeWaEntitlement,
  requirePaidHostedWa,
  isPaidHostedWa,
} from "../src/lib/license-status";

type Case = {
  label: string;
  active: boolean;
  plan: string;
  waEntitlement: string;
  expectPaid: boolean;
  expectNorm: string;
};

const cases: Case[] = [
  {
    label: "legacy trial → unpaid",
    active: true,
    plan: "trial",
    waEntitlement: "trial",
    expectPaid: false,
    expectNorm: "none",
  },
  {
    label: "none",
    active: true,
    plan: "none",
    waEntitlement: "none",
    expectPaid: false,
    expectNorm: "none",
  },
  {
    label: "monthly paid",
    active: true,
    plan: "paid",
    waEntitlement: "monthly",
    expectPaid: true,
    expectNorm: "monthly",
  },
  {
    label: "yearly paid",
    active: true,
    plan: "paid",
    waEntitlement: "yearly",
    expectPaid: true,
    expectNorm: "yearly",
  },
  {
    label: "generic paid",
    active: true,
    plan: "paid",
    waEntitlement: "paid",
    expectPaid: true,
    expectNorm: "paid",
  },
  {
    label: "revoked + yearly",
    active: false,
    plan: "paid",
    waEntitlement: "yearly",
    expectPaid: false,
    expectNorm: "yearly",
  },
];

let fail = 0;
for (const c of cases) {
  const lic = { active: c.active, plan: c.plan, waEntitlement: c.waEntitlement, expiresAt: null };
  const norm = normalizeWaEntitlement(lic);
  const paid = isPaidHostedWa(lic);
  const req = requirePaidHostedWa(lic);
  if (norm !== c.expectNorm || paid !== c.expectPaid || req.ok !== c.expectPaid) {
    console.log("FAIL", c.label, { norm, paid, req });
    fail++;
  } else {
    console.log("PASS", c.label, req.ok ? "paid-ok" : req.message?.slice(0, 60));
  }
}

console.log(fail === 0 ? "N8.1 UNIT OK" : "N8.1 UNIT FAIL");
process.exit(fail === 0 ? 0 : 1);
