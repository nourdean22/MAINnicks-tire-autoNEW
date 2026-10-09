/**
 * Repair routing (directive Part XV §63-64) — expands selective repair beyond
 * the single "regenerate a beat" unit. Each QA finding names a defect code;
 * this maps the code to the SMALLEST repair unit and the CHEAPEST method that
 * can fix it. The insight: a caption obstruction needs no paid regeneration —
 * it is a deterministic re-render; only genuine pixel defects (malformed
 * geometry, identity drift) need a paid provider re-generate.
 *
 * Pure classification — the executors live in their existing homes (assembly
 * re-render for caption/encode, provider regenerate for pixel defects). This
 * routes; it does not execute.
 */
import { RENDERED_DEFECT_CODES, type RenderedDefectCode, type RenderedFinding } from "./renderedQa";

export type RepairMethod =
  | "regenerate"      // paid provider re-gen of a beat (pixel defects)
  | "reassemble"      // deterministic ffmpeg re-render (caption/layout/encode)
  | "regrade"         // deterministic color pass
  | "remix";          // deterministic audio re-mix

export type RepairUnit =
  | "generated_beat" | "caption_segment" | "final_encode" | "color_grade" | "audio_mix";

export interface RepairRoute {
  code: RenderedDefectCode;
  beatNumber: number | null;
  method: RepairMethod;
  unit: RepairUnit;
  /** true => needs a paid provider call; false => deterministic, no spend */
  costsProviderCredits: boolean;
  preserve: string[];
  change: string[];
}

/** code -> cheapest repair unit/method. Pixel defects need paid regen; overlay
 *  and encode defects are deterministic. */
const CODE_ROUTES: Record<RenderedDefectCode, { method: RepairMethod; unit: RepairUnit; paid: boolean }> = {
  SUBJECT_CONTINUITY:     { method: "regenerate", unit: "generated_beat", paid: true },
  DAMAGE_LOCATION_DRIFT:  { method: "regenerate", unit: "generated_beat", paid: true },
  ENVIRONMENT_DRIFT:      { method: "regenerate", unit: "generated_beat", paid: true },
  MALFORMED_GEOMETRY:     { method: "regenerate", unit: "generated_beat", paid: true },
  GENERATED_TEXT_ARTIFACT:{ method: "regenerate", unit: "generated_beat", paid: true },
  BEAT_SEMANTIC_MISMATCH: { method: "regenerate", unit: "generated_beat", paid: true },
  MECHANICAL_MISREPRESENTATION: { method: "regenerate", unit: "generated_beat", paid: true },
  HUMAN_PRESENT:          { method: "regenerate", unit: "generated_beat", paid: true },
  // Same route as HUMAN_PRESENT — a drawn body cannot be regraded or recut
  // away, the beat has to be generated again. Kept as its own code because the
  // repair INSTRUCTION differs: recast the presence as light and motion rather
  // than simply remove a person.
  NARRATOR_EMBODIED:      { method: "regenerate", unit: "generated_beat", paid: true },
  // Deterministic — no provider spend:
  CAPTION_OBSTRUCTION:    { method: "reassemble", unit: "caption_segment", paid: false },
  LIGHTING_DRIFT:         { method: "regrade",    unit: "color_grade",    paid: false },
  PALETTE_DRIFT:          { method: "regrade",    unit: "color_grade",    paid: false },
  WEAK_COMPOSITION:       { method: "reassemble", unit: "final_encode",   paid: false },
  // Flashes come from the edit (strobe cuts, white-flash transitions) far more
  // often than from a generated clip, so the cheap honest first move is to
  // re-assemble. A flash baked into a clip survives that, and the next QA pass
  // measures it again and blocks again; it never reads as repaired.
  PHOTOSENSITIVE_FLASH:   { method: "reassemble", unit: "final_encode",   paid: false },
  // Craft codes. Routed honestly rather than cheaply.
  //
  // The tempting move is to send these to "regrade", which is free. It would
  // also be a lie: no colour pass adds pore detail to a plastic-looking tyre or
  // puts a contact shadow under a floating caliper. A route that cannot fix its
  // defect reports a successful repair over an unchanged frame, which is worse
  // than having no route at all.
  //
  // They rarely arrive here: clampVerdict declines a repair whose findings are
  // craft-only, so these route only when they ride along with a real block -
  // a beat already being regenerated, whose prompt can carry the material and
  // lighting corrections at no extra provider call.
  PLASTIC_AI_LOOK:        { method: "regenerate", unit: "generated_beat", paid: true },
  IMPOSSIBLE_PHYSICALITY: { method: "regenerate", unit: "generated_beat", paid: true },
  // The odd one out, and worth saying plainly: a generic frame is a brief
  // problem, not a render problem. Regenerating the same beat from the same
  // prompt produces the same anonymous shot. The route is recorded for
  // completeness; the actual fix is upstream, in a brief that names something
  // only this shop could show.
  GENERIC_STOCK_LOOK:     { method: "regenerate", unit: "generated_beat", paid: true },
};

export interface RepairRouteOptions {
  /**
   * Does a beat REGENERATION on the currently-selected provider actually cost
   * credits? Defaults TRUE (the historical assumption). The `paid` flags in
   * CODE_ROUTES were stamped when "regenerate" meant a Higgsfield call; under
   * the template_stock pin a regen is a local ffmpeg render that costs $0
   * (generationLedger.reelClipCostUsd === 0), and billing it as "paid" sent
   * free repairs to the operator-authorization hold — measured live: 39×
   * "held by rendered-QA gate (needs_paid_repair)" on free-lane job 1410001,
   * 2026-08-05/06. Same bug class selectiveRepair already fixed on the
   * execution side ("the gate is only as good as the number it is handed").
   * Deterministic routes are unaffected — they were never provider-priced.
   */
  beatRegenCostsCredits?: boolean;
}

