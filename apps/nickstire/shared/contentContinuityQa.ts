/**
 * Character + brand continuity QA.
 *
 * Deterministic checks over a generated brief, run BEFORE any render. These are
 * the failures that survive every existing gate because none of them are unsafe
 * or unspellable — they are just wrong for this universe, and they compound:
 * a page whose narrator changes colour between episodes stops reading as one
 * studio, which was the entire reason for a brand bible.
 *
 * Deliberately NOT a vision critic. This inspects the DESIGN (the words that
 * will be sent to the generator), which is cheap and runs before spend. Pixel
 * inspection is a separate, later, paid concern.
 *
 * Severity contract matches the preflight: `block` stops the render, `warn`
 * records drift without stopping a reel that is otherwise fine.
 */
import { BRAND_CAST, NOIR_PALETTE, type BrandCharacterId } from "./brandBible";
import { FRANCHISES, type FranchiseId } from "./contentFranchises";

export interface ContinuityFinding {
  severity: "block" | "warn";
  rule: string;
  detail: string;
}

/** The colour words the bible permits. Anything strongly off-palette is drift. */
const PALETTE_WORDS = Object.values(NOIR_PALETTE).flatMap((c) =>
  c.prompt.toLowerCase().split(/\s+/).filter((w) => w.length > 3),
);

/** Colours that are NOT in the noir palette and read as a different studio. */
const OFF_PALETTE = /\b(pastel|neon\s+pink|lime\s+green|turquoise|lavender|beige|cream|peach|magenta)\b/i;

/** A generated episode's design surface, as words. */
export interface ContinuityInput {
  franchiseId?: FranchiseId;
  /** Beat visuals + motion — what the generator will be asked to render. */
  designTexts: string[];
  /** Which cast this episode claims to use. */
  cast?: BrandCharacterId[];
  caption?: string;
}

export function runContinuityQa(input: ContinuityInput): ContinuityFinding[] {
  const findings: ContinuityFinding[] = [];
  const all = input.designTexts.join(" \n ");
  const lower = all.toLowerCase();

  // 1. A registered character's PROHIBITED list is absolute. NICK-01 acquiring
  //    a body across episodes is the single most likely continuity break,
  //    because "digital mechanic" is what every model reaches for.
  for (const id of input.cast ?? []) {
    const c = BRAND_CAST[id];
    if (!c) {
      findings.push({ severity: "block", rule: "unknown-character", detail: `cast member "${id}" is not in the brand bible` });
      continue;
    }
    if (id === "nick_01" || id === "the_metal") {
      // The disembodied narrators must never acquire a physical form.
      // Deliberately NARROW. The first draft matched `body|standing|holds` and
      // false-positived on the vocabulary this content is made of: "body panel"
      // is a car part, "standing water" is in the bible's own environment list,
      // and a scanning beam legitimately "holds" on a defect. A continuity rule
      // that blocks correct designs gets disabled, and then it protects nothing.
      if (/\b(uniform|overalls|visor|helmet|humanoid|human figure|silhouette|torso|shoulders|wearing|dressed)\b/i.test(all)) {
        findings.push({
          severity: "block",
          rule: "narrator-embodied",
          detail: `${c.name} is a light/voice presence — the design gives it a physical form, which also trips the faceless gate at render`,
        });
      }
    }
  }

  // 2. Franchise blocking conditions are the show's own contract. A timeline
  //    claim is the most common and the least defensible.
  if (input.franchiseId) {
    const f = FRANCHISES[input.franchiseId];
    if (!f) {
      findings.push({ severity: "block", rule: "unknown-franchise", detail: `"${input.franchiseId}" is not a registered franchise` });
    } else {
      const text = `${all} ${input.caption ?? ""}`;
      // Failure deadlines: "will fail in X weeks" is unverifiable and every
      // franchise that could plausibly tempt it explicitly forbids it.
      if (/\b(will fail|fails?)\b[^.!?]{0,40}\b(within|in)\b[^.!?]{0,20}\b(days?|weeks?|months?|miles)\b/i.test(text)) {
        findings.push({
          severity: "block",
          rule: "failure-deadline",
          detail: "a specific failure timeline is claimed — unverifiable, and forbidden by the franchise contract",
        });
      }
      // The declared cast should belong to the show, or the page stops being
      // episodic. Drift, not danger — a warning.
      for (const id of input.cast ?? []) {
        if (!f.cast.includes(id)) {
          findings.push({
            severity: "warn",
            rule: "cast-drift",
            detail: `${BRAND_CAST[id]?.name ?? id} is not part of ${f.name}'s regular cast`,
          });
        }
      }
    }
  }

  // 3. Palette drift. Off-palette colour makes the page look like several
  //    studios, which is precisely what a visual bible exists to prevent.
  const off = all.match(OFF_PALETTE);
  if (off) {
    findings.push({
      severity: "warn",
      rule: "off-palette",
      detail: `"${off[0]}" is outside Cleveland Mechanical Noir — palette is black, graphite, gold, icy blue, warning red`,
    });
  }

  // 4. A design that names NO palette colour at all is not necessarily wrong,
  //    but it is how episodes drift into generic stock-looking footage.
  if (input.designTexts.length > 0 && !PALETTE_WORDS.some((w) => lower.includes(w))) {
    findings.push({
      severity: "warn",
      rule: "palette-absent",
      detail: "no bible colour is named anywhere in the design — the render will pick its own look",
    });
  }

  return findings;
}

export function continuityBlocks(findings: ContinuityFinding[]): ContinuityFinding[] {
  return findings.filter((f) => f.severity === "block");
}
