/**
 * Specialist critic panel (directive Part XIV §59) — the single general vision
 * critic (renderedQa.evaluateRenderedReel) becomes a PANEL of focused lenses.
 * The directive's thesis: one composite score hides weak dimensions; a
 * dedicated automotive critic catches a malformed wheel a general critic
 * shrugs at, a typography critic reads the caption a visual critic ignores.
 *
 * Each lens narrows the SAME calibrated critic to one concern (its defect
 * subset + a focused instruction). The panel runs the lenses, then MERGES:
 * dedupe cross-lens findings on (code, beat), keep the strongest severity,
 * and let ANY block force repair — no averaging, so a single hard failure is
 * never diluted by six clean lenses.
 *
 * WHAT IS WIRED, EXACTLY (2026-10-01, Creative Intelligence OS README §L.2).
 *
 *   ADAPTIVE ESCALATION OF ONE LENS, behind a flag. `runRenderedQaOnJob`
 *   (renderedQa.ts) calls `escalateIfNeeded` right after the general critic
 *   when the pipeline passes `specialist: true`, which reelPipeline.ts derives
 *   from `RENDERED_QA_SPECIALIST === "true"` (default OFF). The general
 *   verdict's `escalate` field — chosen deterministically from its findings,
 *   never by the model — names at most ONE lens: automotive, editorial,
 *   typography, brand or composition. That lens runs through the SAME vision
 *   wrapper the general critic uses (`callVisionCritic`), its verdict is
 *   merged with `mergePanel`, the craft score is refolded, and `visionCalls`
 *   on the verdict records the spend: 1 with the flag off, ≤2 with it on.
 *
 * WHAT IS NOT WIRED.
 *
 *   The full seven-lens panel. Nothing runs `visual_continuity` or
 *   `strategic`, and nothing runs more than one lens per reel. Seven calls per
 *   reel against a daily generation budget the autonomy policy caps is a SPEND
 *   decision an operator has to make; the escalation path above is the
 *   ~1.2-calls-per-reel compromise the README asked for instead. The lens
 *   definitions and the merge remain unit-tested on their own.
 *
 * This header used to say "NOT WIRED" outright, and before that it claimed a
 * live multi-lens run that never existed. Both corrections are kept here so
 * the next reader does not have to rediscover either.
 */
import type { EscalationLens, EvaluateRenderedReelInput, ExtractedFrame, RenderedFinding, RenderedQaVerdict } from "./renderedQa";
import { RENDERED_DEFECT_CODES, beatsDocFor, callVisionCritic, clampVerdict, craftScore, heroForCritic } from "./renderedQa";
import { createLogger } from "../lib/logger";

const log = createLogger("services:critic-panel");

export type CriticLens =
  | "visual_continuity" | "automotive" | "editorial"
  | "typography" | "brand" | "strategic" | "composition";

/** A panel member: a specialist lens, or the general critic whose verdict a
 *  lens is merged into. */
export type PanelMember = CriticLens | "general";

/** Which defect codes each lens is responsible for + its focusing instruction.
 *  A code may appear in more than one lens (e.g. text artifacts matter to both
 *  typography and visual) — the merge dedupes. */
