/**
 * Pre-generation Visual Bible (Creative Compiler 2.0 Milestone 7).
 *
 * A hero reference frame becomes the image-conditioning ANCHOR — every beat is
 * generated from it, so ANY defect in the anchor propagates to the whole reel
 * (audit finding #11). Before a frame is used as the anchor, screen the ACTUAL
 * IMAGE (not the prompt that made it) for the 690001 defect classes: generated
 * text, a fake/mis-spelled logo, humans/hands, plus automotive plausibility and
 * overall conditioning suitability. A frame that fails is never used as an
 * anchor — the reel falls back to text-only.
 *
 * Honesty: extraction failure returns null (screen UNAVAILABLE), never a
 * fabricated pass; referenceFrameVerdict treats null conservatively.
 */
import { createLogger } from "../lib/logger";
import { invokeLLM } from "../_core/llm";
import { extractBalancedJson } from "./visualBibleObserved";

const log = createLogger("services:reference-frame-screen");

export interface ReferenceFrameObservation {
  observedSubject: string;
  hasGeneratedText: boolean;
  hasFakeLogo: boolean;
  hasHumanOrHands: boolean;
  automotivePlausible: boolean;
  compositionOk: boolean;
  conditioningSuitable: boolean;
  defects: string[];
  confidence: number;
}

const PROMPT = `You are a reference-frame QA supervisor. This ONE image is about to become the IDENTITY ANCHOR for a faceless automotive reel — EVERY shot will be generated from it, so any defect propagates to the whole video. Judge ONLY what is visibly true in the pixels. Return STRICT JSON:
{"observedSubject":"","hasGeneratedText":false,"hasFakeLogo":false,"hasHumanOrHands":false,"automotivePlausible":true,"compositionOk":true,"conditioningSuitable":true,"defects":[],"confidence":0.0}
- hasGeneratedText: any readable OR garbled letters, numbers, gauge readings, screen copy, or captions rendered INTO the image.
- hasFakeLogo: any brand mark, wordmark, or badge (especially mis-spelled).
- hasHumanOrHands: any person, face, hand, glove, arm, or human reflection.
- automotivePlausible: the parts/materials are physically believable.
- compositionOk: a clear hero subject with clean headroom/footroom.
- conditioningSuitable: overall — is this a clean, unbranded, wordless, faceless frame safe to anchor EVERY beat on?
No markdown. Empty string / false / [] when not grounded in the pixels.`;

async function fetchImageDataUrl(url: string): Promise<string> {
  const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`fetch ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const mime = res.headers.get("content-type") || "image/jpeg";
  return `data:${mime};base64,${buf.toString("base64")}`;
}

/** Vision-screen a candidate anchor frame. Returns null on any failure (never a
 *  fabricated pass). imageUrl may be an http(s) URL or a data: URL. */
export async function screenReferenceFrame(imageUrl: string): Promise<ReferenceFrameObservation | null> {
  try {
    const dataUrl = imageUrl.startsWith("data:") ? imageUrl : await fetchImageDataUrl(imageUrl);
    const res: unknown = await invokeLLM({
      messages: [
        { role: "system", content: PROMPT },
        { role: "user", content: [{ type: "text", text: "Screen this candidate anchor frame." }, { type: "image_url", image_url: { url: dataUrl } }] as never },
      ],
      maxTokens: 8192,
    } as never);
    const text = (res as { choices?: Array<{ message?: { content?: string } }> }).choices?.[0]?.message?.content ?? "";
    const p = JSON.parse(extractBalancedJson(text)) as Partial<ReferenceFrameObservation>;
    return {
      observedSubject: p.observedSubject ?? "",
      hasGeneratedText: !!p.hasGeneratedText,
      hasFakeLogo: !!p.hasFakeLogo,
      hasHumanOrHands: !!p.hasHumanOrHands,
      // Fail CLOSED: a positive-safety field must be EXPLICITLY true. A missing/
      // malformed field (undefined) → false → the verdict rejects the anchor.
      // (Previously `!== false` defaulted a missing field to true, so an empty or
      // partial analysis object silently passed as a clean anchor — audit P2.)
      automotivePlausible: p.automotivePlausible === true,
      compositionOk: p.compositionOk === true,
      conditioningSuitable: p.conditioningSuitable === true,
      defects: Array.isArray(p.defects) ? p.defects : [],
      // A NON-NUMERIC confidence ("high", null, {}) coerces to NaN, and
      // `NaN < 0.35` is FALSE — which let a malformed screen slip past the
      // threshold. Normalize a non-finite value to the sentinel -1 so it fails
      // every comparison the verdict makes (audit: fail-open for NaN).
      confidence: Number.isFinite(Number(p.confidence)) ? Math.max(0, Math.min(1, Number(p.confidence))) : -1,
    };
  } catch (err) {
    log.warn("reference-frame screen unavailable — null (never a fabricated pass)", { err: err instanceof Error ? err.message.slice(0, 140) : String(err) });
    return null;
  }
}

export type ReferenceFrameVerdict = { accept: boolean; reasons: string[] };

/**
 * Pure gate over a screen observation. A hard defect (generated text, fake logo,
 * human/hands) or an unsuitable/implausible frame => REJECT (a defective anchor
 * poisons every beat). A null observation (screen unavailable) is conservative:
 * when requireScreen is true (the frame WILL be used as an image anchor), null
 * => REJECT (never anchor on an unscreened frame); otherwise null => accept
 * (the screen is advisory when the frame is only a text-continuity reference).
 */
export function referenceFrameVerdict(
  obs: ReferenceFrameObservation | null,
  opts: { requireScreen: boolean } = { requireScreen: true },
): ReferenceFrameVerdict {
  if (!obs) {
    return opts.requireScreen
      ? { accept: false, reasons: ["reference-frame screen unavailable — refusing to anchor on an unscreened frame"] }
      : { accept: true, reasons: [] };
  }
  const reasons: string[] = [];
  if (obs.hasGeneratedText) reasons.push("generated text/readout in the anchor");
  if (obs.hasFakeLogo) reasons.push("fake or mis-spelled logo in the anchor");
  if (obs.hasHumanOrHands) reasons.push("human/hands in the anchor (faceless violation)");
  if (!obs.automotivePlausible) reasons.push("not automotively plausible");
  if (!obs.compositionOk) reasons.push("composition unsuitable for an anchor");
  if (!obs.conditioningSuitable) reasons.push("unsuitable as a conditioning anchor");
  // An anchor poisons every beat, so it needs a POSITIVE clearance: a nonempty
  // observed subject and a finite, sufficient confidence. Non-finite (malformed
  // "high"/null/object → sentinel -1) and low confidence both refuse.
  if (!obs.observedSubject || !obs.observedSubject.trim()) reasons.push("screen returned no observed subject — nothing was actually described");
  if (!Number.isFinite(obs.confidence) || obs.confidence < 0.35) {
    reasons.push(`screen confidence missing/malformed or too low (${obs.confidence})`);
  }
  return { accept: reasons.length === 0, reasons };
}
