import { and, desc, eq, gte, isNotNull, isNull, sql } from "drizzle-orm";
import { vapiCallLogs } from "../../../drizzle/schema";
import { createLogger } from "../../lib/logger";
import { sendTelegram } from "../../services/telegram";
import { getCallStateHistory } from "../../services/voice-call-state";
import { classifyCall, extractCallSignals } from "../../services/vapiCallClassifier";
import { extractCustomerTurns } from "../../services/customerTurns";
import { extractDemand } from "@shared/callDemandExtraction";
import { disposeCall } from "@shared/callTaxonomy";
import { trailReachedTool } from "../../services/vapiConversionSignals";
import {
  buildVapiMeasurementRecord,
  deriveVapiFacts,
  hasVerifiedDemandCapture,
  VAPI_CLASSIFIER_VERSION,
  VAPI_QUALITY_VERSION,
} from "../../services/vapiMeasurement";

const log = createLogger("cron:vapi-eval");
const LOOKBACK_DAYS = 2;

interface ProcessResult {
  recordsProcessed: number;
  details: string;
}

interface VapiCallDetail {
  type?: string;
  transcript?: string;
  analysis?: {
    summary?: string;
    successEvaluation?: "pass" | "fail" | string;
    structuredData?: {
      outcome?: string;
      sentiment?: "positive" | "neutral" | "negative" | string;
    };
  };
}

