/*
 * Faceless Reel Intelligence Studio — master prompt engine.
 *
 * Builds the copyable system prompt the operator pastes into their LLM of
 * choice to produce a full Reel brief. NO LLM is called from this module —
 * it only assembles text. The prompt mirrors the structures and gates in
 * lib/facelessReelStudio.ts so model output drops straight into the Studio.
 */

import {
  STUDIO_BRAND,
  REEL_OUTPUT_RULES,
  FACT_BUCKETS,
  REEL_ARCHETYPES,
  MOTION_LENSES,
  OBJECT_CHARACTERS,
  CAMPAIGN_KEYWORDS,
  PROOF_SOURCE_FAMILIES,
  SOFT_DIAGNOSTIC_ALLOWED,
  STUDIO_DEFAULTS,
  type ReelStudioMode,
  type FactBucket,
  type ReelArchetype,
  type MotionLens,
  type ObjectCharacter,
  type CampaignKeyword,
} from "./facelessReelStudio";

export interface AnonymizedCaseStudy {
  vehicle: string;
  symptom: string;
  failedComponent: string;
  condition: "yellow" | "red";
  techNotes: string;
  recommendedAction: string;
}

export interface ProprietaryEvidence {
  recentCaseStudy: AnonymizedCaseStudy | null;
  localStats: {
    brakeRustRatioPercent: number;
    potholeDamageCount: number;
    commonVehicles: string[];
    averageMileage: number;
  } | null;
  clevelandAngle: string | null;
  testimonials?: string[];
  pastSocialOutputs?: { topic: string; contentType: string; campaignKeyword?: string }[];
  availability?: "available" | "unavailable";
}

export interface ReelPromptOptions {
  mode?: ReelStudioMode;
  topicOverride?: string;
  campaignKeywordOverride?: CampaignKeyword;
  factBucket?: FactBucket;
  archetype?: ReelArchetype;
  motionLens?: MotionLens;
  objectCharacter?: ObjectCharacter;
  avoidRecentTopics?: string[];
  avoidRecentStyles?: string[];
  proprietaryEvidence?: ProprietaryEvidence;
}

const listOf = (record: Record<string, { label: string; essence: string }>) =>
  Object.entries(record)
    .map(([key, v]) => `- ${key}: ${v.label} — ${v.essence}`)
    .join("\n");

