/**
 * tests/brain/recall-eval-lanes.test.ts · 2026-10-16 (Brain W1, the arbiter; round 1 P2-9)
 *
 * scripts/recall-eval.ts runs main() at import and needs a DATABASE_URL, so
 * its lanes are pinned by a source scan; the mapping an arbiter lane feeds the
 * runner with is proven against the real runner with a stubbed retriever.
 * The corpus file is absent on this machine: nothing here measures ranking.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { runRecallEval, SEED_CASES } from "@/lib/brain/recall-eval";
import { buildEvidencePack, toRetrievedMemories } from "@/lib/brain/evidence-pack";

const src = readFileSync(new URL("../../scripts/recall-eval.ts", import.meta.url), "utf8");

describe("recall-eval registers the memory-recall and arbiter lanes (W1)", () => {
  it("defines both lane builders and runs them beside vector / lexical / hybrid", () => {
    expect(src).toMatch(/async function memoryRecallRetriever\(\)/);
    expect(src).toMatch(/async function arbiterRetriever\(\)/);
    expect(src).toMatch(/runRecallEval\(cases, await memoryRecallRetriever\(\), K\)/);
    expect(src).toMatch(/runRecallEval\(cases, await arbiterRetriever\(\), K\)/);
    expect(src).toMatch(/line\("memory-recall"/);
    expect(src).toMatch(/line\("arbiter"/);
  });

  it("the memory-recall lane runs read-only (no lastSeen bump) and the arbiter lane builds the real pack", () => {
    expect(src).toMatch(/recallMemoriesForQuery\(/);
    expect(src).toMatch(/sideEffects:\s*false/);
    expect(src).toMatch(/buildEvidencePackAsync\(/);
    expect(src).toMatch(/toRetrievedMemories\(/);
  });

  it("the INVALID / DEGRADED embedding banner covers all three embedding-gated lanes", () => {
    expect(src).toMatch(/knnBanner\("hybrid"/);
    expect(src).toMatch(/knnBanner\("memory-recall"/);
    expect(src).toMatch(/knnBanner\("arbiter"/);
    expect(src).toMatch(/INVALID/);
    expect(src).toMatch(/SYNTHETIC ONLY/);
  });

  it("a memory-recall ERROR / UNMEASURED provenance marks the lane INVALID instead of scoring 0 (P2-9a)", () => {
    expect(src).toMatch(/provenance === "ERROR" \|\| [a-zA-Z.]+provenance === "UNMEASURED"/);
    expect(src).toMatch(/memoryRecallInvalid/);
    expect(src).toMatch(/laneInvalidBanner\("memory-recall"/);
  });

  it("an arbiter lane whose contextual onRanked never fired is reported hybrid-only and INVALID (P2-9b)", () => {
    expect(src).toMatch(/arbiterHybridOnly/);
    expect(src).toMatch(/ran hybrid-only/);
    expect(src).toMatch(/laneInvalidBanner\("arbiter"/);
  });

  it("the arbiter lane builds the pack at the production size (limit 10, window 20) and records it in the artifact (P2-9c)", () => {
    expect(src).toMatch(/ARBITER_PACK_LIMIT = 10/);
    expect(src).toMatch(/limit: ARBITER_PACK_LIMIT/);
    expect(src).toMatch(/arbiterConfig/);
  });

  it("both new lanes land in the JSON artifact beside the existing three", () => {
    expect(src).toMatch(/vector, lexical, hybrid, memoryRecall, arbiter/);
  });
});

describe("an arbiter-shaped retriever feeds runRecallEval (stubbed, no DB)", () => {
  it("runs every seed case and scores the pack's keys", async () => {
    const pack = buildEvidencePack(
      [{ memoryId: "h1", key: SEED_CASES[0].relevantKeys?.[0] ?? "k", category: "x", source: "manual", content: "seed target" }],
      [],
    );
    const retriever = async () => toRetrievedMemories(pack.items);
    const report = await runRecallEval(SEED_CASES, retriever, 5);
    expect(report.casesRun).toBe(SEED_CASES.length);
    expect(report.k).toBe(5);
    expect(report.cases.every((c) => Array.isArray(c.retrievedKeys))).toBe(true);
  });
});
