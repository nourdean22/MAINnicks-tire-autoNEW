/**
 * GET /api/cron/semantic-link · v10.0.89 · 2026-05-02.
 *
 * Builds embedding-based edges between brain memories. Runs nightly
 * (folded into mega-evening). Each pass scans 25 high-confidence
 * memories that haven't been linked in the last 7d.
 *
 * Edges are stored in BrainMemory category=semantic_edge so they
 * compose with the existing rule-driven auto-linker without
 * fighting it.
 */

import { cronHandler } from "@/lib/utils/http";
import { runSemanticLinker } from "@/lib/brain/semantic-link";

export const maxDuration = 120;

export const GET = cronHandler(async () => {
  return await runSemanticLinker({ batch: 25 });
});
