/**
 * Prepare a reel brief that PASSES the deterministic M10 preflight before any
 * spend — regenerating on a block instead of failing the whole run.
 *
 * Why: `generateReelBriefAI` is non-deterministic and occasionally emits a brief
 * that trips the preflight (a beat that depends on rendered in-frame text/brand,
 * or a "free" claim). `enqueueReelJob` re-runs the preflight and THROWS on a
 * block — fine for a caller that can retry, but the autonomous daily cron
 * generates exactly once, so a single bad brief silently costs the day's reel.
 * This loop regenerates up to `maxAttempts` times and only attaches the
 * autonomous visual world (which spends a hero-frame image credit) + builds the
 * prompt pack for a brief that already passed preflight — so rejected briefs
 * cost nothing but an LLM call.
 *
 * Surfaced by the CC2 live-render drive (job 720002 chain): two of the first
 * three generations preflight-blocked on in-frame-text before a clean one landed.
 */
import { generateReelBriefAI, type GenerateReelBriefInput } from "./reelBriefGen";
import { attachAutonomousVisualWorld } from "./visualWorld";
import { buildHiggsfieldReelPromptPack, buildRepetitionChecks } from "../../client/src/lib/facelessReelStudio";
import { briefEnqueueRefusals } from "./reelEnqueueRefusals";
import { DEFAULT_REPETITION_WINDOW_DAYS, getRecentReelSignals } from "./reelRepetitionHistory";
import { saturatedHookGrammar } from "../../shared/reelHookGrammar";
import { createLogger } from "../lib/logger";
import type { RealAssetRef } from "../../shared/reelJobPayload";

const log = createLogger("reel-draft-prep");

/**
 * Thrown ONLY when every generation attempt produced a brief the deterministic
 * M10 preflight blocked. Callers (e.g. the daily cron) may deliberately skip on
 * THIS error — but must let any other failure (provider outage, parse error,
 * auth, timeout, DB) propagate, so a broken generator can't masquerade as a
 * normal "no reel today" idle result.
 */
export class PreflightExhaustedError extends Error {
  readonly rejected: string[][];
  constructor(message: string, rejected: string[][]) {
    super(message);
    this.name = "PreflightExhaustedError";
    this.rejected = rejected;
  }
}

/**
 * The generator's brief plus the real-asset reference §K.3 attaches. The
 * brief is JSON.stringify'd whole into reel_jobs.payload at enqueue, so the
 * field persists; `ReelJobPayloadView.realAsset` is its typed read-back.
 */
type ReelBrief = Awaited<ReturnType<typeof generateReelBriefAI>>["brief"] & { realAsset?: RealAssetRef };

/**
 * Ask the real-shop pool for this brief's subject. Never throws and never
 * blocks the brief: a reel without a real asset is the pre-§K status quo,
 * while a lookup ERROR is logged as such so it is not mistaken for "none".
 */
