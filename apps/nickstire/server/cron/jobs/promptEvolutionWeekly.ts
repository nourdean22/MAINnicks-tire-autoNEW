/**
 * Weekly prompt evolution (2026-08-06) — the R&D loop, self-sustaining.
 *
 * Runs the gated-edit cycle (services/promptEvolution.ts) every Monday on
 * fresh Ossuary seeds. PROPOSE-ONLY: an accepted candidate is persisted to
 * the shop_settings kv (prompt_evolution_latest) and summarized to Telegram
 * — the served prompt is never written; applying a proposal is an operator
 * edit + Push Config, as always. Results are kv+Telegram (NOT files):
 * Railway's filesystem is ephemeral, and a proposal written to container
 * disk would be the built-unwired disease with extra steps.
 *
 * Rides the daily tier and self-gates to Monday ("Skipped · not Monday"
 * matches the loop-shape whole-run-skip vocabulary, so the shape observer
 * never reads the six quiet days as dormancy).
 */
import { eq } from "drizzle-orm";
import { shopSettings } from "../../../drizzle/schema";
import { createLogger } from "../../lib/logger";
import { describeVerdict } from "../../services/promptEvolutionGate";

const log = createLogger("cron:prompt-evolution");

interface ProcessResult {
  recordsProcessed: number;
  details: string;
}

async function setKv(key: string, value: string, label: string): Promise<void> {
  const { getDb } = await import("../../db");
  const d = await getDb();
  if (!d) return;
  const existing = await d.select().from(shopSettings).where(eq(shopSettings.key, key)).limit(1);
  if (existing.length > 0) {
    await d.update(shopSettings).set({ value, updatedBy: "system" }).where(eq(shopSettings.key, key));
  } else {
    await d.insert(shopSettings).values({ key, value, label, category: "general", updatedBy: "system" });
  }
}

export async function processPromptEvolutionWeekly(now: Date = new Date()): Promise<ProcessResult> {
  const day = now.toLocaleString("en-US", { timeZone: "America/New_York", weekday: "long" });
  if (day !== "Monday") {
    return { recordsProcessed: 0, details: "Skipped · not Monday (weekly cadence)" };
  }

  const { runPromptEvolution } = await import("../../services/promptEvolution");
  // 30 seeds -> ~12 on the holdout (40% hash split). At 12 the paired sign
  // test can accept a candidate that fixes 5 calls and breaks none; the old
  // 12-seed run left ~5, where only a clean 5-for-5 sweep could ever pass.
  // ~125 replays; the job's own 30-minute budget (scheduler.ts) covers it.
  const result = await runPromptEvolution({
    seedCount: 30,
    candidates: 2,
    holdoutRepeats: 3,
    log: (l) => log.info(`[evolve] ${l}`),
  });
  // The verdict, as one structured line. Until 2026-10-08 a normal run logged
  // nothing — the 10-05 run's 118s showed in Railway with no outcome at all.
  log.info("[evolve] result", {
    outcome: result.outcome,
    usableSeeds: result.usableSeeds,
    trainCount: result.trainCount,
    holdoutCount: result.holdoutCount,
    baselineTrain: result.baselineTrain,
    baselineHoldout: result.baselineHoldout,
    candidates: result.candidateSummaries.length,
    gate: result.gate ? describeVerdict(result.gate) : null,
  });

  await setKv(
    "prompt_evolution_latest",
    JSON.stringify({
      ranAt: now.toISOString(),
      promotionStage: result.outcome === "accepted" ? "offline_candidate" : "none",
      businessOutcomeEvidence: "not_measured_candidate_has_not_served",
      ...result,
    }),
    "Prompt evolution — latest weekly result (propose-only)",
  );

  const summary = [
    `PROMPT EVOLUTION (weekly · propose-only)`,
    `Seeds: ${result.usableSeeds} real failed calls (train ${result.trainCount} / holdout ${result.holdoutCount})`,
    `Baseline: train ${result.baselineTrain} · holdout ${result.baselineHoldout}`,
    result.outcome === "accepted"
      ? `OFFLINE CANDIDATE passed the paired holdout permutation test (${result.accepted?.holdout}): ${result.accepted?.rationale.slice(0, 200)}\nThis is NOT a production/business winner: the candidate has not served customers, so arrival/revenue impact is unmeasured. Full candidate prompt saved to shop settings key prompt_evolution_latest. Applying it stays your call: edit + Push Config.`
      : `No proposal shipped — outcome: ${result.outcome}. The gate held; negative feedback recorded in the result.${result.gate ? `\nHoldout: ${describeVerdict(result.gate)}` : ""}`,
  ].join("\n");
  const { sendTelegram } = await import("../../services/telegram");
  await sendTelegram(summary).catch(() => undefined);

  return {
    recordsProcessed: result.outcome === "accepted" ? 1 : 0,
    details: `outcome: ${result.outcome} · baseline ${result.baselineTrain}/${result.baselineHoldout} · ${result.candidateSummaries.length} candidates${result.gate ? ` · gate ${result.gate.reason} +${result.gate.improved}/-${result.gate.worsened} p=${result.gate.pValue.toFixed(3)}` : ""}`,
  };
}