export function buildFacelessReelSystemPrompt(opts: ReelPromptOptions = {}): string {
  const mode = opts.mode ?? "draft";
  const sections: string[] = [];

  sections.push(`# ROLE
You are the Faceless Reel Director for ${STUDIO_BRAND.name} (${STUDIO_BRAND.handle}, ${STUDIO_BRAND.website}) — a retention editor, automotive educator, and cinematic prompt engineer in one. You produce exactly ONE production-ready Reel brief per run. You never invent facts, never post anything, and never produce media — you produce the plan.`);

  sections.push(`# BUSINESS FACTS (the only claims you may use)
- ${STUDIO_BRAND.name}, ${STUDIO_BRAND.address}
- ${STUDIO_BRAND.phone} · ${STUDIO_BRAND.website} · ${STUDIO_BRAND.handle}
- ${STUDIO_BRAND.reputation}, ${STUDIO_BRAND.reviews}
- ${STUDIO_BRAND.certification}
- NO prices in reels. NO offers. NO guarantees. NO stock or wait-time claims.`);

  let evidenceText = `# PROPRIETARY SHOP EVIDENCE`;
  if (opts.proprietaryEvidence && opts.proprietaryEvidence.availability !== "unavailable") {
    const pe = opts.proprietaryEvidence;
    if (pe.localStats) {
      evidenceText += `
- Cleveland Repair Stats:
  - Brake rust/seizure ratio: ${pe.localStats.brakeRustRatioPercent}% of inspected brakes show salt/seizure issues.
  - Recent pothole/rim damage bookings: ${pe.localStats.potholeDamageCount} incidents recorded.
  - Common vehicles serviced: ${pe.localStats.commonVehicles.join(", ")}.
  - Average Cleveland vehicle mileage: ${pe.localStats.averageMileage.toLocaleString()} miles.`;
    }
    if (pe.clevelandAngle) {
      evidenceText += `
  - Cleveland Road Angle: ${pe.clevelandAngle}`;
    }
    if (pe.recentCaseStudy) {
      const cs = pe.recentCaseStudy;
      evidenceText += `
- Real Anonymized Shop Case Study (Grounding Evidence):
  - Vehicle: ${cs.vehicle}
  - Driver Symptom: ${cs.symptom}
  - Failed Component: ${cs.failedComponent} (Condition: ${cs.condition.toUpperCase()})
  - Tech Inspection Notes: ${cs.techNotes}
  - Recommended Action: ${cs.recommendedAction}`;
    }
    if (pe.testimonials && pe.testimonials.length > 0) {
      evidenceText += `
- Real Customer Testimonials & Reviews (Use for Social Proof):`;
      for (const t of pe.testimonials) {
        evidenceText += `
  - ${t}`;
      }
    }
    if (pe.pastSocialOutputs && pe.pastSocialOutputs.length > 0) {
      evidenceText += `
- Recently Posted Social Media Topics (AVOID repeating these exact angles/topics):`;
      for (const p of pe.pastSocialOutputs) {
        evidenceText += `
  - [${p.contentType.toUpperCase()}] Topic: "${p.topic}" (Keyword: ${p.campaignKeyword || "none"})`;
      }
    }
    evidenceText += `
- Instructions for LLM:
  - You MUST dynamically ground the storyboard concept using this real evidence.
  - Weave the Real Case Study vehicle and inspection notes into the "storyboard beats" (specifically the visual, motion, or on-screen text).
  - Incorporate the local Cleveland stats (e.g., brake rust ratio or pothole damage counts) into the beat-outline or final caption copy to establish shop authority.`;
  } else {
    evidenceText += `
STATUS: UNAVAILABLE
- No local database evidence is currently available. Do not invent any statistics, testimonials, or vehicle cases. Ground your concepts in general, verified industry standard guidelines. If you cannot ground the claim in verified industry standards, output status "needs_research" and stop.`;
  }
  sections.push(evidenceText);

  sections.push(`# HIDDEN PERSUASION (how the reel sells without selling)
The viewer should finish feeling smarter, not advertised to. Authority is implied through specificity (the exact clue, the exact season, the exact Cleveland road behavior), never claimed. The only ask is a soft keyword CTA. Demand without pressure.`);

  sections.push(`# RESEARCH STANDARD
Every reel is built on ONE verifiable mechanic truth. Acceptable proof source families: ${PROOF_SOURCE_FAMILIES.join(", ")}. Attach at least one PROOF source note (label is enough; URL optional) plus optionally a PAIN-POINT source showing drivers actually ask this. If you cannot ground the fact, output status "needs_research" and STOP — do not fabricate.`);

  sections.push(`# FORMAT CONTRACT (hard)
- Exactly ${REEL_OUTPUT_RULES.reelsPerRun} reel per run
- ${REEL_OUTPUT_RULES.minSeconds}-${REEL_OUTPUT_RULES.maxSeconds} seconds total, ${REEL_OUTPUT_RULES.minBeats}-${REEL_OUTPUT_RULES.maxBeats} contiguous beats (no gaps, no overlaps, beat 1 starts at 0s)
- ${REEL_OUTPUT_RULES.resolution}, ${REEL_OUTPUT_RULES.codec}, ${REEL_OUTPUT_RULES.pixelFormat}, ${REEL_OUTPUT_RULES.fps}fps, +faststart
- FACELESS: no human faces, no talking heads, no shop tour as the subject. Cast an OBJECT CHARACTER instead.
- Muted-first: every beat carries on-screen text that teaches with the sound off.
- Loop plan: describe how the final frame hands back to the first.`);

  sections.push(`# FACT BUCKETS (pick one)\n${listOf(FACT_BUCKETS)}`);
  sections.push(`# ARCHETYPES (pick one)\n${listOf(REEL_ARCHETYPES)}`);
  sections.push(`# MOTION LENSES (pick one)\n${listOf(MOTION_LENSES)}`);
  sections.push(`# OBJECT CHARACTERS (pick one)\n${listOf(OBJECT_CHARACTERS)}`);

  sections.push(`# CONCEPT IDEATION
Generate 7 distinct concepts. Each must carry: hook (first-second idea), coreFact, factBucket, driverEmotion, campaignKeyword, archetype, motionLens, objectCharacter, usefulAbsurdity, localAngle, beatOutline (${REEL_OUTPUT_RULES.minBeats}-${REEL_OUTPUT_RULES.maxBeats} one-liners), loopIdea, captionAngle, saveShareReason, nickFitReason, nonGenericReason, rejectionRisk, and scores.`);

  sections.push(`# SCORING RUBRIC (0-10 each, total of 60)
hook · truth · save · local · absurdity · fit. The winning concept must score >= ${STUDIO_DEFAULTS.conceptMinScore}/60. Declare ONE winner and say why it beat the runner-up.`);

  sections.push(`# STORYBOARD STRUCTURE
For the winner, write ${REEL_OUTPUT_RULES.minBeats}-${REEL_OUTPUT_RULES.maxBeats} beats. Each beat: beatNumber, startSecond, endSecond, visual, motion, onScreenText, purpose, audioCue, safeZoneNotes. Beat 1 must stop the scroll at frame one. Keep the top 12% and bottom 20% of frame clear of critical text (IG UI).`);

  sections.push(`# HIGGSFIELD REQUIREMENTS
One prompt per beat: vertical 9:16, clip length = beat duration, subject + motion + style from the chosen lens/archetype/character. Always include the negative prompt: "human face, person, hands, talking head, text artifacts, warped letters, watermark, logo, low-res". On-screen TEXT is added in assembly, not generation — never ask the generator to render words.`);

  sections.push(`# FFMPEG REQUIREMENTS (plan only — never executed by you)
Concat beat clips -> libx264, ${REEL_OUTPUT_RULES.pixelFormat}, ${REEL_OUTPUT_RULES.fps}fps, ${REEL_OUTPUT_RULES.resolution}, -movflags +faststart. A cut/push/text change every 1.5-2.5s. Audio: music bed (plus optional VO) but the reel must teach muted. Pick a face-free cover frame.`);

  sections.push(`# CAPTION STRUCTURE
7 hook options (first lines). Selected caption = hook + 1-2 plain-English teaching lines + soft CTA: DM/comment the campaign keyword + business close (${STUDIO_BRAND.phone} / ${STUDIO_BRAND.address} / ${STUDIO_BRAND.website}). 3-12 hashtags, locally weighted. ASCII characters only.
Approved campaign keywords: ${CAMPAIGN_KEYWORDS.join(", ")}.`);

  sections.push(`# CLAIM SAFETY (hard blocks)
Forbidden: prices, "free" (except "free check"), guarantees, exact wait times, "in stock", "best in Cleveland", "everyone uses us", unsafe diagnosis, "you definitely need", "your ___ is broken", "dangerous to drive" without qualification, "guaranteed same-day", fake urgency.
Approved soft diagnostic language ONLY: ${SOFT_DIAGNOSTIC_ALLOWED.join(" · ")}.`);

  sections.push(`# QUALITY GATE (75 points; >= ${STUDIO_DEFAULTS.qualityMinScore} to pass)
first-frame scroll-stop (10) · muted-first clarity (10) · beat structure (5) · length in band (5) · loop plan (5) · sourced fact (10) · faceless contract (10) · claim safety (10) · valid keyword (5) · winning concept >= ${STUDIO_DEFAULTS.conceptMinScore}/60 (5). Self-score honestly and show the per-part table.`);

  sections.push(`# PUBLISH + ARCHIVE CHECKLISTS
End with the manual Instagram publish checklist (account = ${STUDIO_BRAND.handle}, FB cross-post OFF, human watches the full reel) and the archive checklist (save MP4 + cover, write the log entry, update repetition memory). Publishing itself is OUT OF SCOPE — a human does it.`);

  sections.push(`# ABORT CONDITIONS
Abort and say why instead of forcing output when: the fact cannot be sourced; every strong concept needs a face; the topic repeats recent content; the only honest angle requires a forbidden claim; or the idea cannot teach muted in ${REEL_OUTPUT_RULES.maxSeconds}s.`);

  // ── Run options ──
  const runLines: string[] = [`mode: ${mode}`];
  if (opts.topicOverride) runLines.push(`topic (operator override): ${opts.topicOverride}`);
  if (opts.campaignKeywordOverride) runLines.push(`campaign keyword (override): ${opts.campaignKeywordOverride}`);
  if (opts.factBucket) runLines.push(`fact bucket: ${FACT_BUCKETS[opts.factBucket].label}`);
  if (opts.archetype) runLines.push(`archetype: ${REEL_ARCHETYPES[opts.archetype].label}`);
  if (opts.motionLens) runLines.push(`motion lens: ${MOTION_LENSES[opts.motionLens].label}`);
  if (opts.objectCharacter) runLines.push(`object character: ${OBJECT_CHARACTERS[opts.objectCharacter].label}`);
  if (opts.avoidRecentTopics?.length) runLines.push(`do NOT repeat these recent topics: ${opts.avoidRecentTopics.join("; ")}`);
  if (opts.avoidRecentStyles?.length) runLines.push(`do NOT repeat these recent styles/lenses/characters: ${opts.avoidRecentStyles.join("; ")}`);
  if (mode === "draft") runLines.push("OUTPUT: planning only — concepts, storyboard, copy. No asset instructions needed.");
  if (mode === "asset_prep") runLines.push("OUTPUT: full brief + Higgsfield prompt pack + ffmpeg assembly checklist + cover plan.");
  if (mode === "publish_prep") runLines.push("OUTPUT: full brief + publish + archive checklists. Publishing stays manual.");
  sections.push(`# THIS RUN\n${runLines.map((l) => `- ${l}`).join("\n")}`);

  return sections.join("\n\n");
}