async function lookupRealAssetForBrief(brief: ReelBrief): Promise<RealAssetRef | null> {
  try {
    const { findRealAssetFor, toRealAssetRef } = await import("./realAssetFirst");
    const lookup = await findRealAssetFor({ topic: brief.topic, symptoms: [brief.driverConfusion, brief.mechanicTruth] });
    if (lookup.state === "matched") {
      log.info("real shop asset attached to reel brief", { assetId: lookup.match.assetId, score: lookup.match.score, why: lookup.why });
      return toRealAssetRef(lookup.match);
    }
    log.info("no real shop asset for reel brief", { state: lookup.state, why: lookup.why, ...("error" in lookup ? { error: lookup.error } : {}) });
    return null;
  } catch (err) {
    log.warn("real asset lookup threw — brief continues without one", { error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

export interface PreparedReelBrief {
  brief: ReelBrief;
  /** 1-based attempt number that produced the clean brief. */
  attempts: number;
  /** Blocking messages for each preflight-rejected attempt, in order. */
  rejectedForPreflight: string[][];
}

export async function prepareCleanReelBrief(
  input: GenerateReelBriefInput,
  opts: { maxAttempts?: number } = {},
): Promise<PreparedReelBrief> {
  const maxAttempts = Math.max(1, opts.maxAttempts ?? 3);
  const rejected: string[][] = [];

  // Real memory, not a hopeful prompt instruction: feed the model what NOT to
  // pick, and independently verify the topic it picked anyway (ScanFinish
  // NT-010). A caller-supplied avoidTopics wins — it usually means "operator
  // is intentionally steering," which real history should not override.
  const recent = await getRecentReelSignals();

  // Pattern Lab, connected. The lab may contain operator-captured references
  // or explicitly UNMEASURED Nick's house hypotheses when production started
  // empty. Selection rotates until a measured cohort matures, then uses the
  // outcome learner as a prior while retaining exploration. A null hint still
  // leaves the brief exactly as it was before Pattern Lab existed.
  const { pickStructureHint, recordStructureUse } = await import("./reelStructurePrior");
  // No hook-type EXCLUSION on the structure pick: rotation by least-used
  // already spreads the lab's hook types. The opening line's measured shape
  // is steered separately below (hookFatigue), from what actually shipped.
  const structure = await pickStructureHint();
  // HOOK FATIGUE: RecentReelSignals has recorded each Reel's beat-1 grammar
  // since 2026-10-01 and nothing read it back. When one shape opened most of
  // the recent window, the generator is told so (shared/reelHookGrammar.ts).
  // An unreadable history steers nothing.
  const hookFatigue = recent.available === false ? null : saturatedHookGrammar(recent.hookGrammars);
  // TWO CHANNELS, because they mean different things.
  //
  // `avoidTopics` keeps its original contract: an operator-supplied list WINS
  // over real history, because it usually means "the operator is intentionally
  // steering" and history should not fight a human. A test pins that on purpose.
  //
  // `additionalAvoidTopics` is the machine channel and is ALWAYS merged. It
  // exists because dailyReelPost now passes topics already covered by committed
  // packs, and routing those through `avoidTopics` would have silently dropped
  // the entire reel_jobs history from the model's steer the moment any pack
  // existed — exact repeats would still be caught after generation, but the
  // preventive signal would vanish, so the cron could burn all six attempts or
  // produce a semantic near-repeat that exact matching never catches.
  // Pack awareness must ADD a constraint, never remove one.
  const steer = input.avoidTopics && input.avoidTopics.length > 0 ? input.avoidTopics : recent.topics;
  const baseAvoidTopics = [...new Set([...steer, ...(input.additionalAvoidTopics ?? [])])];
  // Grows across attempts (self-review, 2026-08-13): a caller that pins a
  // FIXED topic seed already present in history (the admin canary's static
  // default, or dailyReelPost.ts's manifest fallback) asked the model to
  // "use topic X" and "avoid topic X" identically on every retry — wasting
  // the whole attempt budget on the same collision instead of ever getting
  // real divergence. Once a generated topic is caught as a repeat, it joins
  // the avoid-list for every remaining attempt.
  const avoidTopics = [...baseAvoidTopics];
  let repetitionOnlyRejections = 0;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const { brief } = await generateReelBriefAI({
      ...input,
      avoidTopics,
      ...(structure ? { structureHint: structure } : {}),
      ...(hookFatigue ? { hookFatigue } : {}),
    });
    // Everything enqueue would refuse from the brief alone, not only the
    // preflight (2026-10-08): the condemned-script check, a placeholder beat and
    // the caption limit are typed refusals at enqueue too, and one of those
    // used to cost the day instead of a regeneration here.
    const refusals = briefEnqueueRefusals(brief);
    const repetition = buildRepetitionChecks(brief, recent);
    if (!refusals.length && !repetition.topicRepeated) {
      // Clean brief. Attach the visual world + build the prompt pack ONLY now, so
      // a preflight-rejected brief never spends a hero-frame image credit.
      await attachAutonomousVisualWorld(brief);
      brief.higgsfieldPromptPack = buildHiggsfieldReelPromptPack(brief);
      // Stamp the pattern onto the brief so it reaches reel_jobs.payload. This
      // is the cohort key the schema was shaped for ("pattern x trial results")
      // and never got — without it, no later pass can ask which captured
      // structure actually earned distribution. Recorded only now, after
      // preflight: counting rejected attempts would rotate the lab on work that
      // never shipped and starve the genuinely unused patterns.
      if (structure) {
        brief.structurePatternId = structure.patternId;
        await recordStructureUse(structure.patternId);
      }
      // §K.3 — a real shop photo of this brief's subject, when the pool has
      // one. Attached after preflight so a rejected brief never pays the read.
      const prepared: ReelBrief = brief;
      const realAsset = await lookupRealAssetForBrief(prepared);
      if (realAsset) prepared.realAsset = realAsset;
      if (attempt > 1) {
        log.info(`clean reel brief on attempt ${attempt}/${maxAttempts} after ${rejected.length} rejection(s)`);
      }
      return { brief: prepared, attempts: attempt, rejectedForPreflight: rejected };
    }
    const blocking = [...refusals];
    if (repetition.topicRepeated) {
      blocking.push(`topic repeats a reel from the last ${DEFAULT_REPETITION_WINDOW_DAYS} days: "${brief.topic}"`);
      if (!refusals.length) repetitionOnlyRejections++;
      if (!avoidTopics.includes(brief.topic)) avoidTopics.push(brief.topic);
    }
    rejected.push(blocking);
    log.warn(`reel brief rejected (attempt ${attempt}/${maxAttempts}) — regenerating`, { blocking });
  }

  // Distinguishable in cron_log from a real M10 preflight defect (the
  // existing "all briefs preflight-blocked" caller message) — a run where
  // every rejection was repetition-only means the generator is healthy and
  // the topic pool is just thin, not that a defective brief shape is
  // shipping. Same disclosure discipline as topicOrigin.
  const cause = repetitionOnlyRejections === rejected.length ? "topic repetition only, no preflight defect" : "preflight and/or topic repetition";
  throw new PreflightExhaustedError(
    `reel brief blocked on all ${maxAttempts} attempts (${cause}): ` +
      rejected.map((b, i) => `#${i + 1}[${b.join("; ")}]`).join(" "),
    rejected,
  );
}
