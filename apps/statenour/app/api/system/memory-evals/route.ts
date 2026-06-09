/**
 * GET /api/system/memory-evals · truth scoreboard.
 *
 * Read-only. Grades the memory-eval dataset against the repo truth docs that
 * are readable at runtime, plus dataset validity. Owner-gated (exposes which
 * truths the docs do/don't teach). Never writes anything.
 *
 * Degrades gracefully: if the Next standalone build didn't bundle docs/, the
 * grounded evals read as "manual" and `sourcesFound` is 0 — the deterministic
 * grading is also run in CI via `pnpm eval:memory`.
 */

import { apiHandler } from "@/lib/utils/http";
import { buildMemoryEvalReport } from "@/lib/evals/memory-eval-report";

export const GET = apiHandler(
  async () => buildMemoryEvalReport(),
  { auth: "owner" }, // exposes which current-truth facts the docs do/don't teach
);
