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
import { buildHiggsfieldReelPromptPack, buildRepetitionChecks, runReelPreflight } from "../../client/src/lib/facelessReelStudio";
import { DEFAULT_REPETITION_WINDOW_DAYS, getRecentReelSignals } from "./reelRepetitionHistory";
import { createLogger } from "../lib/logger";

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

type ReelBrief = Awaited<ReturnType<typeof generateReelBriefAI>>["brief"];

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

  // Pattern Lab, connected. `social_reel_patterns` captured operator-judged
  // structure since migration 0107 and nothing outside the admin CRUD screen
  // ever read it — patterns went in and never came out. Selection is by
  // rotation, not ranking, because no pattern -> outcome link exists yet; the
  // recording below is what creates it. A null hint leaves the brief exactly as
  // it was before this existed.
  const { pickStructureHint, recordStructureUse } = await import("./reelStructurePrior");
  // No hook-type exclusion: RecentReelSignals tracks topics/keywords/archetypes/
  // lenses/characters, not hook shape, and inventing a field here would mean
  // passing something the repetition ledger never actually measured. Rotation
  // by least-used already spreads hook types in practice.
  const structure = await pickStructureHint();
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
    });
    const pre = runReelPreflight(brief);
    const repetition = buildRepetitionChecks(brief, recent);
    if (pre.status !== "block" && !repetition.topicRepeated) {
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
      if (attempt > 1) {
        log.info(`clean reel brief on attempt ${attempt}/${maxAttempts} after ${rejected.length} rejection(s)`);
      }
      return { brief, attempts: attempt, rejectedForPreflight: rejected };
    }
    const blocking = pre.status === "block" ? pre.blocking.map((f) => f.message) : [];
    if (repetition.topicRepeated) {
      blocking.push(`topic repeats a reel from the last ${DEFAULT_REPETITION_WINDOW_DAYS} days: "${brief.topic}"`);
      if (pre.status !== "block") repetitionOnlyRejections++;
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
