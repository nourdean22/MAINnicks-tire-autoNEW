/**
 * Cron · Nick AI Call Evaluation (daily)
 *
 * Daily quality-loop that scores every Nick AI VAPI call (0-100),
 * classifies the outcome, and writes reasoning back to vapi_call_logs
 * so the operator + future LLM passes can learn from real conversations.
 *
 * Why this exists (wave-181.113):
 *   Nick handles ~80% of inbound calls. Pre-181.113 we had per-call
 *   VAPI analysis (summary, sentiment, outcome enum) but NO rollup,
 *   NO quality score, NO compounding feedback. Calls happened, calls
 *   ended, calls forgotten.
 *
 *   This cron closes the loop · daily eval → per-call score → Telegram
 *   digest of worst calls → operator can listen to the 3 worst and
 *   surface fixes for the prompt or memory layer.
 *
 * Score formula (hybrid · heuristic + state ground truth · wave-138):
 *   +30 if outcome IN ('booked','callback_scheduled') AND a write-tool
 *        actually fired (state ground truth). A claimed conversion with NO
 *        tool-fire is a hallucinated outcome → flagged, NOT credited (F3).
 *   +20 if successEvaluation === 'pass'
 *   +15 if sentiment === 'positive'  (-15 if 'negative')
 *   +15 if 30 < durationSeconds < 360 (productive duration)
 *   +10 if tool_called/confirmed state reached (engaged · ground truth, F2)
 *   +10 if convertedToLead
 *   Floor 0 · cap 100.
 *   Sub-50 = wasted · 50-69 = info_only · 70-84 = converted · 85+ = exemplary
 *
 * Ground truth (F1/F2/F3 · wave-138): outcome/sentiment come from VAPI's
 * analysis (the model's OPINION). Whether tools actually fired comes from
 * the state tracker (voice_call_states). We cross-check the two so a
 * hallucinated "booked" with no bookSlot fire can't inflate the score.
 *
 * Defer (F4 · wave-138): if VAPI post-processing hasn't produced an
 * analysis yet, the call is left unevaluated (evalAt stays null) so the
 * next run retries — instead of being permanently mis-scored as wasted.
 * Capped at 24h so an analysis that never lands still scores eventually.
 *
 * Storage: vapi_call_logs.eval_score, eval_outcome, eval_reasoning, eval_at
 *
 * Alerts (deduped per-day via cron_alerts_fired): worst-calls digest if
 * avg < 60 OR wasted >= 3 OR avg degraded >=15 below the 30d baseline (F6) ·
 * zero-call alert if 0 VAPI calls landed in 24h — pipeline-down guard (F5) ·
 * silent on healthy days.
 *
 * Per agent-4 research at server/services/vapi.ts ANALYSIS_PLAN (lines
 * 1152-1215), VAPI already extracts most of these signals server-side.
 * We're just persisting + scoring them, not duplicating the analysis.
 */

import { eq, gte, isNull, isNotNull, and, sql, desc } from "drizzle-orm";
import { vapiCallLogs } from "../../../drizzle/schema";
import { sendTelegram } from "../../services/telegram";
import { getCallStateHistory } from "../../services/voice-call-state";
import { createLogger } from "../../lib/logger";
import { classifyCall } from "../../services/vapiCallClassifier";
import { trailReachedTool, scoreBand, isConvertedScore } from "../../services/vapiConversionSignals";

const log = createLogger("cron:vapi-eval");

interface ProcessResult {
  recordsProcessed: number;
  details: string;
}

interface VapiCallDetail {
  id: string;
  analysis?: {
    summary?: string;
    successEvaluation?: "pass" | "fail" | string;
    structuredData?: {
      outcome?: string;
      sentiment?: "positive" | "neutral" | "negative" | string;
    };
  };
  endedReason?: string;
  durationSeconds?: number;
  /** VAPI call direction · "inboundPhoneCall" | "outboundPhoneCall" | "webCall" */
  type?: string;
  transcript?: string;
}

const LOOKBACK_DAYS = 2; // catch yesterday + today's morning calls

interface ScoredCall {
  vapiCallId: string;
  score: number;
  outcome: string;
  reasoning: string;
  phoneTail4: string;
  /** Intents the classifier extracted (e.g. new_tire, brakes) — used to cluster misses into lessons. */
  intents: string[];
}

