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
 * never reads the six quiet days as dormancy). The gate binds the SCHEDULED
 * trigger only: a manual run (services/promptEvolutionManualRun.ts, behind the
 * admin session and the admin API key) passes `trigger: "manual"` and runs the
 * same cycle on any day, under the same cross-dyno lock and budget. The row,
 * the Telegram header and the cron_log details all name the trigger, so a
 * Thursday receipt is never mistaken for the Monday cadence.
 *
 * WIRED 2026-10-09 (autoresearch audit). In run order:
 *  1. READS. shop_settings key prompt_evolution_confirmation_consumed (the
 *     sealed confirmation seeds earlier runs spent) and the previous
 *     prompt_evolution_latest row. A DB error on the consumed list fails the
 *     run: re-reading a sealed seed is the one mistake this list exists to
 *     prevent. A list that reads but does not parse is treated as "every
 *     confirm seed is spent" for this run (confirmation does not run) and is
 *     left untouched for the operator.
 *  2. BASELINE. resolveLiveReceptionistBaseline(): the prompt callers hear,
 *     from the assistant that answers the line. A refusal THROWS and the cron
 *     run fails loudly; it never falls back to the repository prompt.
 *  3. RUN, with a 45-minute budget (the scheduler kills the job at 50,
 *     scheduler.ts prompt-evolution-weekly timeoutMs). Past it the runner
 *     returns "inconclusive-budget" and this job still reports. The sealed
 *     confirmation seeds are written to the consumed list (newest first,
 *     capped at CONSUMED_CAP) by the runner's onConfirmationSpend hook,
 *     BEFORE the first of them is replayed: a run that throws or is killed
 *     mid-confirmation still leaves them spent (2026-10-09 review: the list
 *     used to be written only from a returned result, so a lane error lost it
 *     and the next week re-read the seeds as sealed).
 *  4. WRITES, integrity first: any spent seed the hook did not record, then
 *     the Reality Ledger receipt (best-effort, never fails the run), then
 *     prompt_evolution_latest, then Telegram.
 * prompt_evolution_latest is a POINTER to the latest run, overwritten weekly:
 * the result (hashes, gates, the proposal and its line diff, for the operator
 * to apply) plus the receipt's experimentId. The receipt is the durable,
 * redacted history; this row is the one place the full candidate prompt
 * lives, so it is kept under its TEXT column (latestRowJson). Logs and
 * Telegram carry hashes, never prompt text or caller text.
 */
import { eq } from "drizzle-orm";
import { shopSettings } from "../../../drizzle/schema";
import { createLogger } from "../../lib/logger";
import { redactCallerText } from "../../services/callerTextRedaction";
import type { EvolutionResult } from "../../services/promptEvolution";
import { describeSuccessVerdict, describeVerdict } from "../../services/promptEvolutionGate";
import {
  buildPromptEvolutionReceipt,
  classifyPreviousProposal,
  postPromptEvolutionReceipt,
  type PreviousProposalStatus,
  type PromptEvolutionReceipt,
  type PromptEvolutionReceiptInput,
} from "../../services/promptEvolutionReceipt";

const log = createLogger("cron:prompt-evolution");

const LATEST_KEY = "prompt_evolution_latest";
const CONSUMED_KEY = "prompt_evolution_confirmation_consumed";
const CONSUMED_LABEL = "Prompt evolution — sealed confirmation seeds already spent (never re-read)";
/** Consumed ids kept, newest first. Far beyond the failed-call pool a run reads (seedCount * 3 rows). */
const CONSUMED_CAP = 500;
/**
 * The runner stops itself here; the scheduler kills the job at 50 minutes
 * (scheduler.ts) and the manual door races it against the same 50
 * (promptEvolutionManualRun.ts). Measured 2026-10-09 on the Ollama lane: a
 * replay plus its judge call averages ~20 s, and a cycle that reaches the
 * sealed set replays ~170 times (train 13+14, holdout 12+13x3 repeats x2
 * arms, confirmation 8x3x2). At two seeds at a time that is ~30 minutes; the
 * old 25-minute budget could never finish a cycle whose candidate passed the
 * guard, and the 22:54Z run proved it.
 */
const RUN_BUDGET_MS = 45 * 60 * 1000;
/** The receipt's own rationale cap. */
const RATIONALE_MAX = 400;
/**
 * shop_settings.value is TEXT: 65,535 bytes, and an over-long write is
 * REJECTED (2026-10-09 review). By then the receipt is posted and the sealed
 * seeds are spent, so a rejected row loses the candidate and the Telegram.
 * The row keeps this much room under the column; see latestRowJson.
 */
