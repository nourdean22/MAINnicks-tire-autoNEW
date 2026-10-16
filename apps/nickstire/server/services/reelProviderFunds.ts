import type { ClipModel } from "./higgsfieldStudio";

/**
 * Does the paid video provider hold enough credits for one more reel?
 *
 * Production, 2026-10-16: Higgsfield held 29.5 credits. Job 2100001 rendered 2
 * clips, failed on the third with not_enough_credits, and burned an approved
 * pack. The daily cron asks this BEFORE it builds a brief, reserves, or moves
 * the rotation cursor, so a dry balance holds the lane instead of spending a
 * pack per pulse.
 *
 * Only a KNOWN shortfall holds. An unreadable balance, another provider or an
 * unpriced model returns null: missing evidence is UNKNOWN, never "no funds".
 */

/** Credits per 4 s clip, measured (higgsfieldStudio.ts CLIP_MODELS doc block). Kling is unmeasured, so absent. */
export const CLIP_CREDITS_PER_BEAT: Partial<Record<ClipModel, number>> = { seedance1_5: 12, seedance_2_5: 26 };

/** The brief does not exist yet when the gate runs; every reel since 2026-10-09 has had 5 beats. */
export const DEFAULT_REEL_BEATS = 5;

export type ProviderFundsHold = { needed: number; balance: number; model: ClipModel };

export function providerFundsHold(input: {
  provider: string;
  model: ClipModel;
  balanceCredits: number | null;
  beats?: number;
}): ProviderFundsHold | null {
  if (input.provider !== "higgsfield") return null;
  const balance = input.balanceCredits;
  if (balance === null || !Number.isFinite(balance)) return null;
  const price = CLIP_CREDITS_PER_BEAT[input.model];
  if (price === undefined) return null;
  const needed = (input.beats ?? DEFAULT_REEL_BEATS) * price;
  return balance < needed ? { needed, balance, model: input.model } : null;
}

/**
 * Reads the active provider, clip model and the keepalive's last balance (one
 * indexed cron_log read, no CLI spawn). Never throws: a failed read is
 * `unknown: true`, and the caller logs it and carries on without holding.
 */
export async function readProviderFundsHold(): Promise<{ hold: ProviderFundsHold | null; unknown: boolean; detail: string }> {
  try {
    const { selectReelVideoProvider } = await import("./reelPipeline");
    const provider = await selectReelVideoProvider();
    if (provider !== "higgsfield") {
      return { hold: null, unknown: false, detail: `provider ${provider}: no credit balance to check` };
    }
    const { resolveClipModel, higgsfieldSessionLiveness } = await import("./higgsfieldStudio");
    const model = resolveClipModel();
    const liveness = await higgsfieldSessionLiveness();
    // live === null means the keepalive verdict is missing, stale or untested:
    // its balance may predate a top-up, so it is UNKNOWN, not a reason to hold.
    if (liveness.live === null || liveness.balanceCredits === null || !Number.isFinite(liveness.balanceCredits)) {
      return { hold: null, unknown: true, detail: `higgsfield credit balance UNKNOWN (${liveness.reason}); not holding` };
    }
    const hold = providerFundsHold({ provider, model, balanceCredits: liveness.balanceCredits });
    const detail = hold
      ? `higgsfield has ${hold.balance} credits; a ${DEFAULT_REEL_BEATS}-beat ${model} reel needs about ${hold.needed}`
      : CLIP_CREDITS_PER_BEAT[model] === undefined
        ? `higgsfield has ${liveness.balanceCredits} credits; ${model} has no measured price, not holding`
        : `higgsfield has ${liveness.balanceCredits} credits; enough for a ${DEFAULT_REEL_BEATS}-beat ${model} reel`;
    return { hold, unknown: false, detail };
  } catch (err) {
    return {
      hold: null,
      unknown: true,
      detail: `credit balance read failed (${err instanceof Error ? err.message : String(err)}); not holding`,
    };
  }
}
