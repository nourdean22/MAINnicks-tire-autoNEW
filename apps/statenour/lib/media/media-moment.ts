/**
 * Saved media moments (BDN-316) — media plan item #7.
 *
 * "Let the user save a timestamp, a transcript excerpt, a short note,
 * the source, and a link back to the exact position. Later, Nick can
 * retrieve that note and reopen the video at the same timestamp."
 *
 * THE BOUNDARY THE PLAN SETS, AND WHY IT IS ENFORCED HERE
 * "Do not automatically turn every watched video into permanent memory.
 * Require an explicit 'Save to memory' action."
 *
 * That is why this module exposes no side effects at all. It builds a
 * MemoryCandidate and hands it back; the CALLER performs the write, and
 * the only caller is a button. There is deliberately no hook, no effect,
 * and nothing that could fire from playback — the dock already records
 * `resumeAt` continuously, so an autosave would have been trivial to
 * write and would have silently built a viewing history the operator
 * never asked for. Same reason `resumeAt` itself is memory-only.
 *
 * DETERMINISTIC KEY
 * `media:<id>@<seconds>` — so re-saving the same moment REINFORCES via
 * brain.recordMemory's (category, key) upsert instead of minting a
 * duplicate row. Rounded to whole seconds because the operator means
 * "that bit", not a frame: without rounding, two saves half a second
 * apart become two different memories of the same moment.
 *
 * Pure: no I/O, no clock (savedAt is passed in), no DOM.
 */

import type { MemoryCandidate } from "@/lib/brain/memory-commit-gateway";
import { formatTimestamp } from "@/lib/media/timestamp-refs";

/** The BrainMemory category these land in. */
export const MEDIA_MOMENT_CATEGORY = "media_moment";

export interface MediaMoment {
  mediaId: string;
  mediaTitle: string;
  /** Playback offset in seconds. */
  seconds: number;
  /** The operator's own words. Optional — a bare bookmark is valid. */
  note?: string;
  /** Transcript excerpt, when one exists. Not available today. */
  excerpt?: string;
}

/** `media:<id>@<seconds>` — stable, so a re-save upserts. */
export function momentKey(mediaId: string, seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return `media:${mediaId}@${whole}`;
}

export interface ParsedMomentKey {
  mediaId: string;
  seconds: number;
}

/**
 * Reverse of momentKey. Returns null on anything that is not one of our
 * keys, so a caller iterating BrainMemory rows can filter safely.
 *
 * `mediaId` may itself contain ':' (message-part ids are
 * `<messageId>-<index>`, and message ids are opaque), so the split is
 * anchored on the LAST '@' rather than the first ':'.
 */
export function parseMomentKey(key: string): ParsedMomentKey | null {
  if (!key?.startsWith("media:")) return null;
  const at = key.lastIndexOf("@");
  if (at <= "media:".length) return null;
  const mediaId = key.slice("media:".length, at);
  const secondsRaw = key.slice(at + 1);
  if (!mediaId || !/^\d+$/.test(secondsRaw)) return null;
  return { mediaId, seconds: Number.parseInt(secondsRaw, 10) };
}

/**
 * Human-readable content for the memory row.
 *
 * Written to be legible in recall WITHOUT the metadata — a memory that
 * only makes sense next to its own JSON is a memory the operator cannot
 * read when it surfaces in a chat reply six weeks later.
 */
export function momentContent(moment: MediaMoment): string {
  const stamp = formatTimestamp(moment.seconds);
  const parts = [`${moment.mediaTitle} @ ${stamp}`];
  if (moment.note?.trim()) parts.push(`— ${moment.note.trim()}`);
  if (moment.excerpt?.trim()) parts.push(`· "${moment.excerpt.trim()}"`);
  return parts.join(" ");
}

/**
 * Build the candidate for brain.recordMemory.
 *
 * `source: "operator"` is load-bearing, not decoration: the memory
 * gateway maps source → evidence class, and a moment the operator chose
 * to save IS operator-stated. Labelling it anything else would understate
 * evidence the system genuinely has — the mirror of the laundering
 * problem BDN-313 guards in the other direction.
 */
export function toMemoryCandidate(moment: MediaMoment): MemoryCandidate {
  return {
    category: MEDIA_MOMENT_CATEGORY,
    key: momentKey(moment.mediaId, moment.seconds),
    content: momentContent(moment),
    source: "operator",
    categoryKnown: true,
  };
}

export interface ReopenTarget {
  mediaId: string;
  seconds: number;
}

/**
 * Turn a stored moment back into "reopen this media here".
 *
 * Returns the media id and offset only — deliberately NOT a URL. The URL
 * lives with the message part and can expire (blob: dies with the
 * session); reconstructing one from a memory row would hand the player a
 * dead source and look like a broken bookmark. The caller resolves the
 * id against what is actually available and reports honestly when the
 * media is gone.
 */
export function reopenTargetFromKey(key: string): ReopenTarget | null {
  const parsed = parseMomentKey(key);
  return parsed ? { mediaId: parsed.mediaId, seconds: parsed.seconds } : null;
}
