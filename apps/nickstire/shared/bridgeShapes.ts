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

/**
 * lot_brief (camera audit N4, 2026-10-08) → StateNour's morning-brief shop slice, which renders
 * `lines` and records the rest. A failed read is `{ ok: false, error }` and must stay
 * distinguishable from a quiet day, so the two branches are a discriminated union.
 */
export const LotBriefShape = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    weekday: z.string(),
    open: z.boolean(),
    arrivals: z.number(),
    passThroughs: z.number(),
    coverage: z.object({ pctExpected: z.number().nullable(), gatePassed: z.boolean(), unmeasured: z.string().nullable() }),
    events: z.array(z.object({ kind: z.string(), text: z.string() })).max(3),
    lines: z.array(z.string()).min(1).max(3),
    generatedAt: z.string(),
    dataAsOf: z.string().nullable(),
    staleness: z.string(),
  }),
  z.object({ ok: z.literal(false), error: z.string() }),
]);

/** Query-name → shape, for a future runtime validation wrapper. */
export const BRIDGE_SHAPES = {
  top_decisions: TopDecisionsShape,
  revenue_today: RevenueTodayShape,
  lot_brief: LotBriefShape,
} as const;

export type BridgeShapeName = keyof typeof BRIDGE_SHAPES;