export async function processVapiCallEval(): Promise<ProcessResult> {
  const start = Date.now();
  log.info("[vapi-eval] start");

  const { getDb } = await import("../../db");
  const d = await getDb();
  if (!d) return { recordsProcessed: 0, details: "No DB" };

  // Claim today's slot for a named alert so F5/F6 alerts fire AT MOST once
  // per day even if this cron runs more than daily or across multiple pods.
  // Mirrors the cron_alerts_fired INSERT IGNORE dedup from vapiLatencySync.
  // Returns true only if THIS run won the claim (i.e., should send).
  const claimDailyAlert = async (alertKey: string): Promise<boolean> => {
    try {
      const [res] = await d.execute(sql`
        INSERT IGNORE INTO cron_alerts_fired (alert_key, fired_for, fired_at)
        VALUES (${alertKey}, CURDATE(), NOW())
      `);
      return ((res as { affectedRows?: number })?.affectedRows ?? 0) === 1;
    } catch {
      // Table may not exist in some envs · degrade to "send" — a possible
      // dup alert beats silently swallowing a real one.
      return true;
    }
  };

  // F5 · zero-call pipeline guard. If ZERO VAPI calls landed in the last
  // 24h, the webhook/pipeline may be down (the 5-day-silent-VAPI bug class).
  // Distinct from "all calls already evaluated" (healthy · silent below).
  try {
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [{ c }] = await d
      .select({ c: sql<number>`count(*)` })
      .from(vapiCallLogs)
      .where(gte(vapiCallLogs.createdAt, dayAgo));
    if (Number(c) === 0 && (await claimDailyAlert("vapi_zero_calls"))) {
      await sendTelegram(
        "⚠️ NICK AI · 0 VAPI calls logged in the last 24h.\n\n" +
        "Either a genuinely slow day, or the webhook/pipeline is down. " +
        "Verify api/webhooks/vapi is receiving end-of-call-report events.",
      ).catch(() => { /* alert is best-effort */ });
    }
  } catch (e) {
    log.warn("[vapi-eval] zero-call check failed", { error: e instanceof Error ? e.message : String(e) });
  }

  // 1. Pull unevaluated calls from last LOOKBACK_DAYS days
  const lookbackCutoff = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  const rows = await d
    .select({
      id: vapiCallLogs.id,
      vapiCallId: vapiCallLogs.vapiCallId,
      phoneNumber: vapiCallLogs.phoneNumber,
      durationSeconds: vapiCallLogs.durationSeconds,
      endedReason: vapiCallLogs.endedReason,
      aiSummary: vapiCallLogs.aiSummary,
      serviceMention: vapiCallLogs.serviceMention,
      convertedToLead: vapiCallLogs.convertedToLead,
      createdAt: vapiCallLogs.createdAt,
      leadId: vapiCallLogs.leadId,
      callbackId: vapiCallLogs.callbackId,
      metadata: vapiCallLogs.metadata,
    })
    .from(vapiCallLogs)
    .where(and(
      gte(vapiCallLogs.createdAt, lookbackCutoff),
      isNull(vapiCallLogs.evalAt),
    ))
    .orderBy(desc(vapiCallLogs.createdAt));

  if (rows.length === 0) {
    log.info("[vapi-eval] no unevaluated calls in lookback window");
    return { recordsProcessed: 0, details: "no calls to evaluate" };
  }

  log.info(`[vapi-eval] evaluating ${rows.length} calls`);

  // 2. Fetch VAPI details (analysis fields) + score each call
  // Direct fetch · vapiApiFetch in routers/vapi.ts isn't exported, and
  // pulling tRPC error types into a cron handler is overkill.
  const VAPI_API_KEY = process.env.VAPI_API_KEY;
  const VAPI_BASE = "https://api.vapi.ai";
  const scored: ScoredCall[] = [];
  let errored = 0;
  let deferred = 0;
  let outbound = 0;

  for (const row of rows) {
    try {
      // Pull VAPI's analysis (already computed server-side per ANALYSIS_PLAN)
      let analysis: VapiCallDetail["analysis"] = undefined;
      let callType: string | null = null;
      let transcript: string | null = null;
      if (VAPI_API_KEY) {
        try {
          const resp = await fetch(`${VAPI_BASE}/call/${row.vapiCallId}`, {
            headers: { Authorization: `Bearer ${VAPI_API_KEY}` },
          });
          if (resp.ok) {
            const detail = await resp.json() as VapiCallDetail;
            analysis = detail.analysis;
            callType = detail.type ?? null;
            transcript = detail.transcript ?? null;
          }
        } catch (e) {
          log.warn(`[vapi-eval] VAPI fetch failed for ${row.vapiCallId}`, { error: e instanceof Error ? e.message : String(e) });
        }
      }

      // Synergy (wave-142) · this is the INBOUND receptionist quality loop.
      // The follow-up caller's OUTBOUND calls (manual trust calls + the
      // confirmation/recovery crons — all share the follow-up assistant) hit
      // the same end-of-call webhook and get logged here too, but a trust
      // call never "books", so inbound scoring tanks the avg and can fire
      // false wasted/degradation alerts. Their real outcomes live in their
      // own tables (confirmation_calls · alg_estimates.voice_recovery_*).
      // Mark them done + exclude from the metrics (evalScore stays null, so
      // they also drop out of the F6 30d baseline).
      if (callType === "outboundPhoneCall") {
        await d.update(vapiCallLogs).set({
          evalOutcome: "outbound",
          evalReasoning: "Outbound call (follow-up / confirmation / recovery) — excluded from the inbound receptionist eval.",
          evalAt: new Date(),
        }).where(eq(vapiCallLogs.id, row.id));
        outbound++;
        continue;
      }

      // F4 · defer on incomplete analysis. If VAPI post-processing hasn't
      // produced a verdict yet (no successEvaluation AND no outcome), leave
      // the call unevaluated so the next run retries — don't persist a
      // near-zero "wasted" score that sticks forever. Capped at 24h so an
      // analysis that never lands still gets scored eventually.
      const analysisReady = !!analysis && (analysis.successEvaluation != null || analysis.structuredData?.outcome != null);
      const callAgeMs = Date.now() - (row.createdAt?.getTime() ?? 0);
      if (!analysisReady && callAgeMs < 24 * 60 * 60 * 1000) {
        deferred++;
        continue;
      }

      // F1/F2/F3 · tool-fire GROUND TRUTH. VAPI's structuredData.outcome is
      // the model's OPINION; the state trail (voice_call_states, namespaced
      // in voice_latency_events) is what tools ACTUALLY fired. reachedTool =
      // a write tool (bookSlot/scheduleCallback/...) or sendConfirmationSms
      // fired. Used to credit engagement AND to gate the conversion bonus.
      let reachedTool = false;
      try {
        const states = await getCallStateHistory(row.vapiCallId);
        reachedTool = trailReachedTool(states);
      } catch { /* state trail is optional · score without it */ }

      // Run new classifier service
      const classificationInput = {
        durationSeconds: row.durationSeconds ?? 0,
        endedReason: row.endedReason,
        aiSummary: row.aiSummary || analysis?.summary || null,
        transcript: transcript,
        convertedToLead: row.convertedToLead,
        leadId: row.leadId,
        callbackId: row.callbackId,
        sentiment: analysis?.structuredData?.sentiment,
        evalOutcome: analysis?.structuredData?.outcome,
        successEvaluation: analysis?.successEvaluation,
        reachedTool,
      };

      const result = classifyCall(classificationInput);
      const score = result.score;
      const bucketed = result.outcome;
      const reasoning = result.reasoning;

      let queueStatus: string | undefined = undefined;
      let queueUrgency: number | undefined = undefined;

      const candidates = ["lost_opportunity", "callback_needed", "walk_in_directed", "tech_failure"];
      if (candidates.includes(result.outcome)) {
        queueStatus = "pending";
        // compute urgency
        if (result.outcome === "callback_needed") {
          queueUrgency = 9;
        } else if (result.outcome === "lost_opportunity") {
          if (result.intents.includes("new_tire") || result.intents.includes("used_tire") || result.intents.includes("brakes")) {
            queueUrgency = 8;
          } else if (result.intents.length > 0) {
            queueUrgency = 7;
          } else {
            queueUrgency = 6;
          }
        } else if (result.outcome === "walk_in_directed") {
          queueUrgency = 6;
        } else if (result.outcome === "tech_failure") {
          queueUrgency = 5;
        } else {
          queueUrgency = 4;
        }
      }

      const existingMetadata = typeof row.metadata === "string"
        ? JSON.parse(row.metadata)
        : (row.metadata || {});

      const updatedMetadata = {
        ...existingMetadata,
        intents: result.intents,
        ...(queueStatus ? { queueStatus, queueUrgency } : {}),
      };

      if (score !== null) {
        scored.push({
          vapiCallId: row.vapiCallId,
          score,
          outcome: bucketed,
          reasoning,
          phoneTail4: (row.phoneNumber ?? "").replace(/\D/g, "").slice(-4),
          intents: result.intents,
        });
      }

      // Persist
      await d
        .update(vapiCallLogs)
        .set({
          evalScore: score,
          evalOutcome: bucketed,
          evalReasoning: reasoning,
          evalAt: new Date(),
          metadata: updatedMetadata,
          // 2026-06-20 · reconcile the conversion flag from ground truth. The
          // webhook stamps convertedToLead at row-insert; a last-second tool
          // whose fire-and-forget state write lands after end-of-call would
          // miss it — here the trail is complete. Set 1 when a tool was
          // reached; never regress a flag already set (e.g. trail read failed).
          convertedToLead: reachedTool ? 1 : row.convertedToLead,
        })
        .where(eq(vapiCallLogs.id, row.id));
    } catch (e) {
      errored++;
      log.warn(`[vapi-eval] eval failed for call ${row.vapiCallId}`, {
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  // 3. Aggregate + Telegram alert
  const totalCalls = scored.length;
  if (totalCalls === 0) {
    return { recordsProcessed: 0, details: `${rows.length} calls in window · 0 scored · ${deferred} deferred (analysis pending) · ${outbound} outbound-skipped · ${errored} errors` };
  }

  const avgScore = Math.round(scored.reduce((s, c) => s + c.score, 0) / totalCalls);
  // Band counts come from the SCORE, not the outcome category. The prior code
  // compared c.outcome (a category like 'hard_conversion') against score-band
  // labels ('wasted'/'converted'/'exemplary') — they never matched, so the
  // nightly digest always reported 0 converted / 0 wasted. scoreBand maps the
  // documented bands: <50 wasted · 50-69 info · 70-84 converted · 85+ exemplary.
  const wastedCount = scored.filter((c) => scoreBand(c.score) === "wasted").length;
  const convertedCount = scored.filter((c) => isConvertedScore(c.score)).length;
  const conversionRate = totalCalls > 0 ? Math.round((convertedCount / totalCalls) * 100) : 0;

  // F6 · degradation alert. Compare today's batch avg to the 30d baseline
  // built from calls OLDER than the current lookback window (so we never
  // compare today against itself). Fires even when the absolute avg is
  // >=60, which the static threshold misses — an 85→68 slide is a real
  // problem worth a ping. Needs >=20 prior scored calls to trust the trend.
  let degraded = false;
  let baselineAvg: number | null = null;
  try {
    const baselineCutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const [b] = await d
      .select({ avg: sql<number | null>`avg(${vapiCallLogs.evalScore})`, n: sql<number>`count(*)` })
      .from(vapiCallLogs)
      .where(and(
        isNotNull(vapiCallLogs.evalScore),
        gte(vapiCallLogs.createdAt, baselineCutoff),
        sql`${vapiCallLogs.createdAt} < ${lookbackCutoff}`,
      ));
    const baselineN = Number(b?.n ?? 0);
    baselineAvg = b?.avg != null ? Number(b.avg) : null;
    degraded = baselineN >= 20 && baselineAvg != null && avgScore <= baselineAvg - 15;
  } catch (e) {
    log.warn("[vapi-eval] degradation baseline query failed", { error: e instanceof Error ? e.message : String(e) });
  }

  // Alert if quality is concerning (compound learning signal)
  const shouldAlert = avgScore < 60 || wastedCount >= 3 || degraded;

  if (shouldAlert) {
    try {
      // Warm-transfer connect rate (14d) — rides the alert digest as context
      // (no new nightly message; the always-on view is the admin Voice tile).
      // READ-ONLY and INFERRED: VAPI exposes no "human answered" bit, so this is
      // a duration proxy — see lib/warmTransferConnect.ts. Withheld until >=10
      // forwards so a noisy window never surfaces a misleading %.
      let connectLine = "";
      try {
        const { computeWarmTransferConnectRate } = await import("../../lib/warmTransferConnect");
        const connectCutoff = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
        const transferRows = await d
          .select({ endedReason: vapiCallLogs.endedReason, durationSeconds: vapiCallLogs.durationSeconds })
          .from(vapiCallLogs)
          .where(gte(vapiCallLogs.createdAt, connectCutoff));
        const wt = computeWarmTransferConnectRate(transferRows);
        connectLine = wt.reliable
          ? `Warm-transfer connect (14d): ~${wt.rate}% inferred · ${wt.connected}/${wt.attempted} forwards · ${wt.failed} failed`
          : `Warm-transfers (14d): ${wt.attempted} attempted · ${wt.failed} failed · connect % pending (need >=10)`;
      } catch (wtErr) {
        log.warn("[vapi-eval] connect-rate compute failed", { error: wtErr instanceof Error ? wtErr.message : String(wtErr) });
      }

      const worst = scored
        .sort((a, b) => a.score - b.score)
        .slice(0, 3)
        .map((c) => `  · ${c.score}/100 · ...${c.phoneTail4} · ${c.outcome}`);

      const lines = [
        `📞 NICK AI CALL EVAL · ${totalCalls} calls · avg ${avgScore}/100`,
        ``,
        `Converted: ${convertedCount} (${conversionRate}%) · Wasted: ${wastedCount}`,
        ``,
        `Worst calls (drill down at /admin/voice-receptionist):`,
        ...worst,
        ``,
        degraded && baselineAvg != null
          ? `⚠ Quality degraded — avg ${avgScore} is ${Math.round(baselineAvg) - avgScore} pts below the 30d baseline (${Math.round(baselineAvg)}). Check recent prompt/memory changes.`
          : avgScore < 60 ? "⚠ Avg score below 60 — investigate the prompt or memory layer." :
          `${wastedCount} wasted calls — listen to the worst 3 and find the pattern.`,
      ];
      // Slot the connect line right after the Converted/Wasted line (index 2).
      if (connectLine) lines.splice(3, 0, connectLine);
      await sendTelegram(lines.join("\n"));
    } catch (e) {
      log.warn("[vapi-eval] telegram failed", { error: e instanceof Error ? e.message : String(e) });
    }
  }

  // 4. Persist compound-learning memories to nick memory.
  try {
    const { remember } = await import("../../services/nickMemory");

    // Daily rollup — a low-value digest kept for continuity with the Telegram
    // alert. Its content changes every run, so it never reinforces.
    await remember({
      type: "insight",
      content: `Daily VAPI eval: ${totalCalls} calls · avg ${avgScore}/100 · converted ${convertedCount} (${conversionRate}%) · wasted ${wastedCount}.`,
      source: "vapi_eval_cron",
      confidence: 0.85,
    });

    // Structured lessons — cluster this run's coachable misses (a lost_opportunity
    // outcome, or a soft info-only score of 50-69) by the intents the classifier
    // extracted. The lesson text is STABLE per intent, so remember() reinforces a
    // recurring pattern day over day (confidence compounds) instead of writing a
    // throwaway string. This turns getMemoryContext() from a rollup feed into a
    // ranked "what to fix" list a later phase can splice into the assistant prompt.
    const misses = scored.filter(
      (c) => c.outcome === "lost_opportunity" || scoreBand(c.score) === "info",
    );
    const missesByIntent = new Map<string, number>();
    for (const c of misses) {
      for (const intent of c.intents) {
        missesByIntent.set(intent, (missesByIntent.get(intent) ?? 0) + 1);
      }
    }
    for (const [intent, count] of missesByIntent) {
      if (count < 2) continue; // a single miss isn't a pattern worth a lesson
      await remember({
        type: "lesson",
        content: `Callers about "${intent}" keep ending without a booking (lost or info-only). Qualify the ${intent} ask faster and offer a manager transfer earlier so the call converts.`,
        source: "vapi_eval_cron",
        confidence: 0.6,
      });
    }
  } catch (e) {
    log.warn("[vapi-eval] nickMemory persist failed", { error: e instanceof Error ? e.message : String(e) });
  }

  const durMs = Date.now() - start;
  log.info(`[vapi-eval] done in ${durMs}ms`, { totalCalls, avgScore, convertedCount, wastedCount, deferred, outbound, errored, degraded });

  return {
    recordsProcessed: totalCalls,
    details: `${totalCalls} scored · avg ${avgScore}/100 · ${convertedCount} converted · ${wastedCount} wasted · ${deferred} deferred · ${outbound} outbound-skipped · ${errored} errors`,
  };
}
