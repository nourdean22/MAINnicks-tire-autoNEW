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
import { buildEvidenceGateCalibration } from "@/lib/observability/evidence-gate-calibration";
import { buildClaimDoneCalibration } from "@/lib/observability/claim-done-calibration";
import { buildInstrumentFailures } from "@/lib/observability/instrument-failures";
import { buildInstrumentHealth } from "@/lib/observability/instrument-liveness";
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
  /**
   * Which measurement instruments FAILED to write, by name.
   *
   * Sits beside the census deliberately: every zero the census reports means
   * "surfaced/invoked nothing" ONLY if the instruments were writing. When they
   * were not, the census reads a shortfall of rows as a fact about the tools.
   * #2359 lost three weeks to that reading, and review found the same shape
   * again on `action.done.shadow` in 2026-09. This is the row that tells the
   * two apart. Read-only.
   */
  instrumentFailures: operatorProcedure
    .input(z.object({ windowHours: z.number().int().min(1).max(720).default(24) }).optional())
    .query(async ({ input }) => buildInstrumentFailures(input?.windowHours ?? 24)),
  /**
   * Liveness beside failures: HEALTHY / UNDERPOWERED / STALE / NEVER_RAN /
   * FAILING per known instrument, each with its write count over the shared
   * assistant-turn denominator. The row above can only say what FAILED; this
   * one says what never wrote, what stopped, and what wrote too little to
   * support a rate. Measured 2026-09-22: `action.done.shadow` had 1 write in
   * 253 turns and zero failures — "no failures" and "unusable" at once. This
   * is the row that tells them apart. Read-only.
   */
  instrumentHealth: operatorProcedure
    .input(z.object({ windowHours: z.number().int().min(1).max(720).default(24) }).optional())
    .query(async ({ input }) => buildInstrumentHealth(input?.windowHours ?? 24)),
  /**
   * The readout AGENTS.md §4 L6 defers enforcement on: "Enforcement goes live
   * on the buffered path once the shadow false-positive rate is known."
   * Verdicts have been persisted at `tokenUsage.evidenceGate` since 2026-09-10
   * and nothing read them, so the number was only obtainable by writing a
   * one-off script. Cohorted at the last precision change and silent about the
   * rate when the sample is too thin — both rules exist because the first
   * measurement got them wrong. Read-only.
   */
  evidenceGateCalibration: operatorProcedure.query(async () => buildEvidenceGateCalibration()),
  /**
   * The strict-Done twin of the row above. `tokenUsage.claimDoneShadow` has
   * been persisted per tool turn since 2026-09-15 and nothing read it — the
   * number was obtained today by a throwaway script (132 turns, 1
   * consequential, 1 gap). Cohorted at the verifier→receipt join, rate stated
   * only over consequential turns at n ≥ MIN_SAMPLE, split by offender so a
   * verifier gap is distinguishable from a Nick gap. Also reads the new
   * `tokenUsage.toolReceipts`, so writer and reader ship together. Read-only.
   */
  claimDoneCalibration: operatorProcedure.query(async () => buildClaimDoneCalibration()),
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
