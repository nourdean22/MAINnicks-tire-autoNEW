/**
 * Story + Photo directors (directive Part XVI §68-69).
 *
 * Story: a SEQUENCE designed as an arc (interruption -> problem -> proof ->
 * action), not isolated frames — with interaction-safe zones respected so a
 * poll/DM sticker never lands on the subject or the platform UI.
 *
 * Photo: ONE strong source -> multiple appropriate CROPS (feed 4:5, story 9:16,
 * square 1:1), each keeping the subject inside frame — the directive's "use one
 * excellent source to create multiple crops" over "many weak sources".
 *
 * Pure planning: crop rectangles + frame roles + safe-zone rects. No rendering,
 * no model — deterministic geometry, unit-tested.
 */

export type StoryFrameRole = "interruption" | "problem" | "proof" | "action";

export interface StoryFramePlan {
  role: StoryFrameRole;
  purpose: string;
  /** interaction sticker (poll/question/DM) placement as fractional rect, or null */
  interactionZone: { xFrac: number; yFrac: number; wFrac: number; hFrac: number } | null;
}

/** IG Stories reserve the top ~14% and bottom ~20% for platform UI — stickers
 *  and key content stay inside the middle band. */
export const STORY_SAFE = { topUiFrac: 0.14, bottomUiFrac: 0.2 } as const;

/** Plan a Story arc. Length 3 (tight) or 4 (with a distinct proof frame). */
export function planStorySequence(input: { hasProof: boolean; cta: string }): StoryFramePlan[] {
  // sticker sits in the safe middle band, lower third but above the UI reserve
  const midStickerY = 1 - STORY_SAFE.bottomUiFrac - 0.18;
  const frames: StoryFramePlan[] = [
    { role: "interruption", purpose: "stop the tap in <1s — the hook", interactionZone: null },
    { role: "problem", purpose: "name the customer's problem plainly", interactionZone: null },
  ];
  if (input.hasProof) {
    frames.push({ role: "proof", purpose: "show the mechanic truth / evidence", interactionZone: null });
  }
  frames.push({
    role: "action",
    purpose: `single clear CTA: ${input.cta}`.slice(0, 120),
    interactionZone: { xFrac: 0.15, yFrac: midStickerY, wFrac: 0.7, hFrac: 0.12 },
  });
  return frames;
}

export interface CropRect { x: number; y: number; w: number; h: number }
export interface PhotoCropPlan { format: string; aspect: [number, number]; rect: CropRect }

/**
 * Compute a centered max-area crop of the target aspect that stays inside the
 * source, biased to keep the subject (given as a fractional center) in frame.
 * Pure geometry — the directive's "crop preserves subject".
 */
export function planPhotoCrop(
  source: { w: number; h: number },
  aspect: [number, number],
  subjectCenter: { xFrac: number; yFrac: number } = { xFrac: 0.5, yFrac: 0.5 },
): CropRect {
  const targetRatio = aspect[0] / aspect[1];
  const srcRatio = source.w / source.h;
  let w: number, h: number;
  if (srcRatio > targetRatio) {
    // source wider than target -> full height, crop width
    h = source.h;
    w = Math.round(h * targetRatio);
  } else {
    w = source.w;
    h = Math.round(w / targetRatio);
  }
  // center on the subject, then clamp inside the source
  let x = Math.round(source.w * subjectCenter.xFrac - w / 2);
  let y = Math.round(source.h * subjectCenter.yFrac - h / 2);
  x = Math.max(0, Math.min(x, source.w - w));
  y = Math.max(0, Math.min(y, source.h - h));
  return { x, y, w, h };
}

/** All standard platform crops from one source. */
export function planPhotoCrops(
  source: { w: number; h: number },
  subjectCenter?: { xFrac: number; yFrac: number },
): PhotoCropPlan[] {
  const formats: Array<{ format: string; aspect: [number, number] }> = [
    { format: "feed_portrait", aspect: [4, 5] },
    { format: "story", aspect: [9, 16] },
    { format: "square", aspect: [1, 1] },
  ];
  return formats.map((f) => ({ ...f, rect: planPhotoCrop(source, f.aspect, subjectCenter) }));
}
