/**
 * system.* digest queries (Wire 3) — read-only surfaces over the existing
 * truth/intelligence services so they're reachable from /system, not just chat
 * commands + raw API routes. No mutation, no new logic — thin wrappers.
 */

import { z } from "zod";
import { operatorProcedure } from "../../trpc";
import { buildSystemChangeDigest } from "@/lib/services/system-change-digest";
import { buildMemoryEvalReport } from "@/lib/evals/memory-eval-report";
import { buildActionReceiptFeed } from "@/lib/services/action-receipt-feed";
import { buildTrustLadder } from "@/lib/ai/trust-ladder";
import { buildWiringCensus } from "@/lib/observability/wiring-census";
import { buildToolUsageCensus } from "@/lib/observability/tool-usage-census";
import { buildHomeDecisionMetrics } from "@/lib/observability/home-decision-metrics";
import { buildWisdomGateSpc, buildCalibrationReport } from "@/lib/brain/judgment-quality";

export const digestProcedures = {
  /** F2 · "what changed since last reconciliation" + honest deploy status. */
  changeDigest: operatorProcedure.query(async () => buildSystemChangeDigest()),
  /** Truth scoreboard — does the docs corpus teach current truth? */
  memoryEvals: operatorProcedure.query(async () => buildMemoryEvalReport()),
  /**
   * F4 · recent action receipts (what Nick/system actually did).
   * BDN-003: optional limit so the /brain continuity timeline can pull a
   * deeper window than the /system card's 20 without a second procedure.
   */
  receiptFeed: operatorProcedure
    .input(z.object({ limit: z.number().int().min(1).max(100) }).optional())
    .query(async ({ input }) => buildActionReceiptFeed({ limit: input?.limit ?? 20 })),
  /**
   * BDN-102 · trust-ladder scoreboard — the per-type operator-acceptance
   * tallies the engine already computes at fire time, rendered so the
   * NICK_CONFIDENCE_TIER flip is an evidence-read. Read-only.
   */
  trustLadder: operatorProcedure.query(async () => buildTrustLadder()),
  /**
   * BDN-101 · wiring census — lane liveness derived from the code
   * registries that actually dispatch. Read-only.
   */
  wiringCensus: operatorProcedure.query(async () => buildWiringCensus()),
  /**
   * BDN-202 · tool-usage census — never-invoked / high-failure / stale
   * over TOOL_CATALOG × tool_telemetry. Read-only; zeros are
   * pruner-confounded and the payload says so.
   */
  toolUsageCensus: operatorProcedure.query(async () => buildToolUsageCensus()),
  /** BDN-104 · did the compact-Home composition actually get used? */
  homeDecisionMetrics: operatorProcedure
    .input(z.object({ windowDays: z.number().int().min(1).max(90) }).optional())
    .query(async ({ input }) => buildHomeDecisionMetrics(input?.windowDays ?? 7)),
  /** BDN-105 · wisdom-gate process control (the gate now runs unattended). */
  wisdomGateSpc: operatorProcedure.query(async () => buildWisdomGateSpc()),
  /** BDN-106 · stated-confidence vs real outcomes. Honest n=0 until it isn't. */
  takeCalibration: operatorProcedure.query(async () => buildCalibrationReport()),
  /** Active and snoozed agenda items (witnessed commitments, standing intentions, etc.) */
  agendaItems: operatorProcedure.query(async () => {
    const { prisma } = await import("@/lib/prisma");
    return prisma.agendaItem.findMany({
      where: {
        status: { in: ["ACTIVE", "SNOOZED"] }
      },
      orderBy: { createdAt: "desc" }
    });
  }),
};
