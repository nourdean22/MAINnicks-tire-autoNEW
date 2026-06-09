import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { MEMORY_EVALS } from "../../../lib/evals/memory-evals";
import {
  runMemoryEvals,
  validateDataset,
  gradeDoc,
  gradeAnswer,
} from "../../../lib/evals/memory-eval-runner";
import type { MemoryEval, MemoryEvalCategory } from "../../../lib/evals/memory-eval-types";

const ALL_CATEGORIES: MemoryEvalCategory[] = [
  "deployment_truth",
  "source_of_truth",
  "stale_doc_detection",
  "migration_safety",
  "action_honesty",
  "task_classification",
  "memory_kind",
  "business_context",
  "personal_os_context",
  "provider_truth",
];

describe("memory-eval dataset", () => {
  it("validates cleanly (no dup ids, facts + hints present)", () => {
    expect(validateDataset(MEMORY_EVALS)).toEqual([]);
  });

  it("has no duplicate ids", () => {
    const ids = MEMORY_EVALS.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("has at least 20 evals", () => {
    expect(MEMORY_EVALS.length).toBeGreaterThanOrEqual(20);
  });

  it("covers every category", () => {
    const present = new Set(MEMORY_EVALS.map((e) => e.category));
    for (const c of ALL_CATEGORIES) expect(present).toContain(c);
  });

  it("represents the forbidden stale/false claims", () => {
    const forbidden = MEMORY_EVALS.flatMap((e) => e.forbiddenClaims).map((c) => c.toLowerCase());
    for (const must of [
      "codex/ollama-local",
      "statenour-master",
      "deploys to vercel",
      "venice primary",
      "accept-data-loss",
      "dania neglect nudge",
    ]) {
      expect(forbidden).toContain(must);
    }
  });
});

describe("graders", () => {
  const deploy = MEMORY_EVALS.find((e) => e.id === "deploy-prod-source") as MemoryEval;

  it("gradeDoc passes when the doc teaches the facts", () => {
    const doc = "Production deploys from main via Railway to bdnick.info.";
    expect(gradeDoc(deploy, doc).status).toBe("pass");
  });

  it("gradeDoc fails when a fact is missing", () => {
    const doc = "Production deploys from main via Railway."; // no bdnick.info
    const r = gradeDoc(deploy, doc);
    expect(r.status).toBe("fail");
    expect(r.missingFacts).toContain("bdnick.info");
  });

  it("gradeDoc does NOT penalize a truth doc for naming retired terms", () => {
    const doc = "Deploys from main -> Railway -> bdnick.info. Vercel and codex/ollama-local are retired.";
    expect(gradeDoc(deploy, doc).status).toBe("pass"); // forbidden not applied to docs
  });

  it("gradeAnswer fails when an answer asserts a forbidden claim", () => {
    const r = gradeAnswer(deploy, "It deploys to Vercel from main, served at bdnick.info via Railway.");
    expect(r.status).toBe("fail");
    expect(r.presentForbidden).toContain("deploys to vercel");
  });

  it("gradeAnswer tolerates a negated mention (named, not claimed)", () => {
    const r = gradeAnswer(
      deploy,
      "It deploys from main via Railway to bdnick.info. Vercel is retired, not used.",
    );
    expect(r.status).toBe("pass");
  });

  it("gradeAnswer fails when a required fact is missing", () => {
    const r = gradeAnswer(deploy, "It deploys from main via Railway."); // no bdnick.info
    expect(r.status).toBe("fail");
    expect(r.missingFacts).toContain("bdnick.info");
  });
});

describe("runner", () => {
  it("marks everything manual with no sources/answers", () => {
    const r = runMemoryEvals(MEMORY_EVALS);
    expect(r.manual).toBe(r.total);
    expect(r.failed).toBe(0);
  });

  it("grades grounded evals when a source is supplied", () => {
    const r = runMemoryEvals(MEMORY_EVALS, {
      sources: { "docs/CURRENT-TRUTH.md": "main Railway bdnick.info" },
    });
    const deploy = r.results.find((x) => x.id === "deploy-prod-source");
    expect(deploy?.source).toBe("doc");
    expect(deploy?.status).toBe("pass");
  });

  it("is pure — identical inputs give identical results, no mutation", () => {
    const a = runMemoryEvals(MEMORY_EVALS);
    const b = runMemoryEvals(MEMORY_EVALS);
    expect(a).toEqual(b);
    // dataset not mutated
    expect(validateDataset(MEMORY_EVALS)).toEqual([]);
  });
});

describe("real grounding — CURRENT-TRUTH.md drift guard", () => {
  it("CURRENT-TRUTH.md teaches the critical deployment + provider facts", () => {
    const p = path.resolve(process.cwd(), "docs/CURRENT-TRUTH.md");
    const content = fs.readFileSync(p, "utf8");
    const r = runMemoryEvals(MEMORY_EVALS, { sources: { "docs/CURRENT-TRUTH.md": content } });
    const grounded = r.results.filter(
      (x) => x.source === "doc" && x.severity === "critical",
    );
    expect(grounded.length).toBeGreaterThan(0);
    for (const g of grounded) expect(g.status).toBe("pass");
  });
});