export const CRITIC_LENSES: Record<CriticLens, { codes: (keyof typeof RENDERED_DEFECT_CODES)[]; focus: string }> = {
  visual_continuity: {
    codes: ["SUBJECT_CONTINUITY", "ENVIRONMENT_DRIFT", "LIGHTING_DRIFT", "PALETTE_DRIFT"],
    focus: "Identity, environment, lighting and palette CONTINUITY across beats. Does the same logical object stay the same object?",
  },
  automotive: {
    codes: ["MALFORMED_GEOMETRY", "DAMAGE_LOCATION_DRIFT", "IMPOSSIBLE_PHYSICALITY"],
    focus: "Automotive credibility: physically plausible parts, correct component placement, damage that stays put. A melted wheel or a battery terminal in the wrong place is a hard fail. Also judge whether the LIGHT is possible - a contact shadow under every object, a visible source for every reflection, countable tread blocks and lug nuts.",
  },
  editorial: {
    codes: ["WEAK_COMPOSITION"],
    focus: "Hook strength (first frame), beat progression, dead time, ending. Does the first frame stop a thumb?",
  },
  typography: {
    codes: ["GENERATED_TEXT_ARTIFACT", "CAPTION_OBSTRUCTION"],
    focus: "ALL on-frame text. The only legitimate text is the deterministic caption overlay; any other lettering (fake UI, gibberish signage, device screens) is a defect. Read every screen and edge.",
  },
  brand: {
    codes: ["PALETTE_DRIFT", "GENERIC_STOCK_LOOK", "PLASTIC_AI_LOOK"],
    focus: "Recognizability and craft. Judge the palette against the world THIS reel declared, not against one house look - the brand survives as the accent, not the ground. Then ask the two questions no other lens asks: could this frame be any shop in any city, and does it read as photographed or as generated?",
  },
  strategic: {
    codes: [],
    focus: "Does the render serve the campaign objective and the customer moment? Is the CTA legible and timed?",
  },
  composition: {
    codes: ["WEAK_COMPOSITION", "HUMAN_PRESENT", "NARRATOR_EMBODIED"],
    focus: "Mobile framing, subject scale, safe zones, and the faceless contract - no human faces or hands, and no narrator drawn as a figure, silhouette, uniform or visor. NICK-01 is light and motion only, so a body-shaped presence is a violation even when no face is visible.",
  },
};

export interface PanelVerdict {
  decision: "approve" | "repair";
  findings: Array<RenderedFinding & { lenses: PanelMember[] }>;
  lensesRun: PanelMember[];
  lensesSkipped: PanelMember[];
}

const KEY = (f: RenderedFinding) => `${f.code}::${f.beatNumber ?? "x"}`;
const SEV_RANK: Record<string, number> = { block: 2, warn: 1 };

/**
 * Merge per-lens verdicts. Dedupe on (code, beat); when two lenses report the
 * same finding, keep the stronger severity and union the lens tags. ANY block
 * finding forces repair — a single hard fail is never averaged away.
 */
export function mergePanel(
  perLens: Array<{ lens: PanelMember; verdict: RenderedQaVerdict | null }>,
): PanelVerdict {
  const lensesRun: PanelMember[] = [];
  const lensesSkipped: PanelMember[] = [];
  const byKey = new Map<string, RenderedFinding & { lenses: PanelMember[] }>();

  for (const { lens, verdict } of perLens) {
    if (!verdict || verdict.critic === "skipped") { lensesSkipped.push(lens); continue; }
    lensesRun.push(lens);
    for (const f of verdict.findings) {
      const k = KEY(f);
      const existing = byKey.get(k);
      if (!existing) {
        byKey.set(k, { ...f, lenses: [lens] });
      } else {
        if (!existing.lenses.includes(lens)) existing.lenses.push(lens);
        if ((SEV_RANK[f.severity] ?? 0) > (SEV_RANK[existing.severity] ?? 0)) existing.severity = f.severity;
      }
    }
  }

  const findings = [...byKey.values()].sort((a, b) => (SEV_RANK[b.severity] ?? 0) - (SEV_RANK[a.severity] ?? 0));
  const decision = findings.some((f) => f.severity === "block") ? "repair" : "approve";
  return { decision, findings, lensesRun, lensesSkipped };
}

// ─── Adaptive specialist escalation (wired, flag-gated) ───────────

export interface SpecialistContext {
  brief: EvaluateRenderedReelInput["brief"];
}

type SpecialistLens = Exclude<EscalationLens, "none">;

/**
 * One focused vision pass through the SAME wrapper as the general critic. The
 * lens is told what the general critic already reported so it confirms or
 * refutes rather than re-inventing; it may only emit its own codes. Never
 * throws — a failed call is a "skipped" lens verdict, which mergePanel records
 * as skipped rather than clean.
 */
