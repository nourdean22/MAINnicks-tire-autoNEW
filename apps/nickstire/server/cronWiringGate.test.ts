/**
 * Canaries for the cron-wiring GATE and the doc it replaces (finding 3).
 *
 * The logic is already unit-tested in cronControlPlane.test.ts. What this file
 * pins is the part that made the original defect survive: a DOC SENTENCE that
 * closed a question a script could have kept open.
 *
 *   "every job in it duplicates a tiered job EXCEPT the two above"
 *
 * That clause was written after two stranded crons were found and fixed. It was
 * false - 8 of 33 registry jobs were absent from every tier by name, and two of
 * them were genuinely dead for months with ZERO cron_log rows all-time. The
 * clause is why nobody swept the class again.
 *
 * So: the clause must stay gone, the numbers that replaced it must stay
 * measured, and the gate that makes the doc unnecessary must stay wired.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const APP_ROOT = process.cwd();
const REPO_ROOT = join(APP_ROOT, "..", "..");

const doc = readFileSync(
  join(APP_ROOT, "docs/admin-surface-audit/code-underneath-audit-logic.md"),
  "utf-8",
);
const workflow = readFileSync(join(REPO_ROOT, ".github/workflows/test.yml"), "utf-8");
const gate = readFileSync(join(APP_ROOT, "scripts/lint-cron-wiring.ts"), "utf-8");
const pkg = JSON.parse(readFileSync(join(APP_ROOT, "package.json"), "utf-8")) as {
  scripts: Record<string, string>;
};

describe("canary - the completeness clause cannot come back", () => {
  it("BREAKS: the doc no longer ASSERTS the false clause", () => {
    // The clause may still appear - the corrected row QUOTES it to say what was
    // wrong, which is the honest way to retract a claim. So the rule is not
    // "never mention it" but "never assert it": every line containing it must
    // also mark it as corrected and false.
    //
    // The first draft of this canary was a bare not.toContain and failed on the
    // correction itself - the third mention-vs-execution false positive of this
    // session, and the exact shape guard-red-team warns about: a check that
    // blocks its own documentation gets deleted by the next frustrated reader.
    const lines = doc.split(String.fromCharCode(10)).filter((l) => l.includes("EXCEPT the two above"));
    for (const line of lines) {
      expect(line, "the clause appears without being marked as corrected").toContain("CORRECTED");
      expect(line, "the clause appears without being marked as false").toContain("FALSE");
    }
  });

  it("BREAKS: a bare restatement of the clause IS caught", () => {
    // Proves the rule above still fires on the thing it is meant to catch,
    // rather than passing vacuously because every line happens to say CORRECTED.
    const forged = "| every job in it duplicates a tiered job EXCEPT the two above. | x | y |";
    const offending = [forged].filter(
      (l) => l.includes("EXCEPT the two above") && !(l.includes("CORRECTED") && l.includes("FALSE")),
    );
    expect(offending).toHaveLength(1);
  });

  it("the row that replaced it carries the MEASURED numbers", () => {
    // Numbers, not adjectives - "some jobs" would have the same failure mode.
    expect(doc).toContain("33 registry jobs, 8 absent");
    expect(doc).toContain("campaign-resume");
    expect(doc).toContain("sms-learning-digest");
    // The production evidence that settled it, and the control that makes the
    // zero mean something.
    expect(doc).toMatch(/ZERO rows all-time/);
    expect(doc).toContain("2,344");
  });

  it("the doc points at the gate, so the next reader does not re-derive this", () => {
    expect(doc).toContain("lint:cron-wiring");
    // ...and must not claim a wiring it does not have.
    expect(doc, "the doc must not claim a verify link that was reverted")
      .not.toContain("(in `verify` and in CI)");
  });

  it("reports the base rate alongside the filtered rate", () => {
    // 24% would have sent someone chasing six non-defects. Both numbers or
    // neither - the naive name-check rate is not a finding about the population.
    expect(doc).toContain("2/33");
    expect(doc).toContain("8/33");
  });
});

describe("canary - the gate that replaces the sentence is wired", () => {
  it("the script exists as a named package script", () => {
    expect(pkg.scripts["lint:cron-wiring"]).toBe("tsx scripts/lint-cron-wiring.ts");
  });

  it("BREAKS: the gate runs in CI", () => {
    // A gate in package.json and in no job is the shape this whole session is
    // about. It is CI-only by design - see the note in the test below.
    expect(workflow).toContain("pnpm --filter nicks-tire-auto lint:cron-wiring");
  });

  it("is deliberately NOT in the verify chain, and that is not an oversight", () => {
    // Adding a 15th verify link would drift docs/agent-audit/CONTROL-CANARY-
    // COVERAGE.md, whose derived counts are themselves canary-gated - and that
    // file is owned by a concurrent session. Local coverage is not lost: the
    // same comparison runs inside cronControlPlane.test.ts, which `pnpm test`
    // executes and `verify` includes. If that ever stops being true, this test
    // is where to look.
    expect(pkg.scripts.verify).not.toContain("lint:cron-wiring");
    const suite = readFileSync(join(APP_ROOT, "server/cronControlPlane.test.ts"), "utf-8");
    expect(suite, "the local path depends on this test existing").toContain(
      "every job in registerAllJobs() is wired or aliased",
    );
  });

  it("the gate fails LOUD when it cannot parse its own inputs", () => {
    // A regex that silently stops matching would print "0 faults" forever.
    // Exit 2 is reserved for that case and is probed separately.
    expect(gate).toContain("FAILED TO PARSE");
    expect(gate).toMatch(/registryNames\.length < 20 \|\| tierNames\.size < 50/);
    expect(gate).toContain("process.exit(2)");
  });

  it("the gate holds no logic of its own - scripts/ is not typechecked", () => {
    // apps/nickstire/AGENTS.md, "Typecheck blind spot": a broken import in a
    // script passes every gate and fails only at runtime. So the comparison
    // lives in the typechecked, unit-tested module and this file only parses.
    expect(gate).toContain('from "../server/cron/registry-tier-map"');
    expect(gate).not.toContain("function findCronWiringFaults");
  });
});
