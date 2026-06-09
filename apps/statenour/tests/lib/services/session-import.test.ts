import { describe, it, expect } from "vitest";
import { parseSessionLog, importSession } from "@/lib/services/session-import";

const SAMPLE = `# Truth + Intelligence Wave Report

Branch: statenour-truth-intelligence-wave
Repo: nourdean22/MAINnicks-tire-autoNEW

## Commits shipped
- 01c5438c chore(statenour): quarantine stale context + add stale-doc guard
- 4ef690dc feat(statenour): add memory evals truth scoreboard
- a24d58d1 feat(statenour): add agent runbooks foundation

## Phases completed
- Phase 2 truth cleanup shipped
- Phase 6 runbooks committed

## Files changed
- docs/CURRENT-TRUTH.md
- scripts/check-stale-docs.ts
- lib/evals/memory-evals.ts

## Checks run
- pnpm typecheck 0 errors
- vitest 3093 tests passed
- pnpm build green

## Blockers
- The pre-push hook failed once on a Windows symlink error (non-fatal)

## Migrations
- Migration 0009_person_source_contact is pending, not applied to prod yet

## Production
- Not deployed yet — awaiting owner approval before pushing to main

## Risks
- WARNING: the receipts module is not wired into the live finalize path

## Next steps
- Wire action receipts into the chat finalize seam
- Deploy the wave to production once approved
`;

describe("parseSessionLog", () => {
  const d = parseSessionLog(SAMPLE);

  it("extracts a title", () => {
    expect(d.title.toLowerCase()).toContain("truth");
  });

  it("extracts repo + branch", () => {
    expect(d.repo).toBe("nourdean22/MAINnicks-tire-autoNEW");
    expect(d.branch).toBe("statenour-truth-intelligence-wave");
  });

  it("extracts commit SHAs", () => {
    expect(d.commits).toContain("01c5438c");
    expect(d.commits).toContain("4ef690dc");
    expect(d.commits).toContain("a24d58d1");
  });

  it("extracts conventional-commit subjects", () => {
    expect(d.commitSubjects.some((s) => s.includes("memory evals"))).toBe(true);
  });

  it("detects 'needs owner approval'", () => {
    expect(d.needsOwnerApproval).toBe(true);
  });

  it("detects a pending prod migration / deploy", () => {
    expect(d.prodMigrationOrDeployPending).toBe(true);
  });

  it("captures checks, blockers, migrations, warnings, next steps", () => {
    expect(d.checksRun.some((c) => /typecheck|vitest|build/i.test(c))).toBe(true);
    expect(d.blockers.length).toBeGreaterThan(0);
    expect(d.migrations.some((m) => /migration/i.test(m))).toBe(true);
    expect(d.warnings.some((w) => /receipts/i.test(w))).toBe(true);
    expect(d.nextSteps.length).toBeGreaterThan(0);
  });

  it("captures changed files", () => {
    expect(d.filesChanged).toContain("docs/CURRENT-TRUTH.md");
    expect(d.filesChanged).toContain("scripts/check-stale-docs.ts");
  });

  it("suggests follow-up tasks and flags sensitive (deploy) ones for approval", () => {
    expect(d.followUpSuggestions.length).toBeGreaterThan(0);
    const deploySuggestion = d.followUpSuggestions.find((s) => /deploy/i.test(s.title));
    expect(deploySuggestion?.requiresApproval).toBe(true);
  });

  it("is robust on empty / junk input", () => {
    const empty = parseSessionLog("");
    expect(empty.commits).toEqual([]);
    expect(empty.needsOwnerApproval).toBe(false);
    expect(empty.followUpSuggestions).toEqual([]);
    expect(parseSessionLog("just some random text with no structure").title.length).toBeGreaterThan(0);
  });

  it("does not false-positive owner-approval on a plain log", () => {
    expect(parseSessionLog("fixed a bug, ran tests, all green").needsOwnerApproval).toBe(false);
  });
});

describe("importSession (dry run — store:false, no DB)", () => {
  it("returns the digest + suggestions without persisting or creating tasks", async () => {
    const r = await importSession(SAMPLE, { store: false });
    expect(r.stored).toBe(false);
    expect(r.reportId).toBeNull();
    expect(r.digest.commits.length).toBe(3);
    // suggestions are returned, never created
    expect(r.suggestedTasks).toBe(r.digest.followUpSuggestions);
  });
});
