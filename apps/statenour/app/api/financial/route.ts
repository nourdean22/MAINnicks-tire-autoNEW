import { prisma } from "@/lib/prisma";
import { apiHandler } from "@/lib/utils/http";
import { today } from "@/lib/utils/datetime";
import { getFinancialSnapshots } from "@/lib/services/financial-snapshot";
import { z } from "zod";

// v10.0.37 — input validation. Pre-fix req.json() flowed straight
// into Prisma upsert; bad types (string, NaN, Infinity) threw raw
// Prisma errors that leaked column names through 500 bodies.
const financialPostSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  net_worth_estimate: z.number().nullable().optional(),
  checking_balance: z.number().nullable().optional(),
  savings_balance: z.number().nullable().optional(),
  investment_value: z.number().nullable().optional(),
  business_revenue: z.number().nullable().optional(),
  owner_take_home: z.number().nullable().optional(),
  total_debt: z.number().nullable().optional(),
  savings_rate_pct: z.number().min(0).max(100).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

// v9.1.14 · GET added `auth: "owner"` — was leaking financial snapshot
// (net worth, checking, savings, business revenue, take-home, debt) to
// any unauthenticated caller. Pre-push gate is mutating-only so this
// passed the gate while exposing operator finances.
// misc-pages slice (2026-05-22) · the read now delegates to the
// shared `getFinancialSnapshots` service the `operator.financialSnapshot`
// tRPC procedure also calls · drift structurally impossible.
export const GET = apiHandler(async () => {
  return getFinancialSnapshots();
}, { auth: "owner" });

export const POST = apiHandler(async (req) => {
  const body = financialPostSchema.parse(await req.json());
  const date = body.date || today().substring(0, 7) + "-01"; // Monthly snapshots

  await prisma.financialSnapshot.upsert({
    where: { date },
    create: {
      date,
      netWorthEstimate: body.net_worth_estimate,
      checkingBalance: body.checking_balance,
      savingsBalance: body.savings_balance,
      investmentValue: body.investment_value,
      businessRevenue: body.business_revenue,
      ownerTakeHome: body.owner_take_home,
      totalDebt: body.total_debt,
      savingsRatePct: body.savings_rate_pct,
      notes: body.notes,
    },
    update: {
      netWorthEstimate: body.net_worth_estimate,
      checkingBalance: body.checking_balance,
      savingsBalance: body.savings_balance,
      investmentValue: body.investment_value,
      businessRevenue: body.business_revenue,
      ownerTakeHome: body.owner_take_home,
      totalDebt: body.total_debt,
      savingsRatePct: body.savings_rate_pct,
      notes: body.notes,
    },
  });

  return { ok: true };
}, { auth: "owner" });
