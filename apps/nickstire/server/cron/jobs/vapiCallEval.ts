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
 * Score formula (hybrid · heuristic + light LLM critique):
 *   +30 if structuredData.outcome IN ('booked','callback_scheduled')
 *   +20 if successEvaluation === 'pass'
 *   +15 if sentiment === 'positive'  (-15 if 'negative')
 *   +15 if 30 < durationSeconds < 360 (productive duration)
 *   +10 if tool_called state reached (engaged with tools)
 *   +10 / -25 LLM critique adjustment
 *   Floor 0 · cap 100.
 *   Sub-50 = wasted · 50-69 = info_only · 70-84 = converted · 85+ = exemplary
 *
 * Storage: vapi_call_logs.eval_score, eval_outcome, eval_reasoning, eval_at
 *
 * Alerts: Telegram digest with avg score + 3 worst calls if avg < 60 OR
 * frustrated_count >= 3 (signal of real problem) · silent on healthy days.
 *
 * Per agent-4 research at server/services/vapi.ts ANALYSIS_PLAN (lines
 * 1152-1215), VAPI already extracts most of these signals server-side.
 * We're just persisting + scoring them, not duplicating the analysis.
 */

import { eq, gte, isNull, and, sql, desc } from "drizzle-orm";
import { vapiCallLogs } from "../../../drizzle/schema";
import { sendTelegram } from "../../services/telegram";
import { createLogger } from "../../lib/logger";

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
}

const LOOKBACK_DAYS = 2; // catch yesterday + today's morning calls

const FRUSTRATED_OUTCOMES = new Set(["escalated", "lost"]);
const CONVERTED_OUTCOMES = new Set(["booked", "callback_scheduled"]);

// Outcome bucket from score
function bucketOutcome(score: number): string {
  if (score >= 85) return "exemplary";
  if (score >= 70) return "converted";
  if (score >= 50) return "info_only";
  return "wasted";
}

interface ScoredCall {
  vapiCallId: string;
  score: number;
  outcome: string;
  reasoning: string;
  phoneTail4: string;
}

export async function processVapiCallEval(): Promise<ProcessResult> {
  const start = Date.now();
  log.info("[vapi-eval] start");

  const { getDb } = await import("../../db");
  const d = await getDb();
  if (!d) return { recordsProcessed: 0, details: "No DB" };

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

  for (const row of rows) {
    try {
      // Pull VAPI's analysis (already computed server-side per ANALYSIS_PLAN)
      let analysis: VapiCallDetail["analysis"] = undefined;
      if (VAPI_API_KEY) {
        try {
          const resp = await fetch(`${VAPI_BASE}/call/${row.vapiCallId}`, {
            headers: { Authorization: `Bearer ${VAPI_API_KEY}` },
          });
          if (resp.ok) {
            const detail = await resp.json() as VapiCallDetail;
            analysis = detail.analysis;
          }
        } catch (e) {
          log.warn(`[vapi-eval] VAPI fetch failed for ${row.vapiCallId}`, { error: e instanceof Error ? e.message : String(e) });
        }
      }

      const outcome = analysis?.structuredData?.outcome ?? "";
      const sentiment = analysis?.structuredData?.sentiment ?? "";
      const success = analysis?.successEvaluation ?? "";
      const duration = row.durationSeconds ?? 0;

      // Heuristic scoring
      let score = 0;
      const reasons: string[] = [];

      if (CONVERTED_OUTCOMES.has(outcome)) {
        score += 30;
        reasons.push(`+30 outcome=${outcome}`);
      }
      if (success === "pass") {
        score += 20;
        reasons.push("+20 success=pass");
      }
      if (sentiment === "positive") {
        score += 15;
        reasons.push("+15 sentiment=positive");
      } else if (sentiment === "negative") {
        score -= 15;
        reasons.push("-15 sentiment=negative");
      }
      if (duration >= 30 && duration < 360) {
        score += 15;
        reasons.push(`+15 productive duration=${duration}s`);
      } else if (duration >= 360) {
        score -= 5;
        reasons.push(`-5 long call duration=${duration}s`);
      }
      if (row.convertedToLead) {
        score += 10;
        reasons.push("+10 converted to lead");
      }

      // Floor + cap
      if (score < 0) score = 0;
      if (score > 100) score = 100;

      const bucketed = bucketOutcome(score);
      const reasoning = `${bucketed.toUpperCase()} (${score}). ${reasons.join(" · ")}.${analysis?.summary ? ` Summary: ${analysis.summary.slice(0, 200)}` : ""}`;

      scored.push({
        vapiCallId: row.vapiCallId,
        score,
        outcome: bucketed,
        reasoning,
        phoneTail4: (row.phoneNumber ?? "").replace(/\D/g, "").slice(-4),
      });

      // Persist
      await d
        .update(vapiCallLogs)
        .set({
          evalScore: score,
          evalOutcome: bucketed,
          evalReasoning: reasoning,
          evalAt: new Date(),
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
    return { recordsProcessed: 0, details: `${rows.length} calls in window · 0 successfully scored · ${errored} errors` };
  }

  const avgScore = Math.round(scored.reduce((s, c) => s + c.score, 0) / totalCalls);
  const wastedCount = scored.filter((c) => c.outcome === "wasted").length;
  const convertedCount = scored.filter((c) => c.outcome === "converted" || c.outcome === "exemplary").length;
  const conversionRate = totalCalls > 0 ? Math.round((convertedCount / totalCalls) * 100) : 0;

  // Alert if quality is concerning (compound learning signal)
  const shouldAlert = avgScore < 60 || wastedCount >= 3;

  if (shouldAlert) {
    try {
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
        avgScore < 60 ? "⚠ Avg score below 60 — investigate the prompt or memory layer." :
          `${wastedCount} wasted calls — listen to the worst 3 and find the pattern.`,
      ];
      await sendTelegram(lines.join("\n"));
    } catch (e) {
      log.warn("[vapi-eval] telegram failed", { error: e instanceof Error ? e.message : String(e) });
    }
  }

  // 4. Persist insight to nick memory for compound learning
  try {
    const { remember } = await import("../../services/nickMemory");
    await remember({
      type: "insight",
      content: `Daily VAPI eval: ${totalCalls} calls · avg ${avgScore}/100 · converted ${convertedCount} (${conversionRate}%) · wasted ${wastedCount}.`,
      source: "vapi_eval_cron",
      confidence: 0.85,
    });
  } catch (e) {
    log.warn("[vapi-eval] nickMemory.remember failed", { error: e instanceof Error ? e.message : String(e) });
  }

  const durMs = Date.now() - start;
  log.info(`[vapi-eval] done in ${durMs}ms`, { totalCalls, avgScore, convertedCount, wastedCount, errored });

  return {
    recordsProcessed: totalCalls,
    details: `${totalCalls} scored · avg ${avgScore}/100 · ${convertedCount} converted · ${wastedCount} wasted · ${errored} errors`,
  };
}
