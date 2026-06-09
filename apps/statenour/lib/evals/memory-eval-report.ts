/**
 * Memory-eval report builder — reads the grounding docs that are readable at
 * runtime, runs the deterministic scoreboard, and reports coverage. Shared by
 * the REST route (/api/system/memory-evals) and the system.memoryEvals tRPC
 * query so they can't drift. Read-only. Degrades gracefully when docs/ isn't
 * bundled (grounded evals read as "manual", sourcesFound 0).
 */

import fs from "node:fs";
import path from "node:path";
import { MEMORY_EVALS } from "./memory-evals";
import { runMemoryEvals } from "./memory-eval-runner";
import type { MemoryEvalRunResult } from "./memory-eval-types";

export interface MemoryEvalReport extends MemoryEvalRunResult {
  sourcesFound: number;
  sourcesExpected: number;
}

export interface MemoryEvalReportDeps {
  loadDoc?: (relPath: string) => string | null;
}

function defaultLoadDoc(relPath: string): string | null {
  const full = path.join(process.cwd(), relPath);
  try {
    return fs.existsSync(full) ? fs.readFileSync(full, "utf8") : null;
  } catch {
    return null;
  }
}

/** Build the memory-eval report. Pure given an injected loadDoc. */
export function buildMemoryEvalReport(deps: MemoryEvalReportDeps = {}): MemoryEvalReport {
  const loadDoc = deps.loadDoc ?? defaultLoadDoc;
  const docs = new Set(MEMORY_EVALS.map((e) => e.groundingDoc).filter(Boolean) as string[]);
  const sources: Record<string, string> = {};
  for (const rel of docs) {
    const c = loadDoc(rel);
    if (c != null) sources[rel] = c;
  }
  const result = runMemoryEvals(MEMORY_EVALS, { sources });
  return { ...result, sourcesFound: Object.keys(sources).length, sourcesExpected: docs.size };
}
