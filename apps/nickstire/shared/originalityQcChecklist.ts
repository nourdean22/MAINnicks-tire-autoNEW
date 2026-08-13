/**
 * Originality + QC checklist (ScanFinish NT-011) — one canonical readout of
 * the brief's 9-item list, built from checks that mostly ALREADY EXIST but
 * were scattered across separate logs nothing ever read together:
 * episodeClaims (claim verification), reviewReplyQa (caption AND now VO
 * claim-safety), the faceless/disclosure contract, and
 * beatStructureSignals.ts (format/length — added for NT-012, reused here).
 *
 * SHADOW, LOG-ONLY, same as NT-001's independent judge and NT-013's
 * fallback: nothing here blocks publish. Gate-flip stays an operator
 * decision after the disagreement readout accumulates — that precedent is
 * this repo's own, not invented for this pass.
 *
 * HONESTY OVER COVERAGE: two criteria ("no copied footage", "no copyrighted
 * audio") have no PER-JOB signal to check — the guarantee is structural
 * (the autonomous lane only ever calls veo/higgsfield/template_stock for
 * video and TTS/committed CC0 beds for audio; there is no external-footage
 * or licensed-audio ingestion path in this lane at all). Reported as
 * "structural", not "pass", so a reader does not mistake a pipeline-shape
 * fact for a per-reel verification. "No misleading before/after" has no
 * real check built — reported "unknown", not faked as a pass.
 */
import type { EntailmentVerdict } from "./claimEntailment";

export type QcStatus = "pass" | "fail" | "unknown" | "structural";

export interface QcCheck {
  id: string;
  label: string;
  status: QcStatus;
  detail: string;
}

export interface OriginalityQcInput {
  claimEntailments: EntailmentVerdict[];
  /** null = the check itself could not run (e.g. reviewReplyQa import failed) — distinct from "ran and found nothing". */
  captionQaBlocking: boolean | null;
  voiceoverQaBlocking: boolean | null;
  /** From the episode declaration — "visibly_animated" is the faceless
   *  contract's own assertion that nothing in the reel is real human/event
   *  footage, and is what decides Meta AI-content disclosure is mandatory. */
  disclosureMode?: string;
  clevelandAngle?: string;
  caption?: string;
  totalDurationSeconds: number | null;
}

const SAVE_SHARE_LANGUAGE = /\b(send this|share this|tag someone|forward this|send to (?:someone|a friend))\b/i;

/** The brief's declared target — informational only. The real production
 *  gate is reelAssembly.ts's 3-90s bound, a business decision this
 *  measurement tool does not have the authority to override. */
const TARGET_DURATION_MIN_S = 15;
const TARGET_DURATION_MAX_S = 22;

