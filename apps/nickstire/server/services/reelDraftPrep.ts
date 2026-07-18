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
import { buildHiggsfieldReelPromptPack, runReelPreflight } from "../../client/src/lib/facelessReelStudio";
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

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const { brief } = await generateReelBriefAI(input);
    const pre = runReelPreflight(brief);
    if (pre.status !== "block") {
      // Clean brief. Attach the visual world + build the prompt pack ONLY now, so
      // a preflight-rejected brief never spends a hero-frame image credit.
      await attachAutonomousVisualWorld(brief);
      brief.higgsfieldPromptPack = buildHiggsfieldReelPromptPack(brief);
      if (attempt > 1) {
        log.info(`clean reel brief on attempt ${attempt}/${maxAttempts} after ${rejected.length} preflight rejection(s)`);
      }
      return { brief, attempts: attempt, rejectedForPreflight: rejected };
    }
    const blocking = pre.blocking.map((f) => f.message);
    rejected.push(blocking);
    log.warn(`reel brief preflight BLOCKED (attempt ${attempt}/${maxAttempts}) — regenerating`, { blocking });
  }

  throw new PreflightExhaustedError(
    `reel brief preflight blocked on all ${maxAttempts} attempts: ` +
      rejected.map((b, i) => `#${i + 1}[${b.join("; ")}]`).join(" "),
    rejected,
  );
}
