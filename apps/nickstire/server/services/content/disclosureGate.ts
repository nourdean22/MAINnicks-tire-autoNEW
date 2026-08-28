/**
 * The AI-disclosure gate — a trust boundary, enforced, not documented.
 *
 * THE RULE: an AI-generated scene may never be presented as a real customer
 * incident, repair, test, or before/after. A shop's credibility is the asset
 * being spent, and a synthetic "here's what we found on this customer's car"
 * spends it permanently.
 *
 * FAIL-CLOSED BY CONSTRUCTION. Three bypasses were designed against before this
 * shipped, each of which a presence-assertion gate would wave through:
 *
 *   1. OMISSION — a scene with no `source` is UNKNOWN, and unknown can never
 *      satisfy a real-evidence claim. Silence is not "real".
 *   2. RELABELLING — setting `framing: "entertainment"` while the caption still
 *      says "this customer came in with…". The gate reads the TEXT as well as
 *      the label, so the claim is caught where the viewer actually reads it.
 *   3. PARTIAL HONESTY — one disclosed AI scene beside three undisclosed ones.
 *      The disclosure requirement is evaluated over every scene, not the first.
 *
 * A pack that trips any rule fails. There is no soft mode and no override flag:
 * an override on a credibility gate is the thing that gets used at 11pm.
 */

/** Where a scene's footage came from. `unknown` is explicit and always unsafe. */
export type SceneSource = "real" | "ai" | "hybrid" | "stock" | "graphic" | "unknown";

/** Sources that are wholly or partly machine-generated. */
const SYNTHETIC_SOURCES: ReadonlySet<SceneSource> = new Set(["ai", "hybrid"]);

/**
 * Framings that assert to the viewer that they are seeing something that
 * actually happened at the shop. These are the claims AI footage may never carry.
 */
export type PackFraming =
  | "customer_incident"
  | "repair"
  | "test"
  | "before_after"
  | "diagnosis"
  | "explainer"
  | "entertainment"
  | "promotion";

const REAL_EVIDENCE_FRAMINGS: ReadonlySet<PackFraming> = new Set([
  "customer_incident",
  "repair",
  "test",
  "before_after",
  "diagnosis",
]);

/**
 * Phrases that assert real evidence regardless of what the framing FIELD says.
 * Deliberately narrow: each asserts a specific past event at this shop, so a
 * generic "brake pads wear out" explainer does not trip it.
 *
 * Anchored on first-person/deictic shop language — "this customer", "we pulled",
 * "came in" — because that is what converts a demonstration into testimony.
 */
const REAL_EVIDENCE_PHRASES: readonly RegExp[] = [
  /\bthis (?:customer|client|car|truck|vehicle|one)\b/i,
  /\b(?:customer|client) (?:came|brought|pulled|drove) in\b/i,
  /\bcame in (?:today|yesterday|this (?:morning|week)|last week)\b/i,
  /\bwe (?:pulled|found|replaced|fixed|removed|swapped|tore down|cut open)\b/i,
  /\b(?:pulled|took) (?:this|it) off\b/i,
  /\breal (?:customer|repair|job|failure)\b/i,
  /\b(?:actual|genuine) (?:customer|repair|failure)\b/i,
  /\bbefore and after\b/i,
  /\bin (?:our|the) (?:bay|shop|lift)\b/i,
];

export interface PackScene {
  readonly id: string;
  /** Omitted or unrecognised => `unknown` => cannot support a real-evidence claim. */
  readonly source?: SceneSource;
  readonly description?: string;
}

export interface ReelPack {
  readonly id: string;
  readonly title: string;
  readonly framing: PackFraming;
  readonly scenes: readonly PackScene[];
  /** Viewer-facing caption/hook text. Scanned for real-evidence claims. */
  readonly caption?: string;
  /** TRUE only if the pack carries an on-screen/caption AI disclosure. */
  readonly aiDisclosure?: boolean;
}

export type ViolationCode =
  | "AI_PRESENTED_AS_REAL"
  | "TEXT_CLAIMS_REAL_EVIDENCE"
  | "MISSING_AI_DISCLOSURE"
  | "UNDECLARED_SCENE_SOURCE"
  | "EMPTY_PACK";

export interface Violation {
  readonly code: ViolationCode;
  readonly detail: string;
}

