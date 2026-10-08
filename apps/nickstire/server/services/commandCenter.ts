/**
 * Operator command center — Long Haul milestone 10 (ledger:
 * operator-command-center).
 *
 * One collector that answers, in plain data, what the operator needs to see
 * before trusting the system: which policy governs and FROM WHERE (storage
 * vs code-default fallback — the fallback state is a visible warning, never
 * silent), kill switches, today's spend vs cap (estimates flagged as
 * estimates), live content reservations, the recent decision trail, and the
 * recent reel jobs with their rendered-QA verdicts.
 *
 * Every section degrades to an explicit `available: false` — the UI shows
 * "unavailable (0086 pending)" rather than a silent zero, because a zero the
 * operator believes is worse than a gap the operator can see.
 */
import { createLogger } from "../lib/logger";
import { clevelandDayStart, getActivePolicy, getEmergencyControlsFresh } from "./autonomyControl";
import type { AutonomyPolicy } from "../../client/src/lib/autonomyPolicy";

const log = createLogger("services:command-center");

export interface CommandCenterSnapshot {
  policy: {
    version: number;
    operatingMode: AutonomyPolicy["operatingMode"];
    source: "storage" | "storage_empty" | "fallback_unreachable";
    emergencyControls: AutonomyPolicy["emergencyControls"];
    limits: AutonomyPolicy["limits"];
    /** Absent on policies written before 2026-09-09; absent reads as approval_required, as dailyReelPost reads it. */
    paidBeatRegeneration: NonNullable<AutonomyPolicy["autonomousRepair"]>["paidBeatRegeneration"];
  };
  spend: {
    available: boolean;
    todayUsd: number | null;
    capUsd: number;
    isEstimate: true;
  };
  reservations: {
    available: boolean;
    rows: Array<{ id: string; format: string; platform: string; status: string; windowStart: string; topic: string | null; cta: string | null }>;
  };
  auditTail: {
    available: boolean;
    rows: Array<{ occurredAt: string; actionType: string; decision: string; reasoningCodes: string; policyVersion: number }>;
  };
  recentJobs: {
    available: boolean;
    rows: Array<{ id: number; status: string; createdAt: string; qaDecision: string | null; repairs: number }>;
  };
}

export async function collectCommandCenter(): Promise<CommandCenterSnapshot> {
  const policy = await getActivePolicy();
  const emergency = await getEmergencyControlsFresh();

  const snapshot: CommandCenterSnapshot = {
    policy: {
      version: policy.version,
      operatingMode: policy.operatingMode,
      source: emergency.source,
      emergencyControls: emergency.controls,
      limits: policy.limits,
      paidBeatRegeneration: policy.autonomousRepair?.paidBeatRegeneration ?? "approval_required",
    },
    spend: { available: false, todayUsd: null, capUsd: policy.limits.maxGenerationCostPerDayUsd, isEstimate: true },
    reservations: { available: false, rows: [] },
    auditTail: { available: false, rows: [] },
    recentJobs: { available: false, rows: [] },
  };

  try {
    const { dailySpendUsd } = await import("./generationLedger");
    const spend = await dailySpendUsd();
    if (spend !== null) snapshot.spend = { available: true, todayUsd: spend, capUsd: policy.limits.maxGenerationCostPerDayUsd, isEstimate: true };
  } catch { /* section stays unavailable */ }

  try {
    const { getDb } = await import("../db");
    const d = await getDb();
    if (d) {
      const schema = await import("../../drizzle/schema");
      const { desc, gte, and, inArray } = await import("drizzle-orm");

      if ("contentReservations" in schema) {
        try {
          const rows = await d
            .select()
            .from(schema.contentReservations)
            .where(and(gte(schema.contentReservations.windowStart, clevelandDayStart()), inArray(schema.contentReservations.status, ["reserved", "consumed"])))
            .orderBy(desc(schema.contentReservations.windowStart))
            .limit(20);
          snapshot.reservations = {
            available: true,
            rows: (Array.isArray(rows) ? rows : []).map((r) => ({
              id: r.id,
              format: r.format,
              platform: r.platform,
              status: r.status,
              windowStart: new Date(r.windowStart).toISOString(),
              topic: r.topic,
              cta: r.cta,
            })),
          };
        } catch { /* 0086 pending */ }
      }

      try {
        const rows = await d
          .select({
            occurredAt: schema.autonomyAuditEvents.occurredAt,
            actionType: schema.autonomyAuditEvents.actionType,
            decision: schema.autonomyAuditEvents.decision,
            reasoningCodes: schema.autonomyAuditEvents.reasoningCodes,
            policyVersion: schema.autonomyAuditEvents.policyVersion,
          })
          .from(schema.autonomyAuditEvents)
          .orderBy(desc(schema.autonomyAuditEvents.occurredAt))
          .limit(25);
        snapshot.auditTail = {
          available: true,
          rows: (Array.isArray(rows) ? rows : []).map((r) => ({
            occurredAt: new Date(r.occurredAt).toISOString(),
            actionType: r.actionType,
            decision: r.decision,
            reasoningCodes: r.reasoningCodes,
            policyVersion: r.policyVersion,
          })),
        };
      } catch { /* 0086 pending */ }

      try {
        const rows = await d
          .select({ id: schema.reelJobs.id, status: schema.reelJobs.status, createdAt: schema.reelJobs.createdAt, payload: schema.reelJobs.payload })
          .from(schema.reelJobs)
          .orderBy(desc(schema.reelJobs.createdAt))
          .limit(5);
        snapshot.recentJobs = {
          available: true,
          rows: (Array.isArray(rows) ? rows : []).map((r) => {
            let qaDecision: string | null = null;
            let repairs = 0;
            try {
              const p = JSON.parse(r.payload ?? "{}");
              qaDecision = p.renderedQa?.decision ?? null;
              repairs = Array.isArray(p.repairs) ? p.repairs.length : 0;
            } catch { /* unparseable payload — show status only */ }
            return { id: r.id, status: r.status, createdAt: new Date(r.createdAt).toISOString(), qaDecision, repairs };
          }),
        };
      } catch { /* jobs table always exists — this guards driver failures */ }
    }
  } catch (err) {
    log.warn("command center collection degraded", { err: err instanceof Error ? err.message.slice(0, 120) : String(err) });
  }
  return snapshot;
}
