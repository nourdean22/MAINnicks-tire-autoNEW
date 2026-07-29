/**
 * Bridge response shapes (audit-#11 gate, 2026-07-29) — zod contracts
 * for the statenour bridge's highest-value queries, mirrored from the
 * QUERY_HANDLERS implementations in server/routes/nour-os-query.ts.
 *
 * Purpose: shape drift between the handler and its statenour consumer
 * (chat cards, fleet reads) becomes a RED TEST here instead of a
 * silently-broken card there. server/__tests__/bridge-shapes.test.ts
 * pins fixtures both directions (valid parses, mutated fails).
 *
 * Scope note: schemas cover the queries with typed statenour consumers
 * today (top_decisions → TopDecisionsCard #1176; revenue_today → shop
 * pulse reads). Add a schema WHEN a query gains a typed consumer —
 * blanket-schema-ing all 20 handlers with no consumer is ceremony.
 * Runtime response validation is a deliberate follow-up (loud-warn
 * wrapper in nour-os-query), not snuck into this slice.
 */
import { z } from "zod";

export const TopDecisionsShape = z.object({
  decisions: z.array(
    z.object({
      id: z.number(),
      urgency: z.string(),
      state: z.string(),
      recommendedAction: z.string(),
      valueDollars: z.number().nullable(),
      dataQuality: z.string(),
      attempts: z.number(),
    }),
  ),
  totalLive: z.number(),
  excludedNoConsent: z.number(),
  excludedSnoozed: z.number(),
});

export const RevenueTodayShape = z.object({
  totalCents: z.number(),
  totalDollars: z.number(),
  invoiceCount: z.number(),
});

/** Query-name → shape, for a future runtime validation wrapper. */
export const BRIDGE_SHAPES = {
  top_decisions: TopDecisionsShape,
  revenue_today: RevenueTodayShape,
} as const;

export type BridgeShapeName = keyof typeof BRIDGE_SHAPES;