/** Route one finding to its cheapest fix. */
export function routeFinding(f: RenderedFinding, opts: RepairRouteOptions = {}): RepairRoute {
  const r = CODE_ROUTES[f.code] ?? { method: "regenerate" as const, unit: "generated_beat" as const, paid: true };
  const regenCosts = opts.beatRegenCostsCredits !== false; // default true
  return {
    code: f.code,
    beatNumber: f.beatNumber,
    method: r.method,
    unit: r.unit,
    costsProviderCredits: r.method === "regenerate" ? r.paid && regenCosts : r.paid,
    preserve: f.preserve ?? [],
    change: f.change ?? [],
  };
}

/**
 * The beat a beat-regeneration repair targets first: the LOWEST-numbered blocked
 * beat whose finding routes to "regenerate". The critic judges continuity
 * against the establishing beat, so repairing beat 2 to match a broken beat 1
 * copies the defect forward. That is what job 2040001's paid repair did on
 * 2026-10-08: beat 1 showed a gouged hole instead of tread wear, the critic asked
 * beat 2 to "match beat 1's specific damage and large hole", and the re-render
 * scored worse. Ties keep the critic's order (Array.prototype.sort is stable).
 */
export function pickRepairTarget(findings: RenderedFinding[], opts: RepairRouteOptions = {}): RenderedFinding | undefined {
  return findings
    .filter((f) => f.severity === "block" && f.beatNumber != null && routeFinding(f, opts).method === "regenerate")
    .sort((a, b) => (a.beatNumber as number) - (b.beatNumber as number))[0];
}

export interface PaidRepairClearability {
  clearable: boolean;
  reason: string;
  /** distinct beats carrying a blocking, regenerable finding (ascending) */
  blockedBeats: number[];
  /** blocking, regenerable findings that name no beat */
  assetLevelBlocks: number;
  remainingAttempts: number;
}

/**
 * Can paid beat regenerations clear EVERY blocking finding within the repair
 * budget left on this asset? Each repair attempt regenerates one beat, and the
 * budget is per asset (`limits.maxRepairAttemptsPerAsset`, counted the way the
 * publish gate counts it: entries in `payload.repairQueue`). A verdict with
 * blocks on more beats than attempts remain, or with blocking defects that name
 * no beat, cannot pass after the spend, so the spend is waste. Job 2040001
 * (2026-10-08): blocks on beats 1, 2, 4 and 5 plus three asset-level blocks; one
 * paid beat-2 repair could never have passed it.
 *
 * Free routes (reassemble, regrade) are not counted: they cost no attempt.
 * Conservative on purpose: a "no" here holds the Reel for the operator, who can
 * still authorize a repair by hand. It never publishes anything.
 */
export function paidRepairCanClearVerdict(
  findings: RenderedFinding[],
  budget: { repairAttempts: number; maxRepairAttempts: number },
  opts: RepairRouteOptions = {},
): PaidRepairClearability {
  const regen = findings.filter((f) => f.severity === "block" && routeFinding(f, opts).method === "regenerate");
  const assetLevelBlocks = regen.filter((f) => f.beatNumber == null).length;
  const blockedBeats = [...new Set(regen.filter((f) => f.beatNumber != null).map((f) => f.beatNumber as number))].sort((a, b) => a - b);
  const used = Number.isFinite(budget.repairAttempts) ? Math.max(0, budget.repairAttempts) : 0;
  const cap = Number.isFinite(budget.maxRepairAttempts) ? Math.max(0, budget.maxRepairAttempts) : 0;
  const remainingAttempts = Math.max(0, cap - used);
  const base = { blockedBeats, assetLevelBlocks, remainingAttempts };
  if (assetLevelBlocks > 0) {
    return { clearable: false, reason: `${assetLevelBlocks} blocking finding(s) name no beat, so no beat regeneration can clear them`, ...base };
  }
  if (blockedBeats.length === 0) {
    return { clearable: false, reason: "no blocking finding is a regenerable beat defect", ...base };
  }
  if (blockedBeats.length > remainingAttempts) {
    return {
      clearable: false,
      reason: `blocks on beat(s) ${blockedBeats.join(", ")} need ${blockedBeats.length} regeneration(s); ${remainingAttempts} repair attempt(s) remain`,
      ...base,
    };
  }
  return { clearable: true, reason: `${blockedBeats.length} blocked beat(s) fit ${remainingAttempts} remaining attempt(s)`, ...base };
}

export interface RepairPlan {
  routes: RepairRoute[];
  paidRegenerations: number;
  deterministicFixes: number;
  /** cheapest-first: do all the free deterministic fixes before spending credits */
  order: RepairRoute[];
}

/**
 * Plan repairs for a set of findings. Dedupe on (code, beat); order
 * deterministic (free) fixes BEFORE paid regenerations so a caption fix never
 * waits on — or gets wasted by — a subsequent paid beat regen.
 */
export function planRepairs(findings: RenderedFinding[], opts: RepairRouteOptions = {}): RepairPlan {
  const seen = new Set<string>();
  const routes: RepairRoute[] = [];
  for (const f of findings) {
    if (!(f.code in RENDERED_DEFECT_CODES)) continue; // unknown codes never route
    const key = `${f.code}::${f.beatNumber ?? "x"}`;
    if (seen.has(key)) continue;
    seen.add(key);
    routes.push(routeFinding(f, opts));
  }
  const order = [...routes].sort((a, b) => Number(a.costsProviderCredits) - Number(b.costsProviderCredits));
  return {
    routes,
    paidRegenerations: routes.filter((r) => r.costsProviderCredits).length,
    deterministicFixes: routes.filter((r) => !r.costsProviderCredits).length,
    order,
  };
}