const LATEST_MAX_BYTES = 60_000;

interface ProcessResult {
  recordsProcessed: number;
  details: string;
}

/** Who started this run. The scheduler never passes one; the manual door passes "manual". */
export type PromptEvolutionTrigger = "scheduled" | "manual";

export interface PromptEvolutionRunOptions {
  trigger?: PromptEvolutionTrigger;
}

async function getKv(key: string): Promise<string | null> {
  const { getDb } = await import("../../db");
  const d = await getDb();
  if (!d) return null;
  const rows = await d.select().from(shopSettings).where(eq(shopSettings.key, key)).limit(1);
  return rows[0]?.value ?? null;
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

/** The consumed list: [] when the key does not exist yet, null when it exists and is not a list of ids. */
function parseConsumed(raw: string | null): string[] | null {
  if (raw === null) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.every((id) => typeof id === "string") ? parsed : null;
  } catch {
    return null;
  }
}

/** This run's ids first, then the earlier list without them, capped. */
function mergeConsumed(spent: readonly string[], before: readonly string[]): string[] {
  const fresh = new Set(spent);
  return [...spent, ...before.filter((id) => !fresh.has(id))].slice(0, CONSUMED_CAP);
}

/**
 * The previous run's PROPOSED candidate hash. Rows written before 2026-10-09
 * carry accepted.prompt but no hash; it is hashed the same way here, so the
 * first wired run can still tell whether last week's proposal went live.
 */
function previousCandidateHash(raw: string | null, hashOf: (prompt: string) => string): string | null {
  if (!raw) return null;
  try {
    const prev = JSON.parse(raw) as { accepted?: { promptHash?: unknown; prompt?: unknown } | null };
    if (typeof prev.accepted?.promptHash === "string" && prev.accepted.promptHash) return prev.accepted.promptHash;
    if (typeof prev.accepted?.prompt === "string" && prev.accepted.prompt) return hashOf(prev.accepted.prompt);
  } catch {
    // An unreadable row proposes nothing we can compare.
  }
  return null;
}

/** EvolutionResult -> the receipt's input, field by field (the receipt copies by name, never a whole object). */
function receiptInputOf(
  result: EvolutionResult,
  runAt: Date,
  previous: { candidatePromptHash: string | null; status: PreviousProposalStatus },
): PromptEvolutionReceiptInput {
  const s = result.gates.success;
  return {
    runAt: runAt.toISOString(),
    baseline: {
      source: result.baseline.source,
      assistantId: result.baseline.assistantId,
      promptHash: result.baseline.promptHash,
      providerBehaviorHash: result.baseline.providerBehaviorHash,
      parity: result.baseline.parity,
    },
    candidate: result.candidate,
    redact: (text) => redactCallerText(text, RATIONALE_MAX),
    lanes: { live: result.lanes.live, replay: result.lanes.replay, parity: result.lanes.parity, differences: result.lanes.differences },
    cohorts: { train: result.cohorts.train, holdout: result.cohorts.holdout, confirm: result.cohorts.confirm, success: result.cohorts.success },
    candidates: {
      proposed: result.candidateSummaries.length,
      trainScored: result.candidateSummaries.filter((c) => c.train !== "unscored").length,
    },
    exclusions: { unresolvable: result.exclusions.unresolvable, evaluatorUnavailable: result.exclusions.evaluatorUnavailable },
    gates: {
      holdout: result.gates.holdout,
      // The success verdict's p is the degradation test's.
      success: s
        ? { reason: s.reason, pValue: s.pDegraded, bestPossibleP: s.bestPossibleP, comparable: s.comparable, improved: s.improved, worsened: s.worsened, tied: s.tied }
        : null,
      confirmation: result.gates.confirmation,
    },
    outcome: result.outcome,
    promotionStage: result.promotionStage,
    evaluator: result.evaluator,
    usage: { durationMs: result.usage.durationMs, replays: result.usage.replays, judgeCalls: result.usage.judgeCalls },
    previousProposal: previous,
  };
}

/**
 * The prompt_evolution_latest row, kept under LATEST_MAX_BYTES. The runner
 * already caps the diff (promptEvolution.ts DIFF_MAX_CHARS); this covers a
 * served prompt that has grown since. What gives way is the diff's line
 * bodies (its counts, start line and codeEdit stay, truncated reads true),
 * never the candidate: the operator can diff accepted.prompt again, but cannot
 * recover a candidate that was not stored. A row still over budget after that
 * is written as is: it lands if it fits the column, and fails the run loudly
 * if it does not.
 */
