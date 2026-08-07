/**
 * Success-call audit · doctrine tests.
 *
 * The aperture-widening (2026-08-07) exists because every defect the evolution
 * loop had ever found came from calls ALREADY labeled a failure — it could
 * only ever rediscover what we already knew went wrong. These tests pin the
 * one property that keeps it safe: won calls are an AUDIT sample and must
 * never reach the optimizer's training pool.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SUCCESS_OUTCOMES } from "./promptEvolution";

const SERVICE_SRC = readFileSync(join(process.cwd(), "server/services/promptEvolution.ts"), "utf8");

/**
 * The body of ONE exported function. A slice that runs to end-of-file swallows
 * every later export — which is how the first version of these tests "failed"
 * by reading scorePrompt's judge call as auditSuccessCalls'.
 */
function bodyOf(name: string, endsBefore?: string): string {
  const start = SERVICE_SRC.indexOf(`export async function ${name}`);
  expect(start, `${name} not found`).toBeGreaterThan(-1);
  if (!endsBefore) return SERVICE_SRC.slice(start);
  const end = SERVICE_SRC.indexOf(endsBefore, start + 1);
  expect(end, `boundary "${endsBefore}" not found after ${name}`).toBeGreaterThan(start);
  return SERVICE_SRC.slice(start, end);
}

describe("SUCCESS_OUTCOMES", () => {
  it("names the outcomes classifyCall treats as wins, and none of the failure outcomes", () => {
    expect([...SUCCESS_OUTCOMES]).toEqual(["hard_conversion", "walk_in_directed", "human_handoff", "resolved_info"]);
    // The failure pool the optimizer trains on must stay disjoint.
    for (const failure of ["lost_opportunity", "callback_needed", "tech_failure"]) {
      expect(SUCCESS_OUTCOMES).not.toContain(failure);
    }
  });
});

describe("the optimizer can never train on a won call", () => {
  /**
   * The #1410 lesson one level further: training on mislabeled WINS poisons
   * the optimizer. Training on calls that genuinely converted would teach it
   * to "fix" what already works. runPromptEvolution must therefore never
   * reach loadSuccessSeeds — asserted structurally, because a wiring mistake
   * here is silent and would only show up as degraded prompts weeks later.
   */
  it("runPromptEvolution does not call loadSuccessSeeds or auditSuccessCalls", () => {
    // Slices to end-of-file deliberately: both audit symbols are defined
    // ABOVE runPromptEvolution, so anything they appear in downstream is a
    // real wiring, not a false positive.
    const body = bodyOf("runPromptEvolution");
    expect(body).not.toContain("loadSuccessSeeds");
    expect(body).not.toContain("auditSuccessCalls");
  });

  it("loadSeeds (the training pool) selects ONLY failure outcomes", () => {
    const start = SERVICE_SRC.indexOf("export async function loadSeeds");
    const body = SERVICE_SRC.slice(start, SERVICE_SRC.indexOf("export const SUCCESS_OUTCOMES"));
    expect(body).toContain("'lost_opportunity','callback_needed'");
    for (const win of SUCCESS_OUTCOMES) {
      expect(body, `loadSeeds must not select the winning outcome ${win}`).not.toContain(win);
    }
  });

  it("the audit grades on deterministic violations only — no judge call per won seed", () => {
    const body = bodyOf("auditSuccessCalls", "export async function scorePrompt");
    // A won call's resolution is not in question; re-confirming it with an LLM
    // judge would be measurement theatre at one API call per seed.
    // Assert on the CALL, not the mention — the function's own comment names
    // gradeRepliesWithJudge to explain why it is deliberately not used.
    expect(body).toMatch(/=\s*gradeReplies\(replies\)/);
    expect(body).not.toMatch(/await\s+gradeRepliesWithJudge\(/);
  });

  it("a defect is a COMPLIANCE breach, not a missing resolution", () => {
    const body = bodyOf("auditSuccessCalls", "export async function scorePrompt");
    // These three are disqualifying regardless of how the call ended.
    expect(body).toMatch(/g\.priceLeaks > 0 \|\| g\.guarantees > 0 \|\| g\.emptyReplies > 0/);
  });
});
