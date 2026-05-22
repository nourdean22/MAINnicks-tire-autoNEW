/**
 * lib/services/financial-snapshot.ts · misc-pages slice (2026-05-22 ·
 * legacy-modernizer REST→tRPC).
 *
 * Shared read for the personal-finance snapshot. Pre-slice the
 * `/api/financial` GET inlined its Prisma query in the route handler;
 * this module extracts it so both the REST route AND the
 * `operator.financialSnapshot` tRPC procedure call ONE function —
 * drift structurally impossible.
 *
 * The procedure must return an explicit shallow shape (the TS2589
 * firewall · see `TaskEventRow` in lib/trpc/routers/task.ts). The
 * `FinancialSnapshot` model has no Json columns, but returning the raw
 * `prisma.financialSnapshot.findMany()` row type still leaks Prisma's
 * generated machinery into the AppRouter. `FinancialSnapshotView`
 * below is the flat row contract.
 *
 * CONTRACT NOTE · the field names below are the camelCase Prisma model
 * names (`netWorthEstimate`, …) — IDENTICAL to what the legacy
 * `/api/financial` GET returned (it returned raw Prisma rows · Prisma
 * client field names ignore `@map`). The migration preserves the REST
 * payload shape verbatim; it deliberately does NOT rename to the
 * snake_case shape the page's local `Snapshot` interface declares.
 */

import { prisma } from "@/lib/prisma";

/** Flat, explicit row shape · the tRPC procedure casts to this so the
 *  AppRouter type stays shallow. camelCase · matches the raw Prisma
 *  row the legacy REST route returned. */
export interface FinancialSnapshotView {
  date: string;
  netWorthEstimate: number | null;
  checkingBalance: number | null;
  savingsBalance: number | null;
  investmentValue: number | null;
  businessRevenue: number | null;
  ownerTakeHome: number | null;
  totalDebt: number | null;
  savingsRatePct: number | null;
  notes: string | null;
}

export interface FinancialSnapshotPayload {
  snapshots: FinancialSnapshotView[];
  latest: FinancialSnapshotView | null;
}

/**
 * Last 12 monthly financial snapshots, newest first. The legacy route
 * returned this same `{ snapshots, latest }` envelope with raw Prisma
 * rows; `latest` is `snapshots[0]`.
 */
export async function getFinancialSnapshots(): Promise<FinancialSnapshotPayload> {
  const snapshots = await prisma.financialSnapshot.findMany({
    orderBy: { date: "desc" },
    take: 12,
    select: {
      date: true,
      netWorthEstimate: true,
      checkingBalance: true,
      savingsBalance: true,
      investmentValue: true,
      businessRevenue: true,
      ownerTakeHome: true,
      totalDebt: true,
      savingsRatePct: true,
      notes: true,
    },
  });

  return { snapshots, latest: snapshots[0] ?? null };
}
