/**
 * Canaries for evaluator separation. Both directions: the gate must FIRE on a
 * candidate branch touching a judge, and must NOT fire on an ordinary branch
 * or on a candidate branch that only touches product code — a gate that
 * blocks every branch is disabled by the next frustrated human.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { assess, isEvaluatorPath, loadConfig } from "./check-evaluator-separation.mjs";

const cfg = loadConfig();

test("config parses and names the load-bearing evaluators", () => {
  for (const p of ["apps/nickstire/goals/", "apps/nickstire/shared/experimentKernel.ts", "apps/nickstire/shared/approvalGate.ts", "scripts/agent-os/", ".github/workflows/"]) {
    assert.ok(cfg.evaluatorPaths.includes(p), `${p} must be an evaluator path`);
  }
});

test("FIRES: a darwin/ branch that edits a goal contract", () => {
  const v = assess("darwin/hero-subline", ["apps/nickstire/client/src/pages/Home.tsx", "apps/nickstire/goals/nicks-public-tires-arrivals.json"], cfg);
  assert.equal(v.triggered, true);
  assert.equal(v.ok, false);
  assert.deepEqual(v.violations, ["apps/nickstire/goals/nicks-public-tires-arrivals.json"]);
});

test("FIRES: a night-shift/ branch that edits the kernel or an episode", () => {
  assert.equal(assess("night-shift/2026-09-16", ["apps/nickstire/shared/experimentKernel.ts"], cfg).ok, false);
  assert.equal(assess("night-shift/2026-09-16", ["apps/nickstire/tests/episodes/EP-001-x.json"], cfg).ok, false);
  assert.equal(assess("night-shift/2026-09-16", [".github/workflows/nickstire-proof.yml"], cfg).ok, false);
});

test("FIRES: the MEASUREMENT PATH is a judge — assignment, exposure/conversion sink, visitor id, the instrumentation test", () => {
  for (const p of [
    "apps/nickstire/client/src/hooks/useWebExperimentArm.ts",
    "apps/nickstire/client/src/hooks/useConversionTracking.ts",
    "apps/nickstire/client/src/lib/session.ts",
    "apps/nickstire/server/routes/analyticsRoutes.ts",
    "apps/nickstire/client/src/__tests__/experiment-instrumentation.test.tsx",
    "apps/nickstire/server/cron/jobs/webExperimentResolve.ts",
    "apps/statenour/app/api/sync/evidence/route.ts",
  ]) {
    const v = assess("night-shift/2026-09-16", ["apps/nickstire/client/src/pages/Home.tsx", p], cfg);
    assert.equal(v.ok, false, `${p} must be rejected on a candidate branch`);
    assert.deepEqual(v.violations, [p]);
  }
});

test("PASSES: a candidate branch that only touches product code", () => {
  const v = assess("darwin/hero-subline", ["apps/nickstire/client/src/pages/Home.tsx", "apps/nickstire/shared/webExperimentsCopy.ts"], cfg);
  assert.equal(v.triggered, true);
  assert.equal(v.ok, true);
});

test("NOT APPLICABLE: an ordinary branch may edit evaluators", () => {
  const v = assess("nickstire/dream-to-proof-wave", ["apps/nickstire/goals/x.json", "scripts/agent-os/check-evaluator-separation.mjs"], cfg);
  assert.equal(v.triggered, false);
  assert.equal(v.ok, true);
});

test("path matching is prefix-for-directories and exact-for-files, slash-normalised", () => {
  assert.equal(isEvaluatorPath("apps\\nickstire\\goals\\a.json", cfg), true);
  assert.equal(isEvaluatorPath("apps/nickstire/shared/experimentKernel.ts", cfg), true);
  assert.equal(isEvaluatorPath("apps/nickstire/shared/experimentKernel.test.ts", cfg), false);
  assert.equal(isEvaluatorPath("apps/nickstire/shared/shopState.ts", cfg), false);
});
