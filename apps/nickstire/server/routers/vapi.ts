/**
 * Vapi Admin Router — manage the AI receptionist from /admin.
 *
 * Endpoints:
 *  · status         — connection state + assistant count (admin badge)
 *  · createAssistant — one-time setup mutation
 *  · updateAssistant — re-push the latest prompt + tools to Vapi
 *      (preserves the dashboard-managed transferCall number · wave-141)
 *  · updateFollowUpAssistant — re-push the outbound follow-up assistant
 *  · recentCalls    — paginated call log for admin monitor panel
 *  · todayMetrics   — wave-86: derived KPIs for the Voice Receptionist dashboard
 *  · todayCalls     — wave-86: today-only call list with createdAt for the table
 *  · callDetails    — wave-86: single-call transcript + tool-call invocations
 *
 * Caching: todayMetrics / todayCalls / callDetails memo for 60s server-side
 * since admin polling is ~30s and VAPI rate-limits.
 */

import { z } from "zod";
import { router, adminProcedure, dbAdminProcedure } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { createLogger } from "../lib/logger";
import { RECOVERY_FETCH_OUTCOMES } from "@shared/callTaxonomy";
import { computeConnectRate } from "../lib/transferArtifact";
import { isTransferAttempt } from "../lib/warmTransferConnect";
import { compareTransferInstruments } from "../lib/transferInstrumentAgreement";
import { computeTransferOutcomeEvidence } from "../lib/transferOutcomeEvidence";
import {
  buildRecoveryQueue,
  breachedSla,
  type QueueSourceRow,
} from "../services/recoveryQueue";
import { getDb } from "../db";
import { shopSettings, vapiCallLogs, type VapiCallLog } from "../../drizzle/schema";
import { eq, and, gte, lte, desc, sql } from "drizzle-orm";
import { pickReceptionistAssistantId, pickFollowUpAssistantId, SHOP_LANDLINE_E164 } from "../services/vapi";
import { arrivalSignalsForQueue } from "../services/expectedArrivals";
import { BUSINESS } from "@shared/business";

/*
 * The arrival facts for the recovery kernel — an OPEN expectation and a
 * reconciled invoice — come from services/expectedArrivals.arrivalSignalsForQueue,
 * spread into buildRecoveryQueue's options at both call sites below. The
 * `arrival` lane exists so a caller who said "I will come by" is a provisional
 * SUCCESS rather than missed revenue; kernel rule 5 exists so a caller who then
 * came and PAID is closed as already-invoiced. The second fact had no producer
 * until 2026-09-22 — the kernel accepted `invoicedPhones` and nothing supplied
 * it — so paying walk-ins were being routed into recovery the moment their
 * arrival row reconciled.
 */

/** Parse a metadata JSON column without letting a malformed row throw a read. */
function safeJsonObject(v: string): Record<string, unknown> | null {
  try {
    const p = JSON.parse(v);
    return p && typeof p === "object" ? (p as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const log = createLogger("vapi");

// ─── 60s in-memory memo ──────────────────────────────────
type CacheEntry<T> = { value: T; expiresAt: number };
const cache = new Map<string, CacheEntry<unknown>>();
const CACHE_TTL_MS = 60_000;

async function memoize<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = cache.get(key) as CacheEntry<T> | undefined;
  if (hit && hit.expiresAt > now) return hit.value;
  const value = await fetcher();
  cache.set(key, { value, expiresAt: now + CACHE_TTL_MS });
  return value;
}

// ─── Direct VAPI fetcher for new procedures ─────────────
const VAPI_BASE = "https://api.vapi.ai";

async function vapiApiFetch<T>(path: string): Promise<T> {
  const key = process.env.VAPI_API_KEY;
  if (!key) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "VAPI_API_KEY not configured",
    });
  }
  const res = await fetch(`${VAPI_BASE}${path}`, {
    headers: { Authorization: `Bearer ${key}` },
  });
  if (!res.ok) {
    const body = await res.text();
    log.warn("VAPI fetch failed", { status: res.status, path, body: body.slice(0, 300) });
    throw new TRPCError({ code: "BAD_GATEWAY", message: `VAPI API ${res.status}` });
  }
  return res.json() as Promise<T>;
}

interface VapiCallSummary {
  id: string;
  type?: string;
  startedAt?: string;
  endedAt?: string;
  createdAt?: string;
  endedReason?: string;
  customer?: { number?: string; name?: string };
  cost?: number;
  summary?: string;
  analysis?: { summary?: string; structuredData?: Record<string, unknown>; successEvaluation?: string };
}

interface VapiMessage {
  role: string;
  message?: string;
  time?: number;
  endTime?: number;
  secondsFromStart?: number;
  toolCalls?: Array<{ id: string; type: string; function: { name: string; arguments: string } }>;
  toolCallId?: string;
  result?: string;
}

interface VapiCallDetail extends VapiCallSummary {
  messages?: VapiMessage[];
  transcript?: string;
  recordingUrl?: string;
}

function durationSeconds(call: VapiCallSummary): number {
  if (!call.startedAt || !call.endedAt) return 0;
  const ms = new Date(call.endedAt).getTime() - new Date(call.startedAt).getTime();
  return ms > 0 ? ms / 1000 : 0;
}

function startOfDay(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  return out;
}

/**
 * Wave BG · 2026-05-29 · historical call reads from the LOCAL
 * vapi_call_logs table (webhook-fed) instead of VAPI's live list API.
 *
 * Root cause this fixes: todayMetrics / todayCalls hit VAPI's /call
 * list API live on every range change. VAPI caps pagination and times
 * out beyond ~7 days, so the admin's "Last 30 days" button ALWAYS
 * returned "VAPI API unreachable" (confirmed live via Chrome 2026-05-29:
 * 7d=225 calls OK, 30d=unreachable). The local table is the same data
 * the eval + agentic-audit crons already depend on, never times out,
 * and history is immutable so there's zero freshness cost. Today-only
 * stays LIVE — the one window that benefits from sub-webhook-latency
 * freshness (a call from 30s ago that hasn't posted its webhook yet).
 *
 * Used as a live-first fallback when VAPI's list API times out (it caps
 * pagination ~>7 days). Live stays the primary source for accurate
 * type/endedReason; local catches the long-range timeout so the admin
 * still returns a count instead of "VAPI unreachable".
 */
async function readLocalCallRows(
  sinceISO: string,
  untilISO?: string,
): Promise<VapiCallLog[]> {
  const db = await getDb();
  const conds = [gte(vapiCallLogs.createdAt, new Date(sinceISO))];
  if (untilISO) conds.push(lte(vapiCallLogs.createdAt, new Date(untilISO)));
  return db
    .select()
    .from(vapiCallLogs)
    .where(and(...conds))
    .orderBy(desc(vapiCallLogs.createdAt))
    .limit(1000);
}

// ─── Transfer preset shape (wave-88) ───────────────────
interface TransferPreset {
  label: string;
  number: string;
  message?: string;
}