export function evaluateOriginalityQc(input: OriginalityQcInput): { checks: QcCheck[]; passCount: number; failCount: number } {
  const checks: QcCheck[] = [];

  const hasSupportedClaim = input.claimEntailments.some((e) => e === "supported" || e === "partially_supported");
  const hasContradicted = input.claimEntailments.some((e) => e === "contradicted");
  checks.push({
    id: "claim_verified",
    label: "Claim verified",
    status: hasContradicted ? "fail" : hasSupportedClaim ? "pass" : "unknown",
    detail: hasContradicted
      ? "at least one claim's entailment verdict is CONTRADICTED"
      : hasSupportedClaim
        ? `${input.claimEntailments.filter((e) => e === "supported" || e === "partially_supported").length} claim(s) supported or partially supported`
        : "no supported/partially_supported entailment on any claim",
  });

  checks.push({
    id: "no_fake_humans_or_events",
    label: "No fake humans or events",
    status: input.disclosureMode === "visibly_animated" ? "pass" : "unknown",
    detail:
      input.disclosureMode === "visibly_animated"
        ? "episode declared visibly_animated — no real human/event footage in this lane"
        : `disclosureMode is "${input.disclosureMode ?? "unset"}", not the faceless contract's visibly_animated`,
  });

  checks.push({
    id: "no_copied_footage",
    label: "No copied footage",
    status: "structural",
    detail: "autonomous lane only calls veo/higgsfield/template_stock for video — no external/scraped-footage ingestion path exists in this lane",
  });

  checks.push({
    id: "no_copyrighted_audio",
    label: "No copyrighted-audio dependency",
    status: "structural",
    detail: "voiceover is always TTS (reelVoice.ts); music beds are committed CC0 tones (assets/reel-music/LICENSE.md) — convention, not a per-job fingerprint check",
  });

  checks.push({
    id: "no_misleading_before_after",
    label: "No misleading before/after",
    status: "unknown",
    detail: "no automated check exists for this criterion — not built this pass, not faked as a pass",
  });

  const hasLocalAngle = Boolean(input.clevelandAngle?.trim());
  checks.push({
    id: "verified_local_fact",
    label: "One verified local fact",
    status: hasLocalAngle && hasSupportedClaim ? "pass" : hasLocalAngle ? "unknown" : "fail",
    detail: hasLocalAngle
      ? hasSupportedClaim
        ? "clevelandAngle present and at least one claim is entailment-supported"
        : "clevelandAngle present but no claim is entailment-supported"
      : "clevelandAngle is empty",
  });

  checks.push({
    id: "local_trust_marker",
    label: "One local trust marker",
    status: hasLocalAngle ? "pass" : "fail",
    // Same field as the fact check above — this brief has no SEPARATE trust-
    // marker field from its local-fact field, disclosed rather than invented.
    detail: hasLocalAngle ? "clevelandAngle present" : "clevelandAngle is empty — same field the fact check reads",
  });

  const captionHasSaveShare = Boolean(input.caption && SAVE_SHARE_LANGUAGE.test(input.caption));
  checks.push({
    id: "save_share_reason",
    label: "One save/share reason",
    status: captionHasSaveShare ? "pass" : "unknown",
    detail: captionHasSaveShare
      ? "caption contains send/share-inviting language"
      : "no send/share-inviting phrase matched in the caption — reelBriefGen.ts's shareCta prompt asks for one but nothing enforced it landing",
  });

  checks.push({
    id: "caption_claim_safety",
    label: "Caption claim-safety",
    status: input.captionQaBlocking === null ? "unknown" : input.captionQaBlocking ? "fail" : "pass",
    detail: input.captionQaBlocking === null ? "reviewReplyQa did not run" : input.captionQaBlocking ? "caption tripped a blocking finding" : "no blocking finding",
  });

  checks.push({
    id: "voiceover_claim_safety",
    label: "Voiceover claim-safety",
    status: input.voiceoverQaBlocking === null ? "unknown" : input.voiceoverQaBlocking ? "fail" : "pass",
    detail:
      input.voiceoverQaBlocking === null
        ? "reviewReplyQa did not run against the VO script"
        : input.voiceoverQaBlocking
          ? "voiceover script tripped a blocking finding — reviewReplyQa previously ran on the caption only"
          : "no blocking finding in the voiceover script",
  });

  checks.push({
    id: "format_length",
    label: "Format/length (15-22s target)",
    status:
      input.totalDurationSeconds === null
        ? "unknown"
        : input.totalDurationSeconds >= TARGET_DURATION_MIN_S && input.totalDurationSeconds <= TARGET_DURATION_MAX_S
          ? "pass"
          : "fail",
    detail:
      input.totalDurationSeconds === null
        ? "no beat carries an endSecond"
        : `${input.totalDurationSeconds}s against a ${TARGET_DURATION_MIN_S}-${TARGET_DURATION_MAX_S}s target (informational — the enforced production bound is reelAssembly.ts's 3-90s)`,
  });

  return {
    checks,
    passCount: checks.filter((c) => c.status === "pass").length,
    failCount: checks.filter((c) => c.status === "fail").length,
  };
}
