/**
 * Canonical aiGeneration status vocabulary — the WRITERS define it:
 * lib/ai/track.ts defaults `status` to "complete", lib/ai/memory.ts
 * hardcodes "complete", and failure paths pass "error". A reader that
 * invents its own spelling fabricates a signal:
 *   · command-center-state excluded only completed/success/"" → every
 *     success counted as an error → the prompt's permanent
 *     "ai (100% err)" alarm (fixed #1450; prod probe 164/164 complete).
 *   · ai-cost counted `status === "failed"`, which no writer emits →
 *     failures/errorRate structurally ZERO on the cost dashboard
 *     (the 2026-07-30 trap-table row, still live until 2026-08-08).
 *
 * Readers that must stay in sync (2026-08-08 census):
 *   · lib/ai/context/command-center-state.ts — prompt SYSTEM HEALTH line
 *   · lib/services/ai-cost.ts — failures + per-group errorRate
 *   · lib/ai/provider-health.ts — `status: { not: "complete" }` (ok today)
 *   · lib/services/system-pulse.ts — raw SQL `status <> 'complete'` (ok today)
 */
export const AI_GENERATION_SUCCESS_STATUSES = ["complete", "completed", "success", ""] as const;

/** True iff this aiGeneration row represents a FAILED call. Null/absent
 *  status maps to success — mirrors the pre-2026-06 "status truthy"
 *  clause; writers never emit null in practice. */
export function isAiGenerationError(status: string | null | undefined): boolean {
  return !(AI_GENERATION_SUCCESS_STATUSES as readonly string[]).includes(status ?? "");
}