interface ScoredCall {
  vapiCallId: string;
  score: number;
  outcome: string;
  phoneTail4: string;
  intents: string[];
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

/**
 * Rows out of a raw `db.execute(sql\`SELECT ...\`)`.
 *
 * mysql2 resolves to `[rows, fields]`, so the rows live at index 0 and index 0
 * of THAT is the first row. Indexing the outer tuple once yields the rows ARRAY
 * — reading `.scanned` off it gives `undefined`, which `Number(undefined ?? 0)`
 * then turns into a perfectly plausible `0`.
 *
 * That is exactly how this file's voice-claim aggregate shipped reporting
 * `scanned: 0` forever, which in turn made its coverage alarm ("inbound calls
 * logged but NONE scanned") fire every single day — the permanently-red gate
 * that teaches an operator to ignore the alert.
 *
 * Extracted and tested rather than repeated inline, because the failure is
 * silent: the wrong shape does not throw, it produces zeroes.
 */
export function rowsFromExecute<T = Record<string, unknown>>(result: unknown): T[] {
  // mysql2 tuple: [rows, fields]
  if (Array.isArray(result) && Array.isArray(result[0])) return result[0] as T[];
  // some drivers return { rows: [...] }
  const maybe = (result as { rows?: unknown })?.rows;
  if (Array.isArray(maybe)) return maybe as T[];
  // already a bare rows array
  if (Array.isArray(result)) return result as T[];
  return [];
}

export async function processVapiCallEval(): Promise<ProcessResult> {
  const startedAt = Date.now();
  const { getDb } = await import("../../db");
  const db = await getDb();
  if (!db) return { recordsProcessed: 0, details: "No DB" };

  const claimDailyAlert = async (key: string): Promise<boolean> => {
    try {
      const [result] = await db.execute(sql`
        INSERT IGNORE INTO cron_alerts_fired (alert_key, fired_for, fired_at)
        VALUES (${key}, CURDATE(), NOW())
      `);
      return ((result as { affectedRows?: number })?.affectedRows ?? 0) === 1;
    } catch {
      return true;
    }
  };

  try {
    const dayAgo = new Date(Date.now() - 86_400_000);
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)` })
      .from(vapiCallLogs)
      .where(gte(vapiCallLogs.createdAt, dayAgo));
    if (Number(count) === 0 && await claimDailyAlert("vapi_zero_calls")) {
      await sendTelegram(
        "NICK AI reliability alert: zero VAPI calls were logged in the last 24 hours. Verify the webhook before treating this as a quiet day.",
      ).catch(() => undefined);
    }
  } catch (error) {
    log.warn("[vapi-eval] zero-call check failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  // ARCHIVE PASS · durable transcript vault. VAPI deletes transcripts and
  // recordings 14 days after a call; this pass persists them before the purge.
  // It runs ahead of evaluation and independently of eval state (outbound and
  // deferred calls are vaulted too), and its failure must never block the eval
  // loop — the vault is additive.
  let archiveDetails = "";
  try {
    const { archiveRecentVapiCalls } = await import("../../services/vapiCallArchive");
    const archive = await archiveRecentVapiCalls();
    archiveDetails = ` · archive: ${archive.details}`;
  } catch (error) {
    archiveDetails = " · archive: FAILED";
    log.warn("[vapi-eval] archive pass failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  const cutoff = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000);
  const rows = await db
    .select({
      id: vapiCallLogs.id,
      vapiCallId: vapiCallLogs.vapiCallId,
      phoneNumber: vapiCallLogs.phoneNumber,
      durationSeconds: vapiCallLogs.durationSeconds,
      endedReason: vapiCallLogs.endedReason,
      aiSummary: vapiCallLogs.aiSummary,
      convertedToLead: vapiCallLogs.convertedToLead,
      leadId: vapiCallLogs.leadId,
      callbackId: vapiCallLogs.callbackId,
      createdAt: vapiCallLogs.createdAt,
      metadata: vapiCallLogs.metadata,
    })
    .from(vapiCallLogs)
    .where(and(gte(vapiCallLogs.createdAt, cutoff), isNull(vapiCallLogs.evalAt)))
    .orderBy(desc(vapiCallLogs.createdAt));

  if (!rows.length) return { recordsProcessed: 0, details: `no calls to evaluate${archiveDetails}` };

  const apiKey = process.env.VAPI_API_KEY;
  const scored: ScoredCall[] = [];
  let deferred = 0;
  let outbound = 0;
  let errored = 0;
  let technicalFailures = 0;
  let verifiedCaptures = 0;

  for (const row of rows) {
    try {
      let detail: VapiCallDetail = {};
      if (apiKey) {
        try {
          const response = await fetch(`https://api.vapi.ai/call/${row.vapiCallId}`, {
            headers: { Authorization: `Bearer ${apiKey}` },
          });
          if (response.ok) detail = await response.json() as VapiCallDetail;
        } catch (error) {
          log.warn("[vapi-eval] provider detail fetch failed", {
            callId: row.vapiCallId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      if (detail.type === "outboundPhoneCall") {
        await db.update(vapiCallLogs).set({
          evalOutcome: "outbound",
          evalReasoning: "Outbound call excluded from inbound receptionist measurement.",
          evalAt: new Date(),
          metadata: {
            ...asRecord(row.metadata),
            revenueOpsV1: {
              metricDefinitionVersion: "revenue-ops-v1",
              classifierVersion: VAPI_CLASSIFIER_VERSION,
              qualityVersion: VAPI_QUALITY_VERSION,
              evidenceLevel: "observed",
              excludedReason: "outbound",
              evaluatedAt: new Date().toISOString(),
            },
          },
        }).where(eq(vapiCallLogs.id, row.id));
        outbound++;
        continue;
      }

      const analysisReady = detail.analysis?.successEvaluation != null || detail.analysis?.structuredData?.outcome != null;
      if (!analysisReady && Date.now() - row.createdAt.getTime() < 86_400_000) {
        deferred++;
        continue;
      }

      const stateHistory = await getCallStateHistory(row.vapiCallId).catch(() => []);
      const reachedTool = trailReachedTool(stateHistory);

      /**
       * Buying specifics, from the CALLER's turns only.
       *
       * Until now nothing extracted a tire size, vehicle, quantity or
       * new-vs-used anywhere in this app — `detectIntents` only set booleans —
       * so the follow-up text could not name what the caller spent the call
       * describing. Deterministic and cheap: no per-call model spend, and it
       * fails closed (`null`, never a guess) because a wrong size sends a
       * customer home with tires that do not fit.
       *
       * `extractCustomerTurns` — not the raw transcript. Parsing Nick's speech
       * would attribute his read-back confirmation to the caller, which is the
       * contamination that manufactured the missed-revenue queue.
       */
      const speech = extractCustomerTurns(detail.transcript ?? null);
      const demand = extractDemand(speech.turns);

      const result = classifyCall({
        durationSeconds: row.durationSeconds ?? 0,
        endedReason: row.endedReason,
        aiSummary: row.aiSummary || detail.analysis?.summary || null,
        transcript: detail.transcript ?? null,
        convertedToLead: row.convertedToLead,
        leadId: row.leadId,
        callbackId: row.callbackId,
        sentiment: detail.analysis?.structuredData?.sentiment,
        evalOutcome: detail.analysis?.structuredData?.outcome,
        successEvaluation: detail.analysis?.successEvaluation,
        reachedTool,
      });

      const facts = deriveVapiFacts({
        reachedTool,
        leadId: row.leadId,
        callbackId: row.callbackId,
        endedReason: row.endedReason,
        inferredWalkIn: result.outcome === "walk_in_directed",
      });
      if (hasVerifiedDemandCapture(facts)) verifiedCaptures++;
      if (result.outcome === "tech_failure") technicalFailures++;

      const measurement = buildVapiMeasurementRecord({
        facts,
        quality: {
          score: result.score,
          version: VAPI_QUALITY_VERSION,
          evidence: result.qualityEvidence,
          ...(result.score == null ? { unavailableReason: result.outcome } : {}),
        },
        walkInEvidence: result.outcome === "walk_in_directed" ? "inferred" : "observed",
      });

      // Per-call signal extraction — the WHY behind a queued call (objection that
      // stalled it, competitor named, price-sensitivity). Deterministic + cheap.
      const callSignals = extractCallSignals({
        transcript: detail.transcript ?? null,
        summary: row.aiSummary || detail.analysis?.summary || null,
      });

      const existingMetadata = asRecord(row.metadata);

      /**
       * Queue membership now comes from the ONE kernel, not a re-typed list.
       *
       * This array and the one in `routers/vapi.ts` were maintained by hand and
       * had drifted apart — the write side stamped `queueStatus` using one copy
       * while the read side re-derived membership from another. Both also
       * treated `walk_in_directed` as missed revenue, though the scorecard
       * counts it as a SUCCESS, and `tech_failure` as an operator obligation,
       * though the same dashboard excludes it as "not a valid conversation".
       * `disposeCall` resolves both contradictions in one place.
       */
      const disposition = disposeCall({
        outcome: result.outcome,
        speakerAttribution: result.speakerAttribution,
        hasCustomerSpeech: speech.firstSubstantive !== null,
        durationSeconds: row.durationSeconds ?? 0,
        ageMinutes: Math.max(0, Math.floor((Date.now() - row.createdAt.getTime()) / 60_000)),
        hasCapturedSpecifics: demand.hasCapturedSpecifics,
      });
      const queueCandidate = disposition.queueEligible;
      const queueUrgency = disposition.priority;

      await db.update(vapiCallLogs).set({
        evalScore: result.score,
        evalOutcome: result.outcome,
        evalReasoning: result.reasoning,
        evalAt: new Date(),
        metadata: {
          ...existingMetadata,
          intents: result.intents,
          callSignals,
          revenueOpsV1: measurement,
          /** Buying specifics from the caller's own turns. Null-safe throughout. */
          demand,
          /**
           * Where the outcome's evidence came from. Persisted so queue and
           * dashboard can separate "no demand" from "we could not read the
           * call" — an UNKNOWN must never be averaged in as a zero.
           */
          speakerAttribution: result.speakerAttribution,
          lane: disposition.lane,
          priorityReasons: disposition.reasons,
          ...(queueCandidate ? { queueStatus: "pending", queueUrgency } : {}),
        },
      }).where(eq(vapiCallLogs.id, row.id));

      if (result.score != null) {
        scored.push({
          vapiCallId: row.vapiCallId,
          score: result.score,
          outcome: result.outcome,
          phoneTail4: (row.phoneNumber ?? "").replace(/\D/g, "").slice(-4),
          intents: result.intents,
        });
      }
    } catch (error) {
      errored++;
      log.warn("[vapi-eval] evaluation failed", {
        callId: row.vapiCallId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const averageQuality = scored.length
    ? Math.round(scored.reduce((sum, call) => sum + call.score, 0) / scored.length)
    : null;
  const lowQuality = scored.filter((call) => call.score < 50).length;

  let baselineAverage: number | null = null;
  let degraded = false;
  try {
    const baselineCutoff = new Date(Date.now() - 30 * 86_400_000);
    const [baseline] = await db.select({
      average: sql<number | null>`avg(${vapiCallLogs.evalScore})`,
      count: sql<number>`count(*)`,
    }).from(vapiCallLogs).where(and(
      isNotNull(vapiCallLogs.evalScore),
      gte(vapiCallLogs.createdAt, baselineCutoff),
      sql`${vapiCallLogs.createdAt} < ${cutoff}`,
    ));
    baselineAverage = baseline?.average == null ? null : Number(baseline.average);
    degraded = averageQuality != null && Number(baseline?.count ?? 0) >= 20 && baselineAverage != null && averageQuality <= baselineAverage - 15;
  } catch (error) {
    log.warn("[vapi-eval] quality baseline failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  if ((averageQuality != null && averageQuality < 60) || lowQuality >= 3 || degraded || technicalFailures >= 2) {
    if (await claimDailyAlert("vapi_quality_or_reliability")) {
      const worst = [...scored].sort((a, b) => a.score - b.score).slice(0, 3)
        .map((call) => `${call.score}/100 · ...${call.phoneTail4} · ${call.outcome}`);
      await sendTelegram([
        `NICK AI DAILY MEASUREMENT · ${rows.length} inbound records`,
        `Conversation quality: ${averageQuality ?? "unavailable"}/100 across ${scored.length} scored calls`,
        `Verified lead/callback capture: ${verifiedCaptures}`,
        `Technical failures: ${technicalFailures}/${rows.length} total inbound records`,
        `Low-quality calls: ${lowQuality}/${scored.length} scored calls`,
        ...worst,
      ].join("\n")).catch(() => undefined);
    }
  }

  // VOICE CLAIM GUARD · daily aggregate.
  //
  // The webhook scores each call's assistant speech and stores labels under
  // `metadata.voiceClaims`; this turns that into the one operator signal, with
  // the same daily dedupe as the quality alert so a bad day cannot spam.
  //
  // COVERAGE IS REPORTED WITH THE COUNT, DELIBERATELY. "0 violations" and
  // "nothing was scanned" are the same number, so a webhook that silently
  // stopped writing would otherwise read as a perfect record forever. `scanned`
  // and `unparsed` are what make a clean day distinguishable from a blind one.
  try {
    const claimRows = await db.execute(sql`
      SELECT
        COUNT(*) AS scanned,
        COALESCE(SUM(JSON_LENGTH(JSON_EXTRACT(metadata, '$.voiceClaims.violations')) > 0), 0) AS withViolations,
        COALESCE(SUM(JSON_EXTRACT(metadata, '$.voiceClaims.unparsed') = TRUE), 0) AS unparsed,
        COALESCE(SUM(JSON_LENGTH(JSON_EXTRACT(metadata, '$.voiceClaims.botTells')) > 0), 0) AS withBotTells
      FROM vapi_call_logs
      WHERE createdAt >= ${cutoff}
        AND JSON_EXTRACT(metadata, '$.voiceClaims') IS NOT NULL
    `);
    const agg = rowsFromExecute<{
      scanned?: unknown; withViolations?: unknown; unparsed?: unknown; withBotTells?: unknown;
    }>(claimRows)[0];
    const scanned = Number(agg?.scanned ?? 0);
    const withViolations = Number(agg?.withViolations ?? 0);
    const unparsedCount = Number(agg?.unparsed ?? 0);
    const withBotTells = Number(agg?.withBotTells ?? 0);

    // Alert when the assistant made prohibited claims, OR when coverage
    // collapsed — a scan that stopped running is the more dangerous failure,
    // because it looks exactly like success.
    const coverageBroken = rows.length >= 5 && scanned === 0;
    if ((withViolations > 0 || coverageBroken) && await claimDailyAlert("vapi_voice_claims")) {
      const labelRows = await db.execute(sql`
        SELECT JSON_EXTRACT(metadata, '$.voiceClaims.violations') AS violations
        FROM vapi_call_logs
        WHERE createdAt >= ${cutoff}
          AND JSON_LENGTH(JSON_EXTRACT(metadata, '$.voiceClaims.violations')) > 0
        LIMIT 50
      `);
      const tally = new Map<string, number>();
      for (const r of rowsFromExecute<{ violations?: unknown }>(labelRows)) {
        const raw = r?.violations;
        const list: unknown = typeof raw === "string" ? JSON.parse(raw) : raw;
        if (Array.isArray(list)) {
          for (const l of list) tally.set(String(l), (tally.get(String(l)) ?? 0) + 1);
        }
      }
      const breakdown = [...tally.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([label, n]) => `  ${label}: ${n}`);

      await sendTelegram([
        coverageBroken
          ? "NICK AI VOICE CLAIM GUARD: coverage gap — inbound calls logged but NONE scanned. Verify the end-of-call webhook."
          : `NICK AI VOICE CLAIM GUARD: ${withViolations}/${scanned} scanned calls contained a prohibited claim.`,
        `Scanned: ${scanned} · unparsed (no speaker attribution): ${unparsedCount}`,
        ...breakdown,
        // Reported on its own line, never folded into the claim count — a banned
        // phrasing and an unsourced price are not the same severity, and one
        // blended number would hide which is happening.
        `Bot-tells (banned phrasings, separate severity): ${withBotTells}/${scanned} calls`,
        // THE LEGEND MUST LIST THE CLASSES THAT ACTUALLY EXIST. This line read
        // "repair quotes, live stock, capacity/wait promises" from 2026-07-27
        // until 2026-09-18, by which point the guard also carried four tire
        // safety claims and two repair-intake claims. An operator seeing
        // `phone_repairability_verdict` in the breakdown above had no way to
        // tell what class it belonged to, or that safety claims were being
        // scored at all. A legend that stops describing its own list is worse
        // than no legend: it actively misinforms.
        "Classes: money (unapproved price, stock, capacity, wait, callback) · "
          + "tire safety (repairability, improper repair, tire age, AWD) · "
          + "repair intake (part named over the phone, safe-to-drive verdict).",
        "Detection only — voice cannot be blocked mid-call, and the safety "
          + "patterns under-match on purpose, so a clean report is not proof of a clean call.",
      ].join("\n")).catch(() => undefined);
    }
  } catch (error) {
    log.warn("[vapi-eval] voice-claim aggregate failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  try {
    const { remember } = await import("../../services/nickMemory");
    const missesByIntent = new Set(
      scored.filter((call) => call.outcome === "lost_opportunity" || call.score < 60)
        .flatMap((call) => call.intents),
    );
    for (const intent of missesByIntent) {
      await remember({
        type: "lesson",
        content: `Calls about "${intent}" repeatedly lack a useful next step or finish with low conversation quality. Identify the need sooner and give one accurate next action.`,
        source: "vapi_eval_cron",
        confidence: 0.6,
      });
    }
  } catch (error) {
    log.warn("[vapi-eval] learning persist failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  const durationMs = Date.now() - startedAt;
  log.info("[vapi-eval] complete", {
    durationMs,
    evaluated: rows.length,
    scored: scored.length,
    averageQuality,
    verifiedCaptures,
    technicalFailures,
    deferred,
    outbound,
    errored,
  });

  return {
    recordsProcessed: rows.length - deferred - outbound - errored,
    details: `${scored.length} quality-scored · ${verifiedCaptures} verified captures · ${technicalFailures} technical failures · ${deferred} deferred · ${outbound} outbound · ${errored} errors${archiveDetails}`,
  };
}