function latestRowJson(row: Record<string, unknown> & { candidateDiff: EvolutionResult["candidateDiff"] }): string {
  const json = JSON.stringify(row);
  const bytes = Buffer.byteLength(json, "utf8");
  if (bytes <= LATEST_MAX_BYTES || !row.candidateDiff) return json;
  const slim = JSON.stringify({ ...row, candidateDiff: { ...row.candidateDiff, removed: [], added: [], truncated: true } });
  log.warn("[evolve] latest row over its byte budget; candidate diff lines dropped (counts and the full candidate kept)", {
    bytes,
    after: Buffer.byteLength(slim, "utf8"),
    limit: LATEST_MAX_BYTES,
  });
  return slim;
}

const short = (id: string | null | undefined): string => (id ? id.slice(0, 8) : "none");
const clip = (s: string, max: number): string => (s.length <= max ? s : `${s.slice(0, max - 3)}...`);

/** The outcome paragraph. Hashes and gate statistics only: no prompt text, no caller text. */
function outcomeLines(result: EvolutionResult): string[] {
  const minutes = Math.round(RUN_BUDGET_MS / 60000);
  if (result.accepted) {
    const a = result.accepted;
    const diff = result.candidateDiff ? ` and its line diff (${result.candidateDiff.removedCount} removed / ${result.candidateDiff.addedCount} added lines)` : "";
    // The measured text is the live prompt, lessons block included; an edit
    // in or after that block cannot be applied as a code edit verbatim.
    const placement = result.candidateDiff?.codeEdit === false
      ? " CAUTION: the edit changes or follows the learned-lessons block, so applied as a code edit it would sit before the lessons and Push Config would serve a different text from the one measured."
      : "";
    const confirmed = a.confirmed
      ? "held on the won-call success cohort and was CONFIRMED on the sealed set"
      : result.gates.confirmation
        ? "held on the won-call success cohort, but is UNCONFIRMED: the sealed set could not reach significance"
        : `held on the won-call success cohort, but is UNCONFIRMED: ${result.cohorts.confirm} sealed seed(s) available, ${result.cohorts.confirmNeeded} needed, so confirmation did not run`;
    return [
      `OFFLINE CANDIDATE passed the paired holdout permutation test (${a.holdout}), ${confirmed}. Candidate ${short(a.promptHash)}: ${a.rationale.slice(0, 200)}`,
      `This is NOT a production/business winner: the candidate has not served customers, so arrival/revenue impact is unmeasured. Full candidate prompt${diff} saved to shop settings key prompt_evolution_latest. Applying it stays your call: edit + Push Config.${placement}`,
    ];
  }
  const head = `No proposal shipped — outcome: ${result.outcome}.`;
  switch (result.outcome) {
    case "invalid-evaluator":
      return [`${head} The judge lane was unavailable on too much of the evidence: this run measured nothing and refuted nothing.`];
    case "inconclusive-budget":
      return [`${head} The run stopped at its ${minutes}-minute budget before stage ${result.budget.exhaustedAt ?? "?"}; what it measured is recorded, nothing was decided.`];
    case "baseline-clean":
      return [`${head} The live prompt passed every train call, so there was nothing to fix.`];
    case "no-candidates":
      return [`${head} The optimizer returned no usable candidate prompt.`];
    default:
      return [`${head} The gate held; negative feedback recorded in the result.`];
  }
}