async function runSpecialistLens(lens: SpecialistLens, frames: ExtractedFrame[], context: SpecialistContext, general: RenderedQaVerdict): Promise<RenderedQaVerdict> {
  const def = CRITIC_LENSES[lens];
  const codeDoc = def.codes
    .map((code) => `${code} (${RENDERED_DEFECT_CODES[code].severity}): ${RENDERED_DEFECT_CODES[code].meaning}`)
    .join("\n");
  const priorDoc = general.findings.length
    ? general.findings.map((f) => `- ${f.code} on beat ${f.beatNumber ?? "first/final"} (${f.severity}${typeof f.confidence === "number" ? `, confidence ${f.confidence}` : ""}): ${f.description}`).join("\n")
    : "- (none)";
  const system = [
    `You are a SPECIALIST creative QA critic for automotive reels, with exactly one concern.`,
    `FOCUS: ${def.focus}`,
    `Frames are labeled in order: first, per-beat midpoints, final. Judge ONLY what is visible.`,
    `Emit findings ONLY with these exact codes — your lens owns no others, and an empty findings list is a valid answer:\n${codeDoc || "(this lens has no defect codes; return zero findings unless something within your focus is plainly wrong)"}`,
    `PLANNED BEATS:\n${beatsDocFor(context.brief)}`,
    `The general critic already reported:\n${priorDoc}\nYou were called because it was not sure. CONFIRM a prior finding by re-emitting it with your own confidence, REFUTE it by leaving it out, and ADD anything within your focus it missed.`,
    `For each finding give beatNumber (the beat whose frame shows it, or null for first/final), a concrete description, preserve[] (what the repair must keep), change[] (the minimal change) and confidence 0-1. Decision "repair" only for a block. Do not praise.`,
  ].join("\n\n");
  const user = `Inspect these ${frames.length} frames (order: ${frames.map((f) => f.label).join(", ")}) through the ${lens} lens only. Topic: ${context.brief.topic ?? "unknown"}. Hero: ${heroForCritic(context.brief.objectCharacter)}.`;
  try {
    const parsed = await callVisionCritic({ frames, system, user });
    return clampVerdict(parsed, frames.length, "vision");
  } catch (err) {
    log.warn("specialist lens unavailable — recorded as skipped, not as clean", {
      lens, err: err instanceof Error ? err.message.slice(0, 160) : String(err),
    });
    return clampVerdict({ decision: "approve", findings: [] }, frames.length, "skipped");
  }
}

/**
 * Run the ONE lens the general verdict asked for (`verdict.escalate`) and
 * merge it in. Gated by `RENDERED_QA_SPECIALIST === "true"` unless the caller
 * passes `enabled` explicitly (the pipeline does, so the gate is visible at
 * the call site). Returns the verdict untouched when disabled, when the
 * general critic did not evaluate, or when it asked for no lens — so with the
 * flag off the vision-call count is exactly what it was before this existed.
 *
 * `visionCalls` counts ATTEMPTS: a lens call that times out was still sent and
 * is still spend, so it is counted even when the lens comes back skipped.
 */
export async function escalateIfNeeded(
  verdict: RenderedQaVerdict,
  frames: ExtractedFrame[],
  context: SpecialistContext,
  opts: { enabled?: boolean } = {},
): Promise<RenderedQaVerdict> {
  const enabled = opts.enabled ?? process.env.RENDERED_QA_SPECIALIST === "true";
  if (!enabled) return verdict;
  if (verdict.critic !== "vision" || !verdict.escalate || verdict.escalate === "none") return verdict;
  const lens = verdict.escalate;
  const lensVerdict = await runSpecialistLens(lens, frames, context, verdict);
  const panel = mergePanel([
    { lens: "general", verdict },
    { lens, verdict: lensVerdict },
  ]);
  // The general critic may say "repair" with zero codable findings (real
  // signal, see clampVerdict); mergePanel only sees findings, so OR the two.
  const decision = verdict.decision === "repair" || panel.decision === "repair" ? "repair" : "approve";
  const findingsAdded = Math.max(0, panel.findings.length - verdict.findings.length);
  log.info("specialist lens merged", { lens, lensCritic: lensVerdict.critic, findingsAdded, decision });
  return {
    ...verdict,
    decision,
    findings: panel.findings,
    craftScore: craftScore(panel.findings, verdict.pixelStats),
    visionCalls: (verdict.visionCalls ?? 1) + 1,
    specialist: { lens, critic: lensVerdict.critic, findingsAdded },
  };
}
