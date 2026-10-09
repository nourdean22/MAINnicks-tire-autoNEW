import type { ProductionSlot } from "./episodeContract";

export const EPISODE_QUEUE_STATES = [
  "queued",
  "in_production",
  "production_ready",
  "qa_pending",
  "publish_ready",
  "scheduled",
  "publishing",
  "published",
  "blocked",
  "failed",
] as const;

export type EpisodeQueueState = (typeof EPISODE_QUEUE_STATES)[number];

/** Explicit ET production windows. Publishing remains separately gated. */
export const PRODUCTION_SLOT_WINDOWS: Readonly<Record<ProductionSlot, { startHour: number; endHour: number }>> = {
  morning: { startHour: 6, endHour: 11 },
  midday: { startHour: 12, endHour: 16 },
  evening: { startHour: 17, endHour: 23 },
};

export function productionSlotForHour(hour: number): ProductionSlot {
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    throw new Error(`invalid ET hour: ${hour}`);
  }
  if (hour < PRODUCTION_SLOT_WINDOWS.morning.startHour) {
    throw new Error(`no production slot for ET hour: ${hour}`);
  }
  if (hour <= PRODUCTION_SLOT_WINDOWS.morning.endHour) return "morning";
  if (hour <= PRODUCTION_SLOT_WINDOWS.midday.endHour) return "midday";
  return "evening";
}

/**
 * Analytics can legitimately select an overnight engagement hour, while the
 * production contract intentionally has no 00:00-05:00 slot. Move those
 * selections to the next supported morning boundary instead of making the
 * daily producer fail forever on an hour it can never satisfy.
 */
export function normalizeProductionTargetHour(hour: number): number {
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    throw new Error(`invalid ET target hour: ${hour}`);
  }
  return hour < PRODUCTION_SLOT_WINDOWS.morning.startHour ? PRODUCTION_SLOT_WINDOWS.morning.startHour : hour;
}

/**
 * A row counts toward READY only when its current asset and gate facts are usable.
 *
 * `skippedByDrain`: the publish drain refused this job on the same pulse (parked
 * rendered QA, caption repost, inventory hold, condemned script, approval
 * problem). A job the drain will not publish is not inventory. Without this the
 * READY count and the drain disagreed: on 2026-10-09 the count held production
 * at "usable READY buffer 2" for two jobs the drain skipped on every pulse
 * (2040001 parked on needs_paid_repair, 1770004 a caption repost), so the lane
 * neither published nor produced.
 */
export function readyCandidateIsUsable(input: {
  status: string;
  hasAsset: boolean;
  hasBlockingError: boolean;
  hasLiveApproval: boolean;
  skippedByDrain?: boolean;
}): boolean {
  if (input.skippedByDrain) return false;
  if (input.hasBlockingError || !input.hasAsset) return false;
  if (input.status === "assets_ready") return true;
  return input.status === "assembled" && input.hasLiveApproval;
}

/** Map the worker's transport status to the durable queue state. */
export function queueStateForReelStatus(status: string): EpisodeQueueState {
  switch (status) {
    case "queued":
    case "repair_queued":
      return "queued";
    case "generating":
    case "assembling":
    case "uploading":
    case "repair_rendering":
      return "in_production";
    case "publishing":
      return "publishing";
    case "assets_ready":
      return "qa_pending";
    case "assembled":
      return "production_ready";
    case "posted":
    case "published":
      return "published";
    case "failed":
    case "needs_regen":
    case "repair_failed":
    case "publish_ambiguous":
      return "blocked";
    default:
      return "blocked";
  }
}

export type ReadyBufferDecision = "refill" | "hold_at_target" | "hold_above_low_watermark";

/**
 * Produce only when the usable assembled inventory reaches the low watermark.
 * This prevents ideation/mining from refilling a buffer that is already healthy.
 */
export function decideReadyBuffer(
  readyCount: number,
  target = 3,
  lowWatermark = 1,
): ReadyBufferDecision {
  if (!Number.isInteger(readyCount) || readyCount < 0) throw new Error("readyCount must be a non-negative integer");
  if (!Number.isInteger(target) || target < 1) throw new Error("target must be a positive integer");
  if (!Number.isInteger(lowWatermark) || lowWatermark < 0 || lowWatermark >= target) {
    throw new Error("lowWatermark must be non-negative and lower than target");
  }
  if (readyCount >= target) return "hold_at_target";
  if (readyCount > lowWatermark) return "hold_above_low_watermark";
  return "refill";
}