function telegramSummary(
  result: EvolutionResult,
  ctx: { experimentId: string | null; receiptDelivered: boolean; previousStatus: PreviousProposalStatus; trigger: PromptEvolutionTrigger },
): string {
  const b = result.baseline;
  const baselineLine =
    b.source === "repository"
      ? `Baseline: REPOSITORY prompt ${short(b.promptHash)}, NOT the prompt callers hear.`
      : `Baseline: live prompt ${short(b.promptHash)} on assistant ${short(b.assistantId)} (${b.parity})${b.parity === "diverged" ? "; the live prompt has diverged from the repository prompt, so applying a proposal means reconciling the two first" : ""}.`;
  const laneLine = result.lanes.parity
    ? "Lane: the replay matches the live lane."
    : `Lane: proxy lane. The replay differs from the live lane in ${result.lanes.differences.length} way(s): ${clip(result.lanes.differences.join("; "), 300)}`;
  const c = result.cohorts;
  const consumed = result.exclusions.consumedListUnknown
    ? ", confirmation disabled: the consumed-seed list did not parse"
    : result.exclusions.consumedConfirmation
      ? `, ${result.exclusions.consumedConfirmation} already consumed`
      : "";
  const gateLines = [
    result.gates.holdout ? `Holdout: ${describeVerdict(result.gates.holdout)}` : null,
    result.gates.success ? `Success cohort: ${describeSuccessVerdict(result.gates.success)}` : null,
    result.gates.confirmation ? `Confirmation: ${describeVerdict(result.gates.confirmation)}` : null,
  ].filter((l): l is string => l !== null);
  const previous =
    ctx.previousStatus === "applied" ? "applied (the live prompt is that candidate, verbatim)"
      : ctx.previousStatus === "not_applied" ? "not live verbatim"
        : "unknown";
  const u = result.usage;
  return [
    `PROMPT EVOLUTION (${ctx.trigger === "manual" ? "manual run" : "weekly"} · propose-only)`,
    `Offline evidence only (H2); not served to customers.`,
    baselineLine,
    laneLine,
    `Seeds: ${result.usableSeeds} real failed calls (train ${result.trainCount} / holdout ${result.holdoutCount} / confirm ${c.confirm}${consumed}) · success cohort ${c.success} won calls`,
    `Baseline: train ${result.baselineTrain} · holdout ${result.baselineHoldout}`,
    ...outcomeLines(result),
    ...gateLines,
    `Previous proposal: ${previous}.`,
    ctx.experimentId
      ? `Ledger receipt ${ctx.experimentId}: ${ctx.receiptDelivered ? "recorded" : "NOT recorded (best-effort; see logs)"}.`
      : "Ledger receipt: not built (see logs).",
    `Cost: ${u.replays} replays · ${u.judgeCalls} judge calls · ${u.optimizerCalls} optimizer calls · ${Math.round(u.durationMs / 1000)}s`,
  ].join("\n");
}

