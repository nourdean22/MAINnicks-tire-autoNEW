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
import { extractTierJobNames } from "./cron/registry-tier-map";
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
    // ...and the wiring claim must match reality in BOTH directions. This
    // assertion once FORBADE "(in `verify` and in CI)" because the verify link
    // had been reverted and the doc still claimed it. Since 2026-08-27 the
    // link is real again, so the claim is REQUIRED. If the link is ever pulled
    // back out, flip this assertion WITH it — a doc claiming a wiring it does
    // not have is the exact defect this file exists to prevent.
    expect(doc, "the doc must state the verify+CI wiring that now exists")
      .toContain("(in `verify` and in CI)");
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

  it("is the 15th verify link AND in CI — wired 2026-08-27, exclusion retired", () => {
    // History: this test used to pin the OPPOSITE ("deliberately NOT in the
    // verify chain"). That exclusion was coordination-scoped, not principled:
    // adding the link would have drifted docs/agent-audit/CONTROL-CANARY-
    // COVERAGE.md's canary-gated counts while a concurrent session owned that
    // file. The 2026-08-27 run-to-empty batch landed the link and the count
    // update (14 -> 15 links) in ONE PR, so the drift the exclusion guarded
    // against cannot occur. Local coverage is also belt-and-braces: the same
    // comparison runs inside cronControlPlane.test.ts, which `pnpm test`
    // executes and `verify` includes.
    expect(pkg.scripts.verify).toContain("lint:cron-wiring");
    const suite = readFileSync(join(APP_ROOT, "server/cronControlPlane.test.ts"), "utf-8");
    expect(suite, "the local path also rides the unit suite").toContain(
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

  it("BREAKS: a tier LABEL is never mistaken for a scheduled job", () => {
    // Caught in review on #1808. Matching every `name:` swept up the five tier
    // labels (heartbeat, pulse, hourly, daily, briefings). A registry job named
    // `daily` with no tier job of that name - or an alias whose coveredBy is
    // `daily` - then produced ZERO faults and defeated the gate entirely, while
    // the aggregate parse check stayed green. Silent permission in a guard
    // built to catch exactly that class.
    const forged = [
      'tiers.push({',
      '  name: "daily",',
      '  intervalMs: 24 * 60 * 60 * 1000,',
      '  jobs: [',
      '    { name: "a-real-job", handler: async () => ({}) },',
      '  ],',
      '});',
    ].join(String.fromCharCode(10));

    const names = extractTierJobNames(forged);
    expect(names.has("a-real-job")).toBe(true);
    expect(names.has("daily"), "the tier label leaked in as a job").toBe(false);
  });

  it("a JOB that shares a tier's label is still counted", () => {
    // Exclusion is positional, not by name. Subtracting by name would have
    // traded this false negative for a different one.
    const forged = [
      'tiers.push({',
      '  name: "daily",',
      '  intervalMs: 1,',
      '  jobs: [',
      '    { name: "daily", handler: async () => ({}) },',
      '  ],',
      '});',
    ].join(String.fromCharCode(10));
    expect(extractTierJobNames(forged).has("daily")).toBe(true);
  });

  it("REAL SOURCE: the five tier labels are excluded from the job set", () => {
    const scheduler = readFileSync(join(APP_ROOT, "server/cron/scheduler.ts"), "utf-8");
    const jobs = extractTierJobNames(scheduler);
    for (const label of ["heartbeat", "pulse", "hourly", "daily", "briefings"]) {
      expect(jobs.has(label), `tier label "${label}" is being counted as a job`).toBe(false);
    }
    // ...and the instrument still sees plenty of real jobs.
    expect(jobs.size).toBeGreaterThan(100);
  });

  it("the gate and the suite share ONE extraction", () => {
    // Two copies is how the gate and the canary would drift into disagreeing
    // about what counts as wired.
    expect(gate).toContain("extractTierJobNames");
    expect(gate).toContain("extractRegistryJobNames");
    expect(gate).not.toMatch(/matchAll\(\/name: /);
  });

  it("the gate holds no logic of its own - scripts/ is not typechecked", () => {
    // apps/nickstire/AGENTS.md, "Typecheck blind spot": a broken import in a
    // script passes every gate and fails only at runtime. So the comparison
    // lives in the typechecked, unit-tested module and this file only parses.
    expect(gate).toContain('from "../server/cron/registry-tier-map"');
    expect(gate).not.toContain("function findCronWiringFaults");
  });
});
