/**
 * Visual-QA publish gate for the autonomous IG image publisher.
 *
 * THE DEFECT (live, 2026-10-01 12:17 UTC): `image-eval skipped (no
 * REPLICATE_API_KEY)` was logged, `combineScores` then set
 * `imagePass = true` because "dryrun review is the gate" — and the run was
 * NOT a dryrun. The unscored AI image published to Instagram
 * (18101960009368023) and Facebook. Every static autopost since the
 * provider ladder degraded (2026-09-29 →) took the same path: three dead
 * image providers, then a Gemini image nobody looked at, then publish.
 *
 * THE CONTRACT: for generative pixels, no rendered verdict means UNKNOWN,
 * and UNKNOWN never publishes unattended. A deterministic template (the
 * branded poster) is exempt — its layout is validated by construction, and
 * a vision call would only score a photo it does not contain.
 *
 *   kind=poster                      → clear (deterministic)
 *   kind=ai, scored ≥ min            → clear
 *   kind=ai, scored < min            → block (scored weak)
 *   kind=ai, skipped / null          → block (UNKNOWN — hold for a human)
 *   gate disabled (kill switch)      → clear, reason says so
 *
 * Same fail-closed precedent as igJudgeGate: nobody watches this run, so
 * "the critic could not look" must not mean "publish". Dryrun previews keep
 * flowing (that lane has a human). Kill switch: IG_VISUAL_QA_GATE=false.
 *
 * Pure decision logic — the vision call that produces the verdict lives in
 * igAutopost.evalImage (Replicate, then Gemini, so prod has a critic without
 * a new key).
 */

export type ImageKind = "poster" | "ai";

export interface ImageVerdictRecord {
  proLook: number | null;
  skipped: boolean;
  note: string;
}

export interface VisualQaGateDecision {
  block: boolean;
  /** One of: deterministic · scored_clear · scored_weak · unknown · disabled */
  state: "deterministic" | "scored_clear" | "scored_weak" | "unknown" | "disabled";
  reason: string;
}

export function visualQaGate(
  kind: ImageKind,
  image: ImageVerdictRecord,
  opts: { enabled: boolean; minProLook: number },
): VisualQaGateDecision {
  if (!opts.enabled) {
    return { block: false, state: "disabled", reason: "visual QA gate disabled (IG_VISUAL_QA_GATE=false) — publishing on caption eval only" };
  }
  if (kind === "poster") {
    return { block: false, state: "deterministic", reason: "branded poster — deterministic template, layout validated by construction" };
  }
  if (image.skipped || image.proLook === null) {
    return {
      block: true,
      state: "unknown",
      reason: `AI image has no rendered verdict (${image.note || "critic skipped"}) — UNKNOWN is not PASS; held for a human`,
    };
  }
  if (image.proLook < opts.minProLook) {
    return { block: true, state: "scored_weak", reason: `AI image scored ${image.proLook.toFixed(2)} < ${opts.minProLook} — ${image.note.slice(0, 160)}` };
  }
  return { block: false, state: "scored_clear", reason: `AI image scored ${image.proLook.toFixed(2)} ≥ ${opts.minProLook}` };
}

export function visualQaGateEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.IG_VISUAL_QA_GATE !== "false";
}
