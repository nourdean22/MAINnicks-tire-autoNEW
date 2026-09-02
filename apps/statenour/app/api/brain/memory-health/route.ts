/**
 * GET /api/brain/memory-health · v10.0.87 · 2026-05-02.
 *
 * Per-category brain-memory health rollup — counts, freshness, confidence,
 * vectorization coverage, and unhealthy-category flags. Consumed by the
 * Health tab on /brain.
 *
 * ══════════════════════════════════════════════════════════════════════
 * 2026-09-02 · DELEGATED. This route used to carry its OWN 100-line copy
 * of the aggregation.
 * ══════════════════════════════════════════════════════════════════════
 *
 * lib/services/brain-health.ts was extracted so that "the legacy REST endpoint
 * AND the new `brain.memoryHealth` tRPC procedure call the SAME function ·
 * drift between consumers structurally impossible" — its words. That was not
 * true: only the tRPC procedure was switched over, and this handler kept
 * running the duplicate.
 *
 * So when the same-day fix corrected the service — scoping vectorization
 * coverage to rows the embedder is eligible to take, and exempting telemetry
 * categories from `no_vectors` / `all_decayed` — this endpoint went on
 * serving the old `vectorized / live` percentage, capped below 100% by
 * construction, and the nine false red flags the fix removed. Two callers,
 * two answers, one of them wrong, and the comment asserting that could not
 * happen sat in the file that made it possible.
 *
 * Found in review on PR #2090. The duplicate is deleted rather than patched:
 * a second copy repaired is a second copy that can drift again.
 *
 * Auth: owner only — exposes detailed memory-store internals.
 */

import { apiHandler } from "@/lib/utils/http";
import { buildMemoryHealth } from "@/lib/services/brain-health";

export const GET = apiHandler(async () => buildMemoryHealth(), { auth: "owner" });
