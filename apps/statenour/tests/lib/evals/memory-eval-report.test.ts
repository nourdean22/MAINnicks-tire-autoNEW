import { describe, it, expect } from "vitest";
import { buildMemoryEvalReport } from "@/lib/evals/memory-eval-report";

describe("buildMemoryEvalReport", () => {
  it("reports all-manual + sourcesFound 0 when no docs are readable", () => {
    const r = buildMemoryEvalReport({ loadDoc: () => null });
    expect(r.sourcesFound).toBe(0);
    expect(r.sourcesExpected).toBeGreaterThan(0);
    expect(r.manual).toBe(r.total);
    expect(r.failed).toBe(0);
  });

  it("grades grounded evals when the truth docs are readable", () => {
    const r = buildMemoryEvalReport({
      loadDoc: (rel) =>
        rel === "docs/CURRENT-TRUTH.md"
          ? "Production deploys from main to Railway, bdnick.info. Vercel is retired. config/crons.ts is the cron source; config/repos.ts the repo source. CURRENT-TRUTH.md, AGENTS.md, RECONCILIATION first. live code wins. never paste an archived doc. check:stale-docs. column-first. apply-pending-migration + migrate status. accept-data-loss pgvector. lib/ai/provider.ts AI_PROVIDER. do not assert a model. nourcity."
          : null,
    });
    expect(r.sourcesFound).toBe(1);
    expect(r.passed).toBeGreaterThan(0);
    expect(r.datasetIssues).toEqual([]); // dataset stays valid
  });
});