export async function processPromptEvolutionWeekly(now: Date = new Date(), options: PromptEvolutionRunOptions = {}): Promise<ProcessResult> {
  const trigger: PromptEvolutionTrigger = options.trigger ?? "scheduled";
  const day = now.toLocaleString("en-US", { timeZone: "America/New_York", weekday: "long" });
  if (trigger === "scheduled" && day !== "Monday") {
    return { recordsProcessed: 0, details: "Skipped · not Monday (weekly cadence)" };
  }
  if (trigger === "manual") log.info("[evolve] manual run requested", { day });

  // 1 · Reads. A DB error on the consumed list propagates: the run fails.
  const consumedBefore = parseConsumed(await getKv(CONSUMED_KEY));
  if (consumedBefore === null) {
    log.warn("[evolve] consumed confirmation list does not parse; confirmation will not run and the key is left as is", { key: CONSUMED_KEY });
  }
  let previousRaw: string | null = null;
  try {
    previousRaw = await getKv(LATEST_KEY);
  } catch (err) {
    log.warn("[evolve] previous result unreadable; previous proposal status will be unknown", { error: err instanceof Error ? err.message : String(err) });
  }

  // 2 · The prompt callers hear. A refusal throws: a failed cron run, never a guess.
  const { resolveLiveReceptionistBaseline } = await import("../../services/receptionistBaseline");
  const baseline = await resolveLiveReceptionistBaseline();

  // Spent sealed seeds, merged into the list as read at the start of the run.
  // An unparseable list (null) is never overwritten: the runner treats every
  // confirm seed as spent then, so nothing is read and nothing needs recording.
  let persistedSpend: readonly string[] = [];
  const persistSpend = async (ids: readonly string[]): Promise<void> => {
    if (consumedBefore === null || !ids.length) return;
    await setKv(CONSUMED_KEY, JSON.stringify(mergeConsumed(ids, consumedBefore)), CONSUMED_LABEL);
    persistedSpend = [...ids];
  };

  // 3 · The run. 30 seeds -> ~12 holdout / ~12 train (hash split), with the
  // sealed set read from a larger pool by the runner. At 12 the paired sign
  // test can accept a candidate that fixes 5 calls and breaks none.
  const { runPromptEvolution, promptHashOf } = await import("../../services/promptEvolution");
  const result = await runPromptEvolution({
    baseline,
    seedCount: 30,
    candidates: 2,
    holdoutRepeats: 3,
    // Two seeds at a time: Ollama Pro serves three cloud models at once and the
    // scheduler keeps one slot free for P0/P1 traffic.
    replayConcurrency: 2,
    consumedConfirmationIds: consumedBefore,
    // Write-ahead: recorded before the first sealed replay, so a throw or a
    // scheduler kill mid-confirmation cannot leave a read seed looking sealed.
    onConfirmationSpend: persistSpend,
    deadlineMs: RUN_BUDGET_MS,
    log: (l) => log.info(`[evolve] ${l}`),
  });

  const previousHash = previousCandidateHash(previousRaw, promptHashOf);
  const previousStatus = classifyPreviousProposal({ candidatePromptHash: previousHash }, result.baseline.promptHash);

  let receipt: PromptEvolutionReceipt | null = null;
  try {
    receipt = buildPromptEvolutionReceipt(receiptInputOf(result, now, { candidatePromptHash: previousHash, status: previousStatus }));
  } catch (err) {
    log.warn("[evolve] receipt not built", { error: err instanceof Error ? err.message : String(err) });
  }

  // The verdict, as one structured line. Until 2026-10-08 a normal run logged
  // nothing — the 10-05 run's 118s showed in Railway with no outcome at all.
  // Hashes and counts only: no prompt text, no caller text.
  log.info("[evolve] result", {
    outcome: result.outcome,
    promotionStage: result.promotionStage,
    usableSeeds: result.usableSeeds,
    trainCount: result.trainCount,
    holdoutCount: result.holdoutCount,
    confirmCount: result.cohorts.confirm,
    successCount: result.cohorts.success,
    baselineTrain: result.baselineTrain,
    baselineHoldout: result.baselineHoldout,
    candidates: result.candidateSummaries.length,
    candidateHash: result.candidate?.promptHash ?? null,
    diff: result.candidateDiff
      ? { removed: result.candidateDiff.removedCount, added: result.candidateDiff.addedCount, codeEdit: result.candidateDiff.codeEdit }
      : null,
    gate: result.gate ? describeVerdict(result.gate) : null,
    success: result.gates.success ? describeSuccessVerdict(result.gates.success) : null,
    confirmation: result.gates.confirmation ? describeVerdict(result.gates.confirmation) : null,
    baseline: {
      source: result.baseline.source,
      assistantId: result.baseline.assistantId,
      promptHash: result.baseline.promptHash,
      providerBehaviorHash: result.baseline.providerBehaviorHash,
      parity: result.baseline.parity,
    },
    lanes: { parity: result.lanes.parity, differences: result.lanes.differences },
    exclusions: result.exclusions,
    usage: result.usage,
    budget: result.budget,
    experimentId: receipt?.experimentId ?? null,
    previousProposal: previousStatus,
    trigger,
  });

  // 4 · Writes, integrity first: a sealed seed this run read must never be
  // read again. The hook normally recorded them already; this catches any the
  // runner returned without handing to it.
  if (result.consumedConfirmationIds.some((id) => !persistedSpend.includes(id))) {
    await persistSpend(result.consumedConfirmationIds);
  }

  const receiptDelivered = receipt ? await postPromptEvolutionReceipt(receipt) : false;

  await setKv(
    LATEST_KEY,
    latestRowJson({
      ...result,
      ranAt: now.toISOString(),
      trigger,
      experimentId: receipt?.experimentId ?? null,
      receiptDelivered,
      evidenceGrade: "H2",
      businessOutcomeEvidence: "not_measured_candidate_has_not_served",
      previousProposal: { candidatePromptHash: previousHash, status: previousStatus },
    }),
    "Prompt evolution — latest weekly result (propose-only)",
  );

  const summary = telegramSummary(result, { experimentId: receipt?.experimentId ?? null, receiptDelivered, previousStatus, trigger });
  const { sendTelegram } = await import("../../services/telegram");
  await sendTelegram(summary).catch(() => undefined);

  const gate = result.gate;
  return {
    recordsProcessed: result.accepted ? 1 : 0,
    details:
      `outcome: ${result.outcome} · baseline ${result.baselineTrain}/${result.baselineHoldout} · ${result.candidateSummaries.length} candidates` +
      (gate ? ` · gate ${gate.reason} +${gate.improved}/-${gate.worsened} p=${gate.pValue.toFixed(3)}` : "") +
      (result.gates.success ? ` · success ${result.gates.success.reason}` : "") +
      (result.gates.confirmation ? ` · confirm ${result.gates.confirmation.reason}` : "") +
      ` · live ${short(result.baseline.promptHash)} ${result.baseline.parity}` +
      (result.lanes.parity ? "" : " · proxy lane") +
      (receipt ? ` · receipt ${receipt.experimentId}` : "") +
      (trigger === "manual" ? " · manual run" : ""),
  };
}
