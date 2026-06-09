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

import fs from "node:fs";
import path from "node:path";
import { apiHandler } from "@/lib/utils/http";
import { MEMORY_EVALS } from "@/lib/evals/memory-evals";
import { runMemoryEvals } from "@/lib/evals/memory-eval-runner";

export const GET = apiHandler(
  async () => {
    const cwd = process.cwd();
    const docs = new Set(
      MEMORY_EVALS.map((e) => e.groundingDoc).filter(Boolean) as string[],
    );
    const sources: Record<string, string> = {};
    for (const rel of docs) {
      const full = path.join(cwd, rel);
      try {
        if (fs.existsSync(full)) sources[rel] = fs.readFileSync(full, "utf8");
      } catch {
        // ignore unreadable doc — eval reports as manual
      }
    }
    const result = runMemoryEvals(MEMORY_EVALS, { sources });
    return { ...result, sourcesFound: Object.keys(sources).length, sourcesExpected: docs.size };
  },
  { auth: "owner" }, // exposes which current-truth facts the docs do/don't teach
);