export interface DisclosureVerdict {
  readonly ok: boolean;
  readonly violations: readonly Violation[];
  /** TRUE when the pack contains synthetic footage and must carry a disclosure. */
  readonly requiresDisclosure: boolean;
  /** Scene ids whose source is synthetic — the audit trail for a reviewer. */
  readonly syntheticScenes: readonly string[];
}

function sourceOf(scene: PackScene): SceneSource {
  const s = scene.source;
  if (s === "real" || s === "ai" || s === "hybrid" || s === "stock" || s === "graphic") return s;
  return "unknown";
}

/** Every real-evidence phrase the text asserts. Empty array = no claim found. */
export function realEvidenceClaims(text: string): string[] {
  const hits: string[] = [];
  for (const re of REAL_EVIDENCE_PHRASES) {
    const m = re.exec(text);
    if (m) hits.push(m[0]);
  }
  return hits;
}

/**
 * Assess a pack. Pure — no IO, no clock, no randomness, so its canary can drive
 * it directly with planted offenders rather than asserting on its source text.
 */
export function assessDisclosure(pack: ReelPack): DisclosureVerdict {
  const violations: Violation[] = [];

  if (pack.scenes.length === 0) {
    return {
      ok: false,
      violations: [
        {
          code: "EMPTY_PACK",
          detail: `pack "${pack.id}" has no scenes — nothing to certify, so it cannot pass.`,
        },
      ],
      requiresDisclosure: false,
      syntheticScenes: [],
    };
  }

  const synthetic = pack.scenes.filter((s) => SYNTHETIC_SOURCES.has(sourceOf(s)));
  const undeclared = pack.scenes.filter((s) => sourceOf(s) === "unknown");
  const requiresDisclosure = synthetic.length > 0;
  const framingClaimsReality = REAL_EVIDENCE_FRAMINGS.has(pack.framing);

  // 1. The headline rule: synthetic footage under a real-evidence framing.
  if (synthetic.length > 0 && framingClaimsReality) {
    violations.push({
      code: "AI_PRESENTED_AS_REAL",
      detail:
        `pack "${pack.id}" is framed "${pack.framing}" (a real-evidence claim) but contains ` +
        `${synthetic.length} synthetic scene(s): ${synthetic.map((s) => s.id).join(", ")}. ` +
        "Re-frame it as explainer/entertainment, or replace the footage with real footage.",
    });
  }

  // 2. The relabelling bypass: the FIELD says entertainment, the TEXT says testimony.
  if (synthetic.length > 0 && pack.caption) {
    const claims = realEvidenceClaims(pack.caption);
    if (claims.length > 0) {
      violations.push({
        code: "TEXT_CLAIMS_REAL_EVIDENCE",
        detail:
          `pack "${pack.id}" contains synthetic footage and its caption asserts real evidence ` +
          `(${claims.map((c) => `"${c}"`).join(", ")}). The framing field is not what the viewer reads.`,
      });
    }
  }

  // 3. Disclosure is required whenever ANY scene is synthetic.
  if (requiresDisclosure && pack.aiDisclosure !== true) {
    violations.push({
      code: "MISSING_AI_DISCLOSURE",
      detail:
        `pack "${pack.id}" contains ${synthetic.length} synthetic scene(s) and carries no AI ` +
        "disclosure. Set aiDisclosure: true and put the disclosure where the viewer sees it.",
    });
  }

  // 4. Fail closed on omission — an undeclared source cannot back a real claim.
  if (undeclared.length > 0 && framingClaimsReality) {
    violations.push({
      code: "UNDECLARED_SCENE_SOURCE",
      detail:
        `pack "${pack.id}" is framed "${pack.framing}" but ${undeclared.length} scene(s) declare ` +
        `no source: ${undeclared.map((s) => s.id).join(", ")}. Unknown provenance cannot support ` +
        "a real-evidence claim — declare each scene real/ai/hybrid/stock/graphic.",
    });
  }

  return {
    ok: violations.length === 0,
    violations,
    requiresDisclosure,
    syntheticScenes: synthetic.map((s) => s.id),
  };
}

/** Throwing wrapper for call sites that must refuse to proceed. */
export function assertDisclosureCompliant(pack: ReelPack): void {
  const verdict = assessDisclosure(pack);
  if (!verdict.ok) {
    throw new Error(
      `Disclosure gate FAILED for pack "${pack.id}":\n` +
        verdict.violations.map((v) => `  · [${v.code}] ${v.detail}`).join("\n"),
    );
  }
}
