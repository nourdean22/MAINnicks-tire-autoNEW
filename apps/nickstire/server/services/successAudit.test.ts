/**
 * Success-call audit · doctrine tests.
 *
 * The aperture-widening (2026-08-07) exists because every defect the evolution
 * loop had ever found came from calls ALREADY labeled a failure — it could
 * only ever rediscover what we already knew went wrong. These tests pin the
 * one property that keeps it safe: won calls are an AUDIT and EVALUATOR
 * sample and must never reach the optimizer's training pool.
 *
 * CONTRACT CHANGE (2026-10-09, autoresearch wiring). This file used to pin
 * "runPromptEvolution does not call loadSuccessSeeds". The design now loads
 * won calls INSIDE runPromptEvolution as an evaluator-only success-regression
 * cohort (promptEvolutionGate.judgeSuccessCohort): a candidate that fixes
 * failures while breaking calls that already won must be vetoed, and that
 * needs the won calls. The old pin would forbid the veto, so it is replaced by
 * stronger ones that keep its intent -- "won calls are never training data":
 *   - STRUCTURAL (here): the optimizer is called exactly once, BEFORE won calls
 *     are loaded, with arguments that name no success-cohort binding; won calls
 *     flow only into cohort selection, scoring and the success gate; the
 *     compliance audit stays out of the runner. Each check is shown to FAIL on
 *     a mutated copy of the source, so a checker that matches nothing cannot
 *     pass.
 *   - BEHAVIOURAL (services/promptEvolution.integration.test.ts): with every
 *     lane mocked, a marker planted in the won calls never appears in any
 *     optimizer prompt, while the same marker does reach the replay lane (the
 *     cohort ran) and a failed-call marker does reach the optimizer (the
 *     instrument can see text at all).
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
  /**
   * Every way a won call could reach the optimizer through runPromptEvolution,
   * as a list of violations (empty = isolated). Reads the body from
   * `export async function runPromptEvolution` to end-of-file: every helper it
   * could route through is defined ABOVE it.
   */
  function successIsolationViolations(src: string): string[] {
    const start = src.indexOf("export async function runPromptEvolution");
    if (start < 0) return ["runPromptEvolution not found"];
    const body = src.slice(start);
    const out: string[] = [];
    const proposeAt = [...body.matchAll(/\bproposeCandidates\(/g)].map((m) => m.index ?? 0);
    const loadAt = [...body.matchAll(/\bloadSuccessSeeds\(/g)].map((m) => m.index ?? 0);
    if (proposeAt.length !== 1) out.push(`proposeCandidates is called ${proposeAt.length} times (expected exactly once)`);
    if (loadAt.length !== 1) out.push(`loadSuccessSeeds is called ${loadAt.length} times (expected exactly once)`);
    if (proposeAt.length && loadAt.length && Math.max(...proposeAt) > Math.min(...loadAt)) {
      out.push("the optimizer runs AFTER won calls are loaded");
    }
    // The bindings that hold won calls: the loader's result, and anything
    // derived from it by a declaration that names it.
    const tainted = new Set<string>();
    const load = /const\s+(\w+)\s*=\s*await\s+loadSuccessSeeds\(/.exec(body);
    if (load) tainted.add(load[1]);
    for (let grew = true; grew; ) {
      grew = false;
      for (const m of body.matchAll(/const\s+(\w+)\s*=\s*([^;]+);/g)) {
        if (!tainted.has(m[1]) && [...tainted].some((t) => new RegExp(`\\b${t}\\b`).test(m[2]))) {
          tainted.add(m[1]);
          grew = true;
        }
      }
    }
    // The optimizer's arguments name none of them.
    for (const at of proposeAt) {
      // A missing ");" anchor widens the scanned text, which can only ADD
      // "proposeCandidates receives X" violations, never hide one -- this slice fails closed.
      const args = body.slice(at, body.indexOf(");", at)); // fail-open-slice-ok
      for (const t of tainted) if (new RegExp(`\\b${t}\\b`).test(args)) out.push(`proposeCandidates receives ${t}`);
    }
    // And every use of a tainted binding is cohort selection, scoring, the
    // success gate, or its size -- nowhere a prompt is built.
    const allowed = /^(?:selectSuccessCohort\(|score\(|scorePrompt\(|toSuccessTrials\(|judgeSuccessCohort\(|\.length\b)/;
    for (const t of tainted) {
      for (const m of body.matchAll(new RegExp(`\\b${t}\\b`, "g"))) {
        const at = m.index ?? 0;
        const line = body.slice(body.lastIndexOf("\n", at) + 1, body.indexOf("\n", at));
        if (/^\s*const\s/.test(line) && line.includes(`const ${t}`)) continue; // its own declaration
        const before = body.slice(Math.max(0, at - 60), at);
        const after = body.slice(at + t.length);
        const call = /(\w+)\([^()]*$/.exec(before)?.[1] ?? "";
        if (!(allowed.test(`${call}(`) || allowed.test(after))) out.push(`${t} used outside the success gate: ${line.trim().slice(0, 100)}`);
      }
    }
    // The compliance audit is a CLI mode, never part of the gated run.
    if (/\bauditSuccessCalls\b/.test(body)) out.push("runPromptEvolution calls auditSuccessCalls");
    return out;
  }

  it("won calls reach runPromptEvolution only as an evaluator cohort: loaded after the single optimizer call, used only by the success gate", () => {
    expect(successIsolationViolations(SERVICE_SRC)).toEqual([]);
    // The check really bound the won-call variables (a checker that tainted
    // nothing would pass vacuously).
    expect(SERVICE_SRC).toMatch(/const\s+\w+\s*=\s*await\s+loadSuccessSeeds\(/);
  });

  it("POSITIVE CONTROLS: the isolation check fails on each way the wiring could leak", () => {
    const src = SERVICE_SRC;
    const body = (s: string) => s.slice(s.indexOf("export async function runPromptEvolution"));
    // 1. The optimizer moved after the won calls are loaded.
    const loadLine = /\n[^\n]*const\s+\w+\s*=\s*await\s+loadSuccessSeeds\([^\n]*/.exec(body(src))![0];
    const moved = src.replace(loadLine, "").replace(/(\n[^\n]*await proposeCandidates\()/, `${loadLine}$1`);
    expect(successIsolationViolations(moved)).toContain("the optimizer runs AFTER won calls are loaded");
    // 2. The cohort handed to the optimizer as failures.
    const cohortName = /const\s+(\w+)\s*=\s*selectSuccessCohort\(/.exec(src)![1];
    const fed = src.replace(/proposeCandidates\(baseline\.prompt, trainFailures/, `proposeCandidates(baseline.prompt, [...trainFailures, ...${cohortName}.map((seed) => ({ seed, grade: null as never }))]`);
    expect(fed).not.toBe(src);
    expect(successIsolationViolations(fed).join("\n")).toMatch(new RegExp(`proposeCandidates receives ${cohortName}`));
    // 3. Won-call text spliced into a brief-like string outside the gate.
    const spliced = src.replace(/(\n\s*cohorts\.success = )/, `\n    const wonBrief = ${cohortName}.map((s) => s.callerTurns[0]).join("\\n");$1`);
    expect(successIsolationViolations(spliced).join("\n")).toMatch(/used outside the success gate/);
    // 4. The compliance audit pulled into the run.
    const audited = src.replace(/(\n\s*cohorts\.success = )/, `\n    await auditSuccessCalls(baseline.prompt, ${cohortName});$1`);
    expect(successIsolationViolations(audited)).toContain("runPromptEvolution calls auditSuccessCalls");
    // 5. A second optimizer call.
    const twice = src.replace(/(\n\s*cohorts\.success = )/, `\n    await proposeCandidates(baseline.prompt, [], 1, log, () => {});$1`);
    expect(successIsolationViolations(twice).join("\n")).toMatch(/proposeCandidates is called 2 times/);
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
    // These are disqualifying regardless of how the call ended -- since
    // 2026-10-09 the live claim guard's labels too (a wait estimate, an
    // outcome promise inside a won call).
    expect(body).toMatch(/g\.priceLeaks > 0 \|\| g\.guarantees > 0 \|\| g\.emptyReplies > 0 \|\| g\.claimViolations\.length > 0/);
    expect(body).not.toMatch(/resolutionOffered\s*(?:===|!==|&&|\|\|)/);
  });
});
