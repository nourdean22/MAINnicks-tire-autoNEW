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
  HUMAN_PRESENT:          { method: "regenerate", unit: "generated_beat", paid: true },
  // Deterministic — no provider spend:
  CAPTION_OBSTRUCTION:    { method: "reassemble", unit: "caption_segment", paid: false },
  LIGHTING_DRIFT:         { method: "regrade",    unit: "color_grade",    paid: false },
  PALETTE_DRIFT:          { method: "regrade",    unit: "color_grade",    paid: false },
  WEAK_COMPOSITION:       { method: "reassemble", unit: "final_encode",   paid: false },
};

/** Route one finding to its cheapest fix. */
export function routeFinding(f: RenderedFinding): RepairRoute {
  const r = CODE_ROUTES[f.code] ?? { method: "regenerate" as const, unit: "generated_beat" as const, paid: true };
  return {
    code: f.code,
    beatNumber: f.beatNumber,
    method: r.method,
    unit: r.unit,
    costsProviderCredits: r.paid,
    preserve: f.preserve ?? [],
    change: f.change ?? [],
  };
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
export function planRepairs(findings: RenderedFinding[]): RepairPlan {
  const seen = new Set<string>();
  const routes: RepairRoute[] = [];
  for (const f of findings) {
    if (!(f.code in RENDERED_DEFECT_CODES)) continue; // unknown codes never route
    const key = `${f.code}::${f.beatNumber ?? "x"}`;
    if (seen.has(key)) continue;
    seen.add(key);
    routes.push(routeFinding(f));
  }
  const order = [...routes].sort((a, b) => Number(a.costsProviderCredits) - Number(b.costsProviderCredits));
  return {
    routes,
    paidRegenerations: routes.filter((r) => r.costsProviderCredits).length,
    deterministicFixes: routes.filter((r) => !r.costsProviderCredits).length,
    order,
  };
}
