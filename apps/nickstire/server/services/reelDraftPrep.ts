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
  const avoidTopics = input.avoidTopics && input.avoidTopics.length > 0 ? input.avoidTopics : recent.topics;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const { brief } = await generateReelBriefAI({ ...input, avoidTopics });
    const pre = runReelPreflight(brief);
    const repetition = buildRepetitionChecks(brief, recent);
    if (pre.status !== "block" && !repetition.topicRepeated) {
      // Clean brief. Attach the visual world + build the prompt pack ONLY now, so
      // a preflight-rejected brief never spends a hero-frame image credit.
      await attachAutonomousVisualWorld(brief);
      brief.higgsfieldPromptPack = buildHiggsfieldReelPromptPack(brief);
      if (attempt > 1) {
        log.info(`clean reel brief on attempt ${attempt}/${maxAttempts} after ${rejected.length} rejection(s)`);
      }
      return { brief, attempts: attempt, rejectedForPreflight: rejected };
    }
    const blocking = pre.status === "block" ? pre.blocking.map((f) => f.message) : [];
    if (repetition.topicRepeated) {
      blocking.push(`topic repeats a reel from the last ${DEFAULT_REPETITION_WINDOW_DAYS} days: "${brief.topic}"`);
    }
    rejected.push(blocking);
    log.warn(`reel brief rejected (attempt ${attempt}/${maxAttempts}) — regenerating`, { blocking });
  }

  throw new PreflightExhaustedError(
    `reel brief blocked on all ${maxAttempts} attempts (preflight or topic repetition): ` +
      rejected.map((b, i) => `#${i + 1}[${b.join("; ")}]`).join(" "),
    rejected,
  );
}
