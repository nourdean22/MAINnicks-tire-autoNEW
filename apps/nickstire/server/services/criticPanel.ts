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
 * This module owns the lens definitions + the PURE merge (unit-tested).
 *
 * NOT WIRED — READ THIS BEFORE TRUSTING ANYTHING ABOVE.
 *
 * There is no live multi-lens run. This docstring used to claim one ("the live
 * multi-lens run reuses evaluateRenderedReel per lens"), and it was never true:
 * grepped 2026-09-09 across server/, client/, shared/ and scripts/, the only
 * importers of `CRITIC_LENSES`, `mergePanel` or this file are its own tests.
 * Production runs the SINGLE general critic — `runRenderedQaOnJob` calls
 * `evaluateRenderedReel` once, and nothing calls this.
 *
 * That matters in both directions. A defect code added here reaches no reel, so
 * the craft codes added on 2026-09-09 are live only because they were also
 * added to the registry in renderedQa.ts, which IS wired. And a test asserting
 * against these lens definitions is green over a subject that never runs.
 *
 * Wiring it is a SPEND decision, not a code decision: one vision call per lens
 * means seven per reel instead of one, against a daily generation budget the
 * autonomy policy caps. It needs an operator to authorize the multiplier, so
 * the honest state is "designed, tested, dormant" — recorded here rather than
 * left for the next reader to discover.
 */
import type { RenderedFinding, RenderedQaVerdict } from "./renderedQa";
import { RENDERED_DEFECT_CODES } from "./renderedQa";

export type CriticLens =
  | "visual_continuity" | "automotive" | "editorial"
  | "typography" | "brand" | "strategic" | "composition";

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
  findings: Array<RenderedFinding & { lenses: CriticLens[] }>;
  lensesRun: CriticLens[];
  lensesSkipped: CriticLens[];
}

const KEY = (f: RenderedFinding) => `${f.code}::${f.beatNumber ?? "x"}`;
const SEV_RANK: Record<string, number> = { block: 2, warn: 1 };

/**
 * Merge per-lens verdicts. Dedupe on (code, beat); when two lenses report the
 * same finding, keep the stronger severity and union the lens tags. ANY block
 * finding forces repair — a single hard fail is never averaged away.
 */
export function mergePanel(
  perLens: Array<{ lens: CriticLens; verdict: RenderedQaVerdict | null }>,
): PanelVerdict {
  const lensesRun: CriticLens[] = [];
  const lensesSkipped: CriticLens[] = [];
  const byKey = new Map<string, RenderedFinding & { lenses: CriticLens[] }>();

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