export const vapiRouter = router({
  status: adminProcedure.query(async () => {
    const { getVapiStatus } = await import("../services/vapi");
    return getVapiStatus();
  }),

  // wave-147 · one-tap dry-run of the 7/30/60-day follow-up cadence — lets the
  // operator preview EXACTLY who the flywheel would call before it dials anyone
  // for real. Runs the live tier job by name; with FOLLOWUP_CADENCE_DRY_RUN=1
  // it logs the call list and dials NOTHING. Safe to press anytime — the
  // underlying job is dry-run + FEATURE_FOLLOWUP_CADENCE-gated + daily-capped.
  // Returns { status, recordsProcessed?, details } — details carries the
  // "DRY RUN · would call N: <names>" preview.
  runFollowupCadenceNow: adminProcedure.mutation(async () => {
    const { runTierJobByName } = await import("../cron/scheduler");
    return runTierJobByName("followup-cadence");
  }),

  createAssistant: adminProcedure
    .input(z.object({ serverUrl: z.string().url().optional() }).optional())
    .mutation(async ({ input }) => {
      const { createProductionAssistant } = await import("../services/vapi");
      // Default the webhook to nickstire.org/api/webhooks/vapi if not provided
      const serverUrl = input?.serverUrl || "https://nickstire.org/api/webhooks/vapi";
      return createProductionAssistant(serverUrl);
    }),

  /**
   * Does the line callers dial answer with the assistant we push config to?
   *
   * Sits immediately above `updateAssistant` because it is the question that
   * makes that mutation meaningful: a push can be perfectly deterministic and
   * still land on an assistant nobody reaches. Read-only.
   */
  assistantRouting: adminProcedure.query(async () => {
    const { getAssistantRoutingTruth } = await import("../services/vapi");
    return getAssistantRoutingTruth();
  }),

  updateAssistant: adminProcedure
    .input(z.object({
      // Optional — defaults to the canonical INBOUND receptionist
      // (VAPI_RECEPTIONIST_ASSISTANT_ID). The panel used to pass the first
      // assistant in the list rather than the pinned one, so "Push Latest
      // Config" silently updated the wrong assistant and the receptionist
      // never got the new prompt/config.
      //
      // THE ID-TO-ROLE MAPPING THIS COMMENT USED TO ASSERT IS NO LONGER TRUE,
      // so it has been removed rather than corrected. It named afcad79e as the
      // outbound follow-up; as the panel lists them on 2026-09-18 that id is
      // one of TWO assistants called "Nick's Tire & Auto Receptionist", and the
      // follow-up is a separately-named third (0daaf7dc). Assistant ids and
      // names are operator-editable state in VAPI, so hardcoding either into a
      // comment creates a cache with no invalidation. Trust the env pin and the
      // log line, which report what actually happened on the day.
      assistantId: z.string().min(1).max(100).optional(),
      serverUrl: z.string().url().optional(),
    }))
    .mutation(async ({ input }) => {
      const { updateAssistant } = await import("../services/vapi");
      const serverUrl = input.serverUrl || "https://nickstire.org/api/webhooks/vapi";
      const assistantId = input.assistantId || process.env.VAPI_RECEPTIONIST_ASSISTANT_ID;
      if (!assistantId) {
        return { success: false as const, error: "No receptionist assistant id (VAPI_RECEPTIONIST_ASSISTANT_ID unset)" };
      }
      return updateAssistant(assistantId, serverUrl);
    }),

  // self-improving loop (phase 2) · the learned lessons that WILL be appended to
  // the receptionist prompt on the next "Push Latest Config". Read-only preview
  // so the operator sees the delta before pushing. Only lessons reinforced to
  // >=0.65 qualify (a fresh daily lesson starts at 0.6, so nothing shows until a
  // pattern has recurred).
  // 2026-10-09 · the receptionist prompt experiment, on demand. The weekly
  // cron gates itself to Mondays; this starts the SAME cycle (same lock, same
  // 30-minute budget, same cron_log row, same /proof receipt) on any day and
  // answers at once - the run takes up to 25 minutes and no request survives
  // that. Propose-only: nothing customers hear changes. The panel polls
  // promptEvolutionStatus while a run is active.
  runPromptEvolutionNow: adminProcedure.mutation(async () => {
    const { startPromptEvolutionManualRun } = await import("../services/promptEvolutionManualRun");
    return startPromptEvolutionManualRun();
  }),

  promptEvolutionStatus: dbAdminProcedure.query(async () => {
    const { promptEvolutionManualRunStatus, readLatestPromptEvolutionSummary } = await import("../services/promptEvolutionManualRun");
    const latest = await readLatestPromptEvolutionSummary();
    return { ...promptEvolutionManualRunStatus(), latest };
  }),

  promptLessons: adminProcedure.query(async () => {
    const { topPromptLessons } = await import("../services/nickMemory");
    const lessons = await topPromptLessons();
    return lessons.map((l) => ({ content: l.content, confidence: l.confidence, uses: l.uses }));
  }),

  // wave-141 · re-push the OUTBOUND follow-up assistant (separate VAPI
  // assistant · env VAPI_FOLLOWUP_ASSISTANT_ID). Previously only resyncable
  // via scripts/vapi-create-followup-assistant.ts, so prompt/tool changes to
  // the follow-up caller (e.g. wave-140's dropped transferCall + revived
  // escalate) didn't reach live until someone ran the script.
  // The admin panel calls this with no id, so the server's own pin decides
  // which assistant is pushed (same rule as updateAssistant above).
  updateFollowUpAssistant: adminProcedure
    .input(z.object({
      assistantId: z.string().min(1).max(100).optional(),
      serverUrl: z.string().url().optional(),
    }).optional())
    .mutation(async ({ input }) => {
      const { updateFollowUpAssistant, followUpAssistantIdOrNull, isRetiredAssistant } = await import("../services/vapi");
      const serverUrl = input?.serverUrl || "https://nickstire.org/api/webhooks/vapi";
      // The pin goes through the shared chokepoint, never a direct env read, so a
      // pin left on the retired duplicate receptionist cannot be overwritten with
      // the follow-up prompt. An explicit id gets the same retired check.
      const explicit = input?.assistantId?.trim();
      if (explicit && isRetiredAssistant(explicit)) {
        return { success: false as const, error: "Refused: that id is a retired assistant. Push to the dedicated follow-up caller." };
      }
      const assistantId = explicit || followUpAssistantIdOrNull();
      if (!assistantId) {
        return { success: false as const, error: "No follow-up assistant id: VAPI_FOLLOWUP_ASSISTANT_ID is unset or points at a retired assistant" };
      }
      return updateFollowUpAssistant(assistantId, serverUrl);
    }),

  recentCalls: adminProcedure
    .input(z.object({ limit: z.number().min(1).max(100).default(20) }).optional())
    .query(async ({ input }) => {
      const { getRecentCalls } = await import("../services/vapi");
      return getRecentCalls(input?.limit ?? 20);
    }),

  /** Honest Voice Receptionist ROI — MEASURED conversions × the average PAID
   *  ticket, shown as a capture-band estimate. No fabricated bookings. */
  receptionistRoi: adminProcedure
    .input(z.object({
      sinceISO: z.string().datetime().optional(),
      untilISO: z.string().datetime().optional(),
    }).optional())
    .query(async ({ input }) => {
      const { getReceptionistRoi } = await import("../services/receptionistRoi");
      return getReceptionistRoi(input ?? {});
    }),

  // ─── wave-86 additions ──────────────────────────────────

  /**
   * Today's call metrics — totals, breakdowns, durations. Returns
   * `ok: false` with zeros (not throws) when VAPI is unreachable, so
   * the dashboard renders gracefully.
   */
  todayMetrics: adminProcedure
    .input(z.object({
      sinceISO: z.string().datetime().optional(),
      untilISO: z.string().datetime().optional(),
    }).optional())
    .query(async ({ input }) => {
      const sinceISO = input?.sinceISO;
      const untilISO = input?.untilISO;
      const key = `metrics_${sinceISO || "today"}_${untilISO || "now"}`;

      return memoize(key, async () => {
        const since = sinceISO ? new Date(sinceISO) : startOfDay(new Date());
        const db = await getDb();
        if (!db) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
        }

        const conds = [gte(vapiCallLogs.createdAt, since)];
        if (untilISO) conds.push(lte(vapiCallLogs.createdAt, new Date(untilISO)));

        const rows = await db
          .select({
            id: vapiCallLogs.id,
            durationSeconds: vapiCallLogs.durationSeconds,
            endedReason: vapiCallLogs.endedReason,
            convertedToLead: vapiCallLogs.convertedToLead,
            evalScore: vapiCallLogs.evalScore,
            evalOutcome: vapiCallLogs.evalOutcome,
            createdAt: vapiCallLogs.createdAt,
            metadata: vapiCallLogs.metadata,
          })
          .from(vapiCallLogs)
          .where(and(...conds));

        const inboundRows = rows.filter((r: any) => r.evalOutcome !== "outbound");
        const outboundRows = rows.filter((r: any) => r.evalOutcome === "outbound");
        
        const EXCLUDED_OUTCOMES = new Set(["abandoned_before_connect", "spam_or_wrong_number", "tech_failure", "outbound"]);
        const validConversations = rows.filter((r: any) => r.evalOutcome && !EXCLUDED_OUTCOMES.has(r.evalOutcome));
        
        const validScores = validConversations.map((r: any) => r.evalScore).filter((s: any): s is number => s !== null);
        const avgScore = validScores.length > 0 ? Math.round(validScores.reduce((a: any, b: any) => a + b, 0) / validScores.length) : 0;

        const hardConversions = rows.filter((r: any) => r.evalOutcome === "hard_conversion").length;
        const walkInDirected = rows.filter((r: any) => r.evalOutcome === "walk_in_directed").length;
        
        const ACTIONABLE_OUTCOMES = new Set([
          "hard_conversion",
          "walk_in_directed",
          "callback_needed",
          "tire_availability_intent",
          "quote_or_inspection_intent",
          "human_handoff"
        ]);
        const actionableOutcomes = rows.filter((r: any) => r.evalOutcome && ACTIONABLE_OUTCOMES.has(r.evalOutcome)).length;

        const total = rows.length;
        const legacyConversionRate = total > 0 ? (hardConversions / total) * 100 : 0;
        const revisedHardConversionRate = validConversations.length > 0 ? (hardConversions / validConversations.length) * 100 : 0;
        const actionableRate = validConversations.length > 0 ? (actionableOutcomes / validConversations.length) * 100 : 0;

        const durations = rows.map((r: any) => r.durationSeconds).filter((d: any) => d > 0);
        const totalSeconds = durations.reduce((s: any, d: any) => s + d, 0);
        const avgSeconds = durations.length > 0 ? totalSeconds / durations.length : 0;

        const endReasons: Record<string, number> = {};
        for (const r of rows) {
          const k = r.endedReason || "unknown";
          endReasons[k] = (endReasons[k] || 0) + 1;
        }

        const getClevelandSunday = (date: Date): string => {
          const localDate = new Date(date.toLocaleString("en-US", { timeZone: "America/New_York" }));
          const day = localDate.getDay();
          const diff = localDate.getDate() - day;
          const sunday = new Date(localDate.setDate(diff));
          return `${sunday.getFullYear()}-${String(sunday.getMonth() + 1).padStart(2, '0')}-${String(sunday.getDate()).padStart(2, '0')}`;
        };

        // Compute weekly trend
        const trend: Record<string, { total: number; valid: number; conversions: number }> = {};
        for (const r of rows) {
          if (r.evalOutcome === "outbound") continue;
          const weekKey = getClevelandSunday(r.createdAt);
          if (!trend[weekKey]) {
            trend[weekKey] = { total: 0, valid: 0, conversions: 0 };
          }
          trend[weekKey].total++;
          if (r.evalOutcome && !EXCLUDED_OUTCOMES.has(r.evalOutcome)) {
            trend[weekKey].valid++;
          }
          if (r.evalOutcome === "hard_conversion") {
            trend[weekKey].conversions++;
          }
        }
        const weeklyTrend = Object.entries(trend).map(([week, stats]) => ({
          week,
          ...stats,
        })).sort((a, b) => a.week.localeCompare(b.week));

        // Compute outcome breakdown
        const outcomeBreakdown: Record<string, number> = {};
        for (const r of rows) {
          if (r.evalOutcome === "outbound") continue;
          const outcome = r.evalOutcome || "unevaluated";
          outcomeBreakdown[outcome] = (outcomeBreakdown[outcome] || 0) + 1;
        }

        // Compute intent distribution
        const distribution: Record<string, number> = {};
        for (const r of rows) {
          if (r.evalOutcome === "outbound") continue;
          const metadata = typeof r.metadata === "string" ? JSON.parse(r.metadata) : r.metadata;
          const intents: string[] = metadata?.intents || [];
          for (const intent of intents) {
            distribution[intent] = (distribution[intent] || 0) + 1;
          }
        }
        const intentDistribution = Object.entries(distribution).map(([intent, count]) => ({
          intent,
          count,
        })).sort((a, b) => b.count - a.count);

        // Transfer-outcome EVIDENCE (14d, READ-ONLY). Replaces the duration-
        // floor "connect rate", whose premise was refuted 2026-08-05: on the
        // blind transfer this assistant uses, the VAPI leg ends at the hand-off,
        // so total duration never contained the human leg. What IS observable:
        // a same-phone redial shortly after a forward = the forward did not
        // resolve. See lib/transferOutcomeEvidence.ts for the honest split
        // (redialed / quiet / tooRecent / failedTransfers).
        // Dedicated 14d window — a rate needs >=10 classifiable forwards.
        let transferEvidence: import("../lib/transferOutcomeEvidence").TransferOutcomeEvidence = {
          windowMinutes: 15, attempted: 0, failedTransfers: 0, forwards: 0,
          classifiable: 0, tooRecent: 0, redialed: 0, quiet: 0, redialRate: null, reliable: false,
        };
        try {
          const { computeTransferOutcomeEvidence } = await import("../lib/transferOutcomeEvidence");
          const connectCutoff = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
          const transferRows = await db
            .select({
              endedReason: vapiCallLogs.endedReason,
              phoneNumber: vapiCallLogs.phoneNumber,
              createdAt: vapiCallLogs.createdAt,
            })
            .from(vapiCallLogs)
            .where(gte(vapiCallLogs.createdAt, connectCutoff));
          transferEvidence = computeTransferOutcomeEvidence(transferRows);
        } catch {
          /* read-only metric · default zeros on failure, never break the tile */
        }

        return {
          ok: true as const,
          total: rows.length,
          inbound: inboundRows.length,
          outbound: outboundRows.length,
          web: 0,
          forwarded: endReasons["assistant-forwarded-call"] || 0,
          customerEnded: endReasons["customer-ended-call"] || 0,
          assistantEnded: endReasons["assistant-ended-call"] || 0,
          totalSeconds: Math.round(totalSeconds),
          avgSeconds: Math.round(avgSeconds),
          endReasons,
          // New metrics
          validConversationsCount: validConversations.length,
          hardConversionsCount: hardConversions,
          walkInDirectedCount: walkInDirected,
          actionableOutcomesCount: actionableOutcomes,
          legacyConversionRate: Math.round(legacyConversionRate),
          revisedHardConversionRate: Math.round(revisedHardConversionRate),
          actionableRate: Math.round(actionableRate),
          avgScore,
          transferEvidence,
          weeklyTrend,
          outcomeBreakdown,
          intentDistribution,
        };
      });
    }),

  todayCalls: adminProcedure
    .input(z.object({
      sinceISO: z.string().datetime().optional(),
      untilISO: z.string().datetime().optional(),
    }).optional())
    .query(async ({ input }) => {
      const sinceISO = input?.sinceISO;
      const untilISO = input?.untilISO;
      const key = `calls_${sinceISO || "today"}_${untilISO || "now"}`;

      return memoize(key, async () => {
        const since = sinceISO ? new Date(sinceISO) : startOfDay(new Date());
        const db = await getDb();
        if (!db) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
        }

        const conds = [gte(vapiCallLogs.createdAt, since)];
        if (untilISO) conds.push(lte(vapiCallLogs.createdAt, new Date(untilISO)));

        const rows = await db
          .select({
            id: vapiCallLogs.vapiCallId,
            createdAt: vapiCallLogs.createdAt,
            durationSeconds: vapiCallLogs.durationSeconds,
            endedReason: vapiCallLogs.endedReason,
            customerNumber: vapiCallLogs.phoneNumber,
            customerName: vapiCallLogs.customerName,
            summary: vapiCallLogs.aiSummary,
            successEvaluation: vapiCallLogs.evalOutcome,
            evalScore: vapiCallLogs.evalScore,
            evalOutcome: vapiCallLogs.evalOutcome,
            evalReasoning: vapiCallLogs.evalReasoning,
            metadata: vapiCallLogs.metadata,
          })
          .from(vapiCallLogs)
          .where(and(...conds, sql`${vapiCallLogs.evalOutcome} != 'outbound' OR ${vapiCallLogs.evalOutcome} IS NULL`))
          .orderBy(desc(vapiCallLogs.createdAt))
          .limit(200);

        return rows.map((r: any) => ({
          id: r.id,
          type: "inboundPhoneCall",
          createdAt: r.createdAt ? new Date(r.createdAt).toISOString() : null,
          startedAt: null as string | null,
          endedAt: null as string | null,
          durationSeconds: r.durationSeconds,
          endedReason: r.endedReason || "unknown",
          customerNumber: r.customerNumber,
          customerName: r.customerName,
          cost: null as number | null,
          summary: r.summary,
          successEvaluation: r.successEvaluation,
          evalScore: r.evalScore,
          evalOutcome: r.evalOutcome,
          evalReasoning: r.evalReasoning,
          metadata: typeof r.metadata === "string" ? JSON.parse(r.metadata) : r.metadata,
        }));
      });
    }),

  getMissedRevenueQueue: adminProcedure
    .input(z.object({
      status: z.enum(["pending", "reviewed", "converted", "came_in", "ignored", "all"]).default("pending"),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
      /**
       * DERIVED, never re-typed. This list was one of ten hand-maintained
       * copies (audit 2026-09-18) and the read side had drifted from the write
       * side. It is now computed from the taxonomy kernel: an outcome is
       * fetched if the kernel can EVER route it to recovery. The kernel then
       * makes the real per-call decision using facts a SQL WHERE cannot see
       * (did the caller actually speak, is an arrival already open, did an
       * invoice already land). Widening the kernel widens this automatically.
       */
      const candidates = RECOVERY_FETCH_OUTCOMES;

      const rows = await db
        .select({
          id: vapiCallLogs.id,
          vapiCallId: vapiCallLogs.vapiCallId,
          phoneNumber: vapiCallLogs.phoneNumber,
          customerName: vapiCallLogs.customerName,
          durationSeconds: vapiCallLogs.durationSeconds,
          endedReason: vapiCallLogs.endedReason,
          aiSummary: vapiCallLogs.aiSummary,
          evalScore: vapiCallLogs.evalScore,
          evalOutcome: vapiCallLogs.evalOutcome,
          createdAt: vapiCallLogs.createdAt,
          metadata: vapiCallLogs.metadata,
        })
        .from(vapiCallLogs)
        .where(and(
          gte(vapiCallLogs.createdAt, cutoff),
          sql`${vapiCallLogs.evalOutcome} IN (${sql.raw(candidates.map(c => `'${c}'`).join(','))})`
        ))
        .orderBy(desc(vapiCallLogs.createdAt));

      /**
       * ONE CUSTOMER WITH ONE NEED IS ONE ROW.
       *
       * This used to emit one row per CALL and add "+3" to any number seen
       * twice in the ninety-day window. Both were wrong in the same direction:
       * a caller whose transfer failed and who redialled twice became three
       * obligations AND a "Repeat Caller" badge, so repetition inflated the
       * backlog it was describing — while brakes in June and tires in
       * September scored as urgency. `buildRecoveryQueue` collapses contacts
       * into episodes and lets the kernel decide the lane; repetition now
       * raises PRIORITY inside one episode instead of adding rows.
       */
      const built = buildRecoveryQueue(rows as QueueSourceRow[], new Date(), {
        ...(await arrivalSignalsForQueue(cutoff)),
      });

      /**
       * Legacy-compatible projection. The admin UI reads these field names, so
       * the shape is preserved while the MEANING is repaired underneath. New
       * consumers should read `disposition` (lane, SLA, explainable reasons)
       * and `contactCount` rather than the flattened `priorityScore`.
       */
      const queueItems = built.episodes.map((e) => ({
        id: e.latestCallId,
        vapiCallId: e.vapiCallId,
        phoneNumber: e.phoneNumber,
        customerName: e.customerName,
        durationSeconds: null as number | null,
        endedReason: null as string | null,
        aiSummary: e.aiSummary,
        evalScore: null as number | null,
        evalOutcome: e.outcome,
        createdAt: e.latestCallAt,
        intents: e.intents,
        queueStatus: e.queueStatus,
        queueUrgency: e.disposition.priority,
        priorityScore: e.disposition.priority,
        /** Retained for the badge, but it now means "same unresolved need". */
        isRepeatCaller: e.contactCount > 1,
        notes: "",
        // ── new, honest fields ──
        episodeKey: e.episodeKey,
        contactCount: e.contactCount,
        callIds: e.callIds,
        firstCallAt: e.firstCallAt,
        ageMinutes: e.ageMinutes,
        intentFamily: e.intentFamily,
        lane: e.disposition.lane,
        slaMinutes: e.disposition.slaMinutes,
        slaBreached:
          e.disposition.slaMinutes !== null && e.ageMinutes > e.disposition.slaMinutes,
        /** Why this is here, and why it ranks where it does. */
        priorityReasons: e.disposition.reasons,
        /** Buying specifics, for the fact-bound SMS draft. Fields may be null. */
        demand: e.demand,
        transferFailed: e.transferFailed,
      }));

      return input.status === "all"
        ? queueItems
        : queueItems.filter((item) => item.queueStatus === input.status);
    }),

  /**
   * The denominators the wall never showed.
   *
   * "1,118 pending" was reported as missed revenue while being, in large part,
   * a census of calls that were ANSWERED. This returns the same population
   * decomposed by lane and by exclusion reason, so the operator can see where
   * the other rows went instead of being asked to trust that they were junk.
   * Counts are EPISODES, except `sourceCallCount`, which is raw calls — the
   * number the old UI printed as leads.
   */
  getRecoveryQueueSummary: adminProcedure
    .input(z.object({ days: z.number().int().min(1).max(90).default(90) }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const cutoff = new Date(Date.now() - input.days * 24 * 60 * 60 * 1000);
      const rows = await db
        .select({
          id: vapiCallLogs.id,
          vapiCallId: vapiCallLogs.vapiCallId,
          phoneNumber: vapiCallLogs.phoneNumber,
          customerName: vapiCallLogs.customerName,
          durationSeconds: vapiCallLogs.durationSeconds,
          endedReason: vapiCallLogs.endedReason,
          aiSummary: vapiCallLogs.aiSummary,
          evalScore: vapiCallLogs.evalScore,
          evalOutcome: vapiCallLogs.evalOutcome,
          createdAt: vapiCallLogs.createdAt,
          metadata: vapiCallLogs.metadata,
        })
        .from(vapiCallLogs)
        .where(gte(vapiCallLogs.createdAt, cutoff));

      const built = buildRecoveryQueue(rows as QueueSourceRow[], new Date(), {
        ...(await arrivalSignalsForQueue(cutoff)),
      });
      return {
        windowDays: input.days,
        sourceCallCount: built.sourceCallCount,
        needsAttention: built.episodes.length,
        slaBreached: breachedSla(built).length,
        laneCounts: built.laneCounts,
        exclusionCounts: built.exclusionCounts,
        /**
         * UNKNOWN, not zero. Calls whose speaker attribution failed — mostly
         * rows written before `customerSpeech` existed (2026-07-26). This must
         * be shown as "not measured", never folded into "no demand".
         */
        unclassified: built.unclassifiedCount,
        /**
         * THE QUESTION BOTH AUDITS COULD NOT ANSWER: do transfers connect?
         *
         * Derived from `artifact.transfers[].status` — the provider's own
         * per-attempt outcome — and NEVER from `assistant-forwarded-call`,
         * which VAPI documents as meaning the transfer was INITIATED. A call
         * that rang an empty counter carries that reason too.
         *
         * `coveragePct` travels with the rate on purpose. VAPI gates
         * blind-transfer outcome detection per organisation, so if this account
         * does not receive the artifact, coverage is 0 and `connectRate` stays
         * null rather than reporting a confident number over a handful of
         * calls. Read coverage FIRST; the rate is meaningless without it.
         */
        transferConnect: computeConnectRate({
          // EVERY call that ATTEMPTED a transfer, including the ones the
          // provider never resolved. Filtering unknowns out here would delete
          // the coverage signal and hand back a confident rate over whatever
          // happened to be classifiable — the precise failure being replaced.
          verdicts: (rows as QueueSourceRow[])
            .filter((r) => isTransferAttempt(r.endedReason))
            .map((r) => {
              const parsed =
                typeof r.metadata === "string" ? safeJsonObject(r.metadata) : r.metadata;
              const v = (parsed as { transferArtifact?: { verdict?: unknown } } | null)
                ?.transferArtifact?.verdict;
              return v === "connected" || v === "not_connected" ? v : ("unknown" as const);
            }),
        }),
        /**
         * DO THE TWO INSTRUMENTS AGREE?
         *
         * The provider verdict (above) and the caller's redial behaviour were
         * deliberately kept as separate instruments, on the stated grounds that
         * "if they disagree, that disagreement is the finding". That was right
         * and incomplete: they were computed in two DIFFERENT procedures, so
         * nothing could ever compare them, and reconciling them was filed under
         * a 30-day bucket — which is how a finding becomes a calendar entry.
         *
         * Both are derived from the SAME `rows` already in hand: the select
         * carries phoneNumber, endedReason and createdAt, which is everything
         * the behaviour instrument needs. No second query.
         *
         * The comparison never averages them. It reports what each says and
         * whether they point the same way — and when they contradict, what that
         * implies about WHERE the problem is. A provider-connected transfer
         * whose caller immediately redials is a counter problem, and every
         * telephony fix on the roadmap would be spent on the wrong half.
         */
        transferAgreement: compareTransferInstruments(
          computeConnectRate({
            verdicts: (rows as QueueSourceRow[])
              .filter((r) => isTransferAttempt(r.endedReason))
              .map((r) => {
                const parsed =
                  typeof r.metadata === "string" ? safeJsonObject(r.metadata) : r.metadata;
                const v = (parsed as { transferArtifact?: { verdict?: unknown } } | null)
                  ?.transferArtifact?.verdict;
                return v === "connected" || v === "not_connected" ? v : ("unknown" as const);
              }),
          }),
          computeTransferOutcomeEvidence(
            (rows as QueueSourceRow[]).map((r) => ({
              phoneNumber: r.phoneNumber ?? null,
              createdAt: r.createdAt,
              endedReason: r.endedReason ?? null,
            })),
          ),
        ),
      };
    }),

  updateQueueStatus: adminProcedure
    .input(z.object({
      id: z.number(),
      status: z.enum(["pending", "reviewed", "converted", "came_in", "ignored"]),
      notes: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const [row] = await db
        .select({ metadata: vapiCallLogs.metadata })
        .from(vapiCallLogs)
        .where(eq(vapiCallLogs.id, input.id))
        .limit(1);

      if (!row) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Call log not found" });
      }

      const existingMetadata = typeof row.metadata === "string"
        ? JSON.parse(row.metadata)
        : (row.metadata || {});

      const updatedMetadata = {
        ...existingMetadata,
        queueStatus: input.status,
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
        queueUpdatedAt: new Date().toISOString(),
      };

      await db
        .update(vapiCallLogs)
        .set({
          metadata: updatedMetadata,
        })
        .where(eq(vapiCallLogs.id, input.id));

      return { success: true };
    }),

  /**
   * Read current transferCall destination from VAPI assistant.
   * Operator wants to see "where calls go right now" without logging
   * into the VAPI dashboard. Uses live API (uncached) — the operator
   * just changed something elsewhere is the worst case for stale.
   */
  getTransferDestination: adminProcedure.query(async () => {
    try {
      // wave-113b — was `assistants[0]` blindly. VAPI returns multiple
      // assistants (Receptionist for inbound calls + Follow-Up Caller for
      // outbound). Picking [0] surfaced the WRONG one in the admin card,
      // and the operator's edits silently went to the outbound assistant
      // while the actual inbound receptionist kept stale numbers. Now uses
      // pickReceptionistAssistantId to deterministically pick the inbound.
      const assistants = await vapiApiFetch<Array<{ id: string; name?: string }>>(
        "/assistant?limit=10",
      );
      if (!assistants.length) {
        return { ok: false as const, error: "No VAPI assistant configured" };
      }
      const picked = pickReceptionistAssistantId(assistants);
      if (!picked) {
        return { ok: false as const, error: "Could not identify receptionist assistant" };
      }
      const assistantId = picked.id;
      const assistant = await vapiApiFetch<{
        id: string;
        name?: string;
        model?: { tools?: Array<{ type: string; destinations?: Array<{ type: string; number: string; message?: string; description?: string }> }> };
      }>(`/assistant/${assistantId}`);
      const tools = assistant.model?.tools || [];
      const transfer = tools.find((t) => t.type === "transferCall");
      // wave-116 — was destinations[0] blindly. VAPI's destinations array
      // can include non-number types (sip, etc.); same class as the
      // wave-113b assistants[0] bug. Find the number-type destination
      // explicitly. Falls back to [0] only when no number-type exists.
      const dest = transfer?.destinations?.find((d) => d.type === "number") ?? transfer?.destinations?.[0];
      return {
        ok: true as const,
        assistantId,
        assistantName: assistant.name || null,
        currentNumber: dest?.number || null,
        currentMessage: dest?.message || null,
        // wave-113b — surface which assistant was picked + why so the
        // operator can see in the UI that the right one is being edited
        pickedReason: picked.reason,
      };
    } catch (err) {
      log.warn("getTransferDestination failed", { error: err instanceof Error ? err.message : String(err) });
      return {
        ok: false as const,
        error: err instanceof TRPCError ? err.message : "VAPI API unreachable",
      };
    }
  }),

  /**
   * wave-114 — companion to getTransferDestination that returns the
   * Follow-Up Caller (outbound) assistant's transferCall destination.
   * Returns ok:false with reason="no-followup" if there is no follow-up
   * assistant in the org (admin then doesn't render the sub-card).
   */
  getFollowUpTransferDestination: adminProcedure.query(async () => {
    try {
      const assistants = await vapiApiFetch<Array<{ id: string; name?: string }>>(
        "/assistant?limit=10",
      );
      if (!assistants.length) {
        return { ok: false as const, reason: "no-assistants" as const };
      }
      const picked = pickFollowUpAssistantId(assistants);
      if (!picked) {
        // Org has only a receptionist — no follow-up to manage. Not an error.
        return { ok: false as const, reason: "no-followup" as const };
      }
      const assistant = await vapiApiFetch<{
        id: string;
        name?: string;
        model?: { tools?: Array<{ type: string; destinations?: Array<{ type: string; number: string; message?: string }> }> };
      }>(`/assistant/${picked.id}`);
      const tools = assistant.model?.tools || [];
      const transfer = tools.find((t) => t.type === "transferCall");
      // wave-116 — pick the number-type destination explicitly (see
      // getTransferDestination above for full rationale).
      const dest = transfer?.destinations?.find((d) => d.type === "number") ?? transfer?.destinations?.[0];
      return {
        ok: true as const,
        assistantId: picked.id,
        assistantName: assistant.name || null,
        currentNumber: dest?.number || null,
        currentMessage: dest?.message || null,
        // True iff currently set to the canonical shop landline.
        isShopLandline: dest?.number === SHOP_LANDLINE_E164,
        shopLandline: SHOP_LANDLINE_E164,
      };
    } catch (err) {
      log.warn("getFollowUpTransferDestination failed", { error: err instanceof Error ? err.message : String(err) });
      return {
        ok: false as const,
        reason: "error" as const,
        error: err instanceof TRPCError ? err.message : "VAPI API unreachable",
      };
    }
  }),

  /**
   * Update the transferCall destination number on the live VAPI
   * assistant. Surgical PATCH — fetches the full assistant, mutates
   * only the transferCall tool's destination[0].number, and PATCHes
   * back the modified `model` object. All other tools + prompt remain
   * untouched.
   */
  setTransferDestination: adminProcedure
    .input(z.object({
      phoneNumber: z.string()
        .regex(/^\+1\d{10}$/, "Phone must be E.164 format starting with +1 (e.g. +12168620005)")
        .max(20),
      message: z.string().max(200).optional(),
      // wave-114 — admin can now target either assistant. Default
      // "receptionist" preserves prior behavior (the manager-on-duty flow).
      // "followUp" targets the outbound caller and triggers a confirmation
      // prompt client-side because that destination should always stay
      // the shop landline.
      target: z.enum(["receptionist", "followUp"]).optional().default("receptionist"),
      // wave-114 — explicit acknowledgement that the operator has read the
      // confirmation prompt when changing the follow-up destination away
      // from the shop landline. Required when target=followUp AND the new
      // number is not the shop landline.
      acknowledgeNonShopFollowUp: z.boolean().optional(),
    }))
    .mutation(async ({ input }) => {
      // wave-113b/114 — pick the right assistant for the requested target.
      const assistants = await vapiApiFetch<Array<{ id: string; name?: string }>>("/assistant?limit=10");
      if (!assistants.length) {
        throw new TRPCError({ code: "NOT_FOUND", message: "No VAPI assistant" });
      }
      const picked = input.target === "followUp"
        ? pickFollowUpAssistantId(assistants)
        : pickReceptionistAssistantId(assistants);
      if (!picked) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: input.target === "followUp"
            ? "Could not identify follow-up caller assistant (none in this VAPI org)"
            : "Could not identify receptionist assistant",
        });
      }
      // wave-114 — server-side gate: changing the follow-up destination
      // away from the shop landline requires an explicit acknowledge flag.
      // Belt-and-suspenders: even if the client-side confirm dialog is
      // bypassed, the server still refuses without the flag.
      if (
        input.target === "followUp"
        && input.phoneNumber !== SHOP_LANDLINE_E164
        && !input.acknowledgeNonShopFollowUp
      ) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `Follow-Up Caller destination should stay set to the shop landline (+1 ${BUSINESS.phone.raw.slice(0, 3)} ${BUSINESS.phone.raw.slice(3, 6)} ${BUSINESS.phone.raw.slice(6)}). To override, confirm via the admin and pass acknowledgeNonShopFollowUp=true.`,
        });
      }
      const assistantId = picked.id;

      // Fetch full assistant config
      const assistant = await vapiApiFetch<{
        model?: { tools?: Array<Record<string, unknown>>; [k: string]: unknown };
      }>(`/assistant/${assistantId}`);

      const tools = (assistant.model?.tools || []).slice();
      const idx = tools.findIndex((t) => t.type === "transferCall");
      if (idx < 0) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Assistant has no transferCall tool — re-run vapi-update-assistant.ts to add it",
        });
      }
      const existingDestinations = (tools[idx].destinations as Array<Record<string, unknown>>) || [];
      // wave-116 — was destinations[0] blindly (same class as the fixed
      // assistants[0] bug). Find the existing number-type destination
      // index so we replace IT, not whatever happens to be at index 0.
      // If no number-type exists, prepend a new one and keep the rest.
      const numberIdx = existingDestinations.findIndex((d) => d.type === "number");
      const targetExisting = numberIdx >= 0 ? existingDestinations[numberIdx] : {};
      const existingPlan = (targetExisting.transferPlan as Record<string, unknown> | undefined) || {};
      const updatedDest = {
        ...targetExisting,
        type: "number",
        number: input.phoneNumber,
        message: input.message || (targetExisting as { message?: string }).message || "Transferring you now.",
        transferPlan: {
          mode: "warm-transfer-say-message",
          message: "You've got a customer holding on the Nick's Tire and Auto line. Connecting you now.",
          ...existingPlan,
          sipVerb: "dial",
        },
      };
      const newDestinations = numberIdx >= 0
        ? existingDestinations.map((d, i) => (i === numberIdx ? updatedDest : d))
        : [updatedDest, ...existingDestinations];
      tools[idx] = { ...tools[idx], destinations: newDestinations };

      // Surgical PATCH — only change the model.tools array; preserve everything else
      const patchBody = {
        model: { ...(assistant.model || {}), tools },
      };

      const apiKey = process.env.VAPI_API_KEY!;
      const patchRes = await fetch(`${VAPI_BASE}/assistant/${assistantId}`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(patchBody),
      });
      if (!patchRes.ok) {
        const body = await patchRes.text();
        log.error("VAPI PATCH failed", { status: patchRes.status, body: body.slice(0, 400) });
        throw new TRPCError({
          code: "BAD_GATEWAY",
          message: `VAPI PATCH ${patchRes.status}`,
        });
      }
      // Invalidate the readonly cache (none currently set for this key, but
      // be explicit so future caching doesn't go stale)
      cache.delete(`transferDest_${assistantId}`);
      // Wave-105: bust the on-duty manager phone cache so booking/lead
      // alerts immediately route to the new manager number. Only relevant
      // when target=receptionist; the follow-up assistant doesn't feed
      // manager-on-duty alerts so cache-bust there is a no-op (still safe).
      if (input.target !== "followUp") {
        try {
          const { invalidateOnDutyManagerCache } = await import("../services/vapi");
          invalidateOnDutyManagerCache();
        } catch (e) {
          log.warn("[setTransferDestination] cache bust failed:", e);
        }
      }
      log.info("VAPI transfer destination updated", {
        assistantId,
        target: input.target,
        newNumber: input.phoneNumber,
      });
      return {
        ok: true as const,
        assistantId,
        target: input.target,
        newNumber: input.phoneNumber,
      };
    }),

  // ─── Per-shift transfer presets (wave-88) ──────────────
  // Persisted in shop_settings under key="vapi_transfer_presets" as a
  // JSON array. Operator's "Manager A cell / Manager B cell / Owner
  // cell" library — save once, one-click swap based on shift.

  /**
   * List saved transfer-destination presets.
   */
  listTransferPresets: adminProcedure.query(async () => {
    const db = await getDb();
    if (!db) return [] as TransferPreset[];
    const [row] = await db
      .select()
      .from(shopSettings)
      .where(eq(shopSettings.key, "vapi_transfer_presets"))
      .limit(1);
    if (!row?.value) return [] as TransferPreset[];
    try {
      const parsed = JSON.parse(row.value) as unknown;
      if (!Array.isArray(parsed)) return [] as TransferPreset[];
      return parsed
        .filter((p): p is TransferPreset =>
          typeof p === "object" && p !== null &&
          typeof (p as Record<string, unknown>).label === "string" &&
          typeof (p as Record<string, unknown>).number === "string",
        );
    } catch {
      return [] as TransferPreset[];
    }
  }),

  /**
   * Save a preset (upsert by label). Labels are unique — saving with
   * an existing label updates that preset.
   */
  saveTransferPreset: adminProcedure
    .input(z.object({
      label: z.string().min(1).max(40),
      number: z.string().regex(/^\+1\d{10}$/, "E.164 +1 + 10 digits"),
      message: z.string().max(200).optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const [row] = await db.select().from(shopSettings).where(eq(shopSettings.key, "vapi_transfer_presets")).limit(1);
      const current: TransferPreset[] = row?.value
        ? (JSON.parse(row.value) as TransferPreset[]).filter((p) => typeof p === "object")
        : [];
      const trimmedLabel = input.label.trim();
      const idx = current.findIndex((p) => p.label === trimmedLabel);
      const next: TransferPreset = {
        label: trimmedLabel,
        number: input.number,
        ...(input.message ? { message: input.message } : {}),
      };
      if (idx >= 0) current[idx] = next;
      else current.push(next);

      // Cap at 12 presets — beyond that, the chip wall is unreadable
      const capped = current.slice(0, 12);
      const json = JSON.stringify(capped);

      if (row) {
        await db.update(shopSettings)
          .set({ value: json, updatedBy: "admin" })
          .where(eq(shopSettings.id, row.id));
      } else {
        await db.insert(shopSettings).values({
          key: "vapi_transfer_presets",
          value: json,
          label: "VAPI transfer destination presets",
          category: "general",
          updatedBy: "admin",
        });
      }
      return { ok: true as const, presets: capped };
    }),

  /**
   * Delete a preset by label.
   */
  deleteTransferPreset: adminProcedure
    .input(z.object({ label: z.string().min(1).max(40) }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const [row] = await db.select().from(shopSettings).where(eq(shopSettings.key, "vapi_transfer_presets")).limit(1);
      if (!row?.value) return { ok: true as const, presets: [] };
      try {
        const current = (JSON.parse(row.value) as TransferPreset[]).filter((p) => typeof p === "object");
        const next = current.filter((p) => p.label !== input.label.trim());
        await db.update(shopSettings)
          .set({ value: JSON.stringify(next), updatedBy: "admin" })
          .where(eq(shopSettings.id, row.id));
        return { ok: true as const, presets: next };
      } catch {
        return { ok: false as const, error: "Failed to parse current presets" };
      }
    }),

  /**
   * Single-call detail with messages + transcript + tool-call invocations.
   * For the call drawer.
   */
  callDetails: adminProcedure
    .input(z.object({ callId: z.string().min(8).max(64) }))
    .query(async ({ input }) => {
      return memoize(`call_${input.callId}`, async () => {
        const call = await vapiApiFetch<VapiCallDetail>(`/call/${input.callId}`);
        const toolCalls: Array<{ name: string; args: string; time?: number }> = [];
        if (call.messages) {
          for (const m of call.messages) {
            if (m.toolCalls) {
              for (const tc of m.toolCalls) {
                toolCalls.push({
                  name: tc.function.name,
                  args: tc.function.arguments,
                  time: m.secondsFromStart,
                });
              }
            }
          }
        }
        return {
          id: call.id,
          type: call.type ?? null,
          createdAt: call.createdAt || null,
          startedAt: call.startedAt || null,
          endedAt: call.endedAt || null,
          durationSeconds: Math.round(durationSeconds(call)),
          endedReason: call.endedReason || "unknown",
          customerNumber: call.customer?.number || null,
          customerName: call.customer?.name || null,
          cost: call.cost ?? null,
          summary: call.summary || call.analysis?.summary || null,
          successEvaluation: call.analysis?.successEvaluation || null,
          transcript: call.transcript || null,
          recordingUrl: call.recordingUrl || null,
          messages: (call.messages || []).map((m) => ({
            role: m.role,
            message: m.message || null,
            secondsFromStart: m.secondsFromStart ?? null,
          })),
          toolCalls,
        };
      });
    }),

  /**
   * Wave-102 — operator-triggered OUTBOUND follow-up call.
   *
   * Fires the follow-up assistant ("Nick's Tire Follow-Up Caller") at
   * a recent-service customer. Goal: trust + referral capture.
   *
   * Customer's first name + last service description get injected as
   * variables into the prompt and firstMessage.
   *
   * Caller ID = the VAPI line +1 216 424 9249 (NOT the shop main).
   * Call cap: 3 minutes hard.
   *
   * Returns the call ID for tracking. Doesn't wait for the call to
   * complete — fire-and-forget. Operator sees outcome in /admin →
   * Voice Receptionist call list.
   */
  makeFollowUpCall: adminProcedure
    .input(z.object({
      customerName: z.string().min(1).max(80),
      phone: z.string()
        .regex(/^\+?1?\d{10,11}$/, "Phone must be 10-11 digits")
        .max(20),
      lastService: z.string().max(120).default("recent visit"),
    }))
    .mutation(async ({ input }) => {
      const apiKey = process.env.VAPI_API_KEY;
      // Shared chokepoint, not a direct env read — a pin naming a RETIRED
      // assistant resolves to null here rather than being handed to VAPI.
      const { followUpAssistantIdOrNull } = await import("../services/vapi");
      const assistantId = followUpAssistantIdOrNull();
      if (!apiKey) {
        return { success: false, error: "VAPI_API_KEY not configured" };
      }
      if (!assistantId) {
        return { success: false, error: "VAPI_FOLLOWUP_ASSISTANT_ID is not configured, or points at a retired assistant. Repoint it at the dedicated follow-up caller." };
      }

      // Normalize phone to E.164
      const digits = input.phone.replace(/\D/g, "");
      const e164 = digits.length === 10 ? `+1${digits}` : digits.length === 11 ? `+${digits}` : null;
      if (!e164) {
        return { success: false, error: "Invalid phone number — need 10 or 11 digits" };
      }

      // ⚠ ORDER MATTERS, and a test caught it: this check was originally placed
      // after the /phone-number lookup below, i.e. AFTER a VAPI round-trip. Two
      // reasons it belongs here instead — a consent refusal should not depend on
      // a third party being reachable, and a VAPI outage would otherwise return
      // a confusing network error for a number that simply opted out.
      /**
       * Suppression — the SAME index every automated lane uses, but with a
       * different RESPONSE, because a human is waiting for an answer.
       *
       * A cron SKIPS a suppressed number silently: there is nobody to tell. An
       * operator pressed a button, so this REFUSES and says why. Silently doing
       * nothing would read as a broken button and get pressed again.
       *
       * Gated on the operator's 2026-09-16 instruction ("i need the opt outs to
       * work too email, txt"). Being operator-initiated is not a consent
       * defence: TCPA does not care who pressed the button, and this dials an
       * AI voice, which is squarely automated-call territory. The button now
       * cannot place a call that the shop would have to answer for.
       *
       * ⚠ There is deliberately NO override flag. If the operator needs one —
       * a genuine callback that a customer requested by other means, say — that
       * is a decision to make explicitly, with a reason recorded, not a
       * parameter an admin screen can pass by accident.
       */
      const { loadSuppressionIndex } = await import("../sms");
      const suppression = await loadSuppressionIndex();
      if (!suppression.ok) {
        log.error("makeFollowUpCall refused — suppression index unreadable", {
          reason: suppression.reason,
          errorId: "MAKE_FOLLOWUP_CALL_SUPPRESSION_UNREADABLE",
        });
        return {
          success: false,
          error: `Can't place the call: the opt-out list could not be read (${suppression.reason}). Refusing rather than risk calling someone who opted out — try again once the database is reachable.`,
        };
      }
      if (suppression.stale) {
        log.error("makeFollowUpCall refused — suppression index is STALE (age unbounded)", {
          suppressed: suppression.phones.size,
          errorId: "MAKE_FOLLOWUP_CALL_SUPPRESSION_STALE",
        });
        return {
          success: false,
          error:
            "Can't place the call: the opt-out list's last refresh FAILED, so its age is unbounded and a recent opt-out may be invisible. Refusing rather than guess.",
        };
      }
      if (suppression.phones.has(e164.replace(/\D/g, "").slice(-10))) {
        log.info("makeFollowUpCall refused — number is on the opt-out list", {
          last4: e164.slice(-4),
          errorId: "MAKE_FOLLOWUP_CALL_SUPPRESSED",
        });
        return {
          success: false,
          error: `This number has opted out of automated contact, so the call was not placed. (Ends ${e164.slice(-4)}.) If they asked you to call them back, do it from a normal line.`,
        };
      }


      // First name only — strip last name + commas (ALG returns "LASTNAME, FIRSTNAME")
      const firstName = input.customerName.includes(",")
        ? input.customerName.split(",")[1]?.trim().split(/\s+/)[0] || "there"
        : input.customerName.split(/\s+/)[0] || "there";

      // Q-45 · route every outbound AI call through the one sanctioned dial.
      // The helper owns the compliant opener, do-not-call tool and voicemail
      // policy, while the suppression checks above remain the first gate.
      const { placeVapiOutboundCall, buildFollowUpCallContent } = await import("../services/vapi");
      const content = buildFollowUpCallContent({ customerName: firstName, lastService: input.lastService });
      const call = await placeVapiOutboundCall({
        customerNumber: e164,
        lane: "followup_manual",
        customerName: firstName,
        openerBody: content.openerBody,
        systemPrompt: content.systemPrompt,
        variableValues: { name: firstName, lastService: input.lastService },
        maxDurationSeconds: 180,
      });
      if (!call.success || !call.callId) {
        log.warn("makeFollowUpCall failed", {
          errorKind: call.errorKind,
          error: (call.error ?? "unknown").slice(0, 300),
        });
        return { success: false, error: call.error ?? "VAPI call failed" };
      }
      log.info("Follow-up call queued", { callId: call.callId, name: firstName, phone: e164.slice(-4) });
      return {
        success: true,
        callId: call.callId,
        status: "queued",
      };
    }),

  // ─── wave-181.67 · Phase 4 admin tile (2026-05-19 AM) ──────
  // Real-time in-flight call state roster + per-call drill-in. Backed
  // by the state-tracker shipped in wave-181.63 (voice-call-state.ts
  // service writes to voice_latency_events with `state_*` stage
  // namespacing). Powers the VoiceReceptionistSection "Live calls"
  // tile · operator monitors calls at the bay from their phone.

  /**
   * Roster of in-flight calls within a lookback window. Default 10
   * min covers a typical 3-min call plus 7-min buffer. `ended` calls
   * are excluded (they're done). React Query polls this every 5s for
   * a live feel without hammering the DB.
   */
  activeCallStates: adminProcedure
    .input(
      z
        .object({ maxAgeMinutes: z.number().int().min(1).max(120).default(10) })
        .optional(),
    )
    .query(async ({ input }) => {
      const { getActiveCallStates } = await import("../services/voice-call-state");
      const states = await getActiveCallStates({
        maxAgeMinutes: input?.maxAgeMinutes ?? 10,
      });
      const byState: Record<string, number> = {};
      for (const s of states) {
        byState[s.latestState] = (byState[s.latestState] ?? 0) + 1;
      }
      return {
        windowMinutes: input?.maxAgeMinutes ?? 10,
        count: states.length,
        states,
        byState,
      };
    }),

  /**
   * Full state trail for one call · oldest → newest with metadata.
   * Powers the "drill in" view when operator taps a call in the
   * roster. Used post-hoc as well (e.g. "why did this call end
   * without confirmation?").
   */
  callStateHistory: dbAdminProcedure
    .input(z.object({ callId: z.string().min(1).max(128) }))
    .query(async ({ input }) => {
      const { getCallStateHistory } = await import("../services/voice-call-state");
      const history = await getCallStateHistory(input.callId);
      return { callId: input.callId, history };
    }),

  /**
   * Achievements and metrics summary for Nick AI receptionist.
   * Pulls directly from local DB logs to calculate levels, badges, and streaks.
   */
  achievements: adminProcedure.query(async () => {
    const db = await getDb();
    if (!db) {
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
    }
    const rows = await db
      .select({
        createdAt: vapiCallLogs.createdAt,
        durationSeconds: vapiCallLogs.durationSeconds,
        endedReason: vapiCallLogs.endedReason,
        convertedToLead: vapiCallLogs.convertedToLead,
        evalScore: vapiCallLogs.evalScore,
        evalOutcome: vapiCallLogs.evalOutcome,
      })
      .from(vapiCallLogs);

    let totalCalls = rows.length;
    let totalDuration = 0;
    /**
     * 2026-07-20 · RENAMED from `totalConverted`. `convertedToLead` DOES NOT
     * mean a lead was created — it is set when the caller reached a write tool
     * (see classifyToolToState / WRITE_TOOLS). Measured the same day: 451 calls
     * carry convertedToLead = 1, ZERO have a leadId, and the leads table holds
     * 2 rows in total, because tireInquiry deliberately stops creating leads for
     * ordinary inquiries (operator directive 2026-06-05). Calling this
     * "converted" told the operator conversions were happening when none were.
     * Same correction already applied in controlCenter.ts (`reachedTool24h`).
     */
    let totalReachedTool = 0;
    let totalExemplary = 0;
    let totalResolved = 0;
    let totalAfterHours = 0;
    let sumScore = 0;
    let countScore = 0;

    for (const r of rows) {
      totalDuration += r.durationSeconds;
      if (r.convertedToLead === 1) totalReachedTool++;
      if (r.evalScore !== null) {
        sumScore += r.evalScore;
        countScore++;
        if (r.evalScore >= 85) totalExemplary++;
        if (r.endedReason === "customer-ended-call" && r.evalScore >= 70) totalResolved++;
      }

      // Cleveland time (America/New_York)
      try {
        const localDate = new Date(r.createdAt.toLocaleString("en-US", { timeZone: "America/New_York" }));
        const hour = localDate.getHours();
        if (hour < 8 || hour >= 18) {
          totalAfterHours++;
        }
      } catch {
        // Fallback to UTC hour if timezone translation fails
        const hour = r.createdAt.getUTCHours();
        if (hour < 12 || hour >= 22) { // rough offset estimate
          totalAfterHours++;
        }
      }
    }

    const avgScore = countScore > 0 ? Math.round(sumScore / countScore) : 0;

    // Calculate current streak of successful calls
    const sorted = [...rows].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    let streak = 0;
    for (const r of sorted) {
      const isPass =
        r.evalOutcome === "PASS" ||
        (r.evalScore !== null && r.evalScore >= 70) ||
        r.convertedToLead === 1 ||
        r.endedReason === "assistant-forwarded-call";
      const isFail =
        r.evalOutcome === "FAIL" ||
        (r.evalScore !== null && r.evalScore < 70);

      if (isPass) {
        streak++;
      } else if (isFail) {
        break;
      }
    }

    return {
      totalCalls,
      totalDuration,
      totalReachedTool,
      totalExemplary,
      totalResolved,
      totalAfterHours,
      avgScore,
      streak,
    };
  }),
});

