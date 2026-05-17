/**
 * scripts/audit-tasks-page-debt.ts · v10.0.422
 *
 * Tech-debt audit for app/(mastery)/tasks/page.tsx · driven by the
 * code-refactoring-tech-debt skill (~/.claude/skills/code-refactoring-tech-debt).
 *
 * Quantifies the 7-day audit's eyeball findings + adds new ones:
 *
 *   1. SIZE · file LOC + functional density (hook calls, useEffect count,
 *      useState count, useCallback count, useMemo count)
 *   2. RELOAD CASCADE · how many `load()` invocations · how many distinct
 *      reload triggers (mount, interval, visibility, event-bus, manual)
 *   3. STATE DUPLICATION · which states fetch the same upstream data
 *   4. ENVELOPE INCONSISTENCY · uses of unwrap() vs manual unwrapping
 *   5. ADD-PATH SPRAWL · how many distinct task creation flows
 *   6. PROP DRILLING · biggest LoopStream prop list
 *
 * Output: structured report · ranked by remediation impact.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

interface Finding {
  severity: "high" | "medium" | "low";
  category: string;
  detail: string;
  remediation: string;
  estimateLines: number;
}

const FILE = "app/(mastery)/tasks/page.tsx";

function main() {
  const text = readFileSync(resolve(process.cwd(), FILE), "utf8");
  const lines = text.split("\n");
  const findings: Finding[] = [];

  // 1. SIZE
  const loc = lines.length;
  const useStateCount = (text.match(/\buseState\s*[<(]/g) ?? []).length;
  const useEffectCount = (text.match(/\buseEffect\s*\(/g) ?? []).length;
  const useCallbackCount = (text.match(/\buseCallback\s*\(/g) ?? []).length;
  const useMemoCount = (text.match(/\buseMemo\s*\(/g) ?? []).length;
  const useRefCount = (text.match(/\buseRef\s*[<(]/g) ?? []).length;
  const totalHooks = useStateCount + useEffectCount + useCallbackCount + useMemoCount + useRefCount;

  console.log(`\n═══ /tasks page tech-debt audit · v10.0.422 ═══\n`);
  console.log(`FILE: ${FILE}`);
  console.log(`SIZE: ${loc} lines`);
  console.log(`HOOKS: ${totalHooks} total`);
  console.log(`  · useState     ${useStateCount}`);
  console.log(`  · useEffect    ${useEffectCount}`);
  console.log(`  · useCallback  ${useCallbackCount}`);
  console.log(`  · useMemo      ${useMemoCount}`);
  console.log(`  · useRef       ${useRefCount}`);

  if (loc > 1500) {
    findings.push({
      severity: "high",
      category: "size",
      detail: `${loc} LOC in one file · way over the ~500 line readability ceiling`,
      remediation: "Extract sub-components (TasksHeader, TasksList, ProjectsSection) + hooks (useTasksData, useTasksReload). Target: page.tsx ≤ 600 LOC.",
      estimateLines: -1100,
    });
  }
  if (totalHooks > 35) {
    findings.push({
      severity: "high",
      category: "hook-density",
      detail: `${totalHooks} hook call-sites in one component · cognitive load is severe`,
      remediation: "Group related state into custom hooks · operator-grade target ≤ 15 hooks per component.",
      estimateLines: 0,
    });
  }

  // 2. RELOAD CASCADE
  const loadCalls = (text.match(/\bload\(\)/g) ?? []).length;
  const reloadTriggers = [
    /useEffect\([\s\S]{0,80}load\(\)/g.test(text) ? "mount" : null,
    /setInterval\(\s*load/g.test(text) ? "interval" : null,
    /visibilityState/g.test(text) && /load\(\)/g.test(text) ? "visibility" : null,
    /onDataChanged\(/g.test(text) ? "event-bus" : null,
    loadCalls > 5 ? "manual-throughout" : null,
  ].filter(Boolean) as string[];

  console.log(`\nRELOADS: ${loadCalls} explicit load() calls · ${reloadTriggers.length} distinct triggers`);
  console.log(`  triggers: ${reloadTriggers.join(", ")}`);

  if (reloadTriggers.length >= 3) {
    findings.push({
      severity: "high",
      category: "reload-cascade",
      detail: `${reloadTriggers.length} reload triggers (${reloadTriggers.join(", ")}) all firing the same fetch with no coordination`,
      remediation: "Replace with a single debounced scheduler · `useTasksReload({ debounceMs: 300 })` · coalesces all triggers into one in-flight request.",
      estimateLines: -40,
    });
  }

  // 3. STATE DUPLICATION
  const goalsCount = (text.match(/setGoals\b/g) ?? []).length;
  const goalsCacheCount = (text.match(/setGoalsCache\b/g) ?? []).length;
  const apiGoalsFetches = (text.match(/authedFetch\(\s*["']\/api\/goals/g) ?? []).length;

  console.log(`\nSTATE DUPLICATION:`);
  console.log(`  /api/goals fetches: ${apiGoalsFetches}`);
  console.log(`  setGoals call sites: ${goalsCount}`);
  console.log(`  setGoalsCache call sites: ${goalsCacheCount}`);

  if (apiGoalsFetches >= 2) {
    findings.push({
      severity: "high",
      category: "state-duplication",
      detail: `${apiGoalsFetches} separate /api/goals fetches populate two parallel goal stores (goals + goalsCache). Double round-trip on every page load.`,
      remediation: "Drop one store · derive the other via useMemo. Pre-fix: 2 fetches, 2 setStates. Post-fix: 1 fetch, 1 source of truth.",
      estimateLines: -45,
    });
  }

  // 4. ENVELOPE INCONSISTENCY
  const unwrapCalls = (text.match(/\bunwrap\s*</g) ?? []).length;
  const manualUnwraps = (text.match(/d\?\.data\?\./g) ?? []).length + (text.match(/\?\?\s*[\w.]+\?\?/g) ?? []).length;
  console.log(`\nENVELOPE: ${unwrapCalls} unwrap() · ${manualUnwraps} manual unwraps`);

  if (manualUnwraps >= 2) {
    findings.push({
      severity: "medium",
      category: "envelope-inconsistency",
      detail: `${manualUnwraps} sites manually unwrap response envelopes despite hoisted unwrap() helper at top of file`,
      remediation: "Replace manual `d?.data?.x ?? d?.x ?? d` patterns with `unwrap(d)` · 1-line edit per site.",
      estimateLines: -10,
    });
  }

  // 5. ADD-PATH SPRAWL
  const createTaskSites = (text.match(/createTask\s*\(/g) ?? []).length;
  const addPaths = [
    /async\s+function\s+addTask/g.test(text) ? "addTask" : null,
    /onAdd=\{addTask\}/g.test(text) ? "QuickAdd" : null,
    /AiSuggestionsBand/g.test(text) ? "AI suggestions" : null,
    /NowOperatorBar/g.test(text) ? "Now operator bar" : null,
    /KommandoShell/g.test(text) ? "Kommando" : null,
  ].filter(Boolean) as string[];

  console.log(`\nADD-PATHS: ${createTaskSites} createTask call sites · ${addPaths.length} distinct UX paths`);
  console.log(`  paths: ${addPaths.join(", ")}`);

  if (createTaskSites >= 4) {
    findings.push({
      severity: "medium",
      category: "add-path-sprawl",
      detail: `${createTaskSites} createTask sites with no shared mutation handler · each site rebuilds its own success/error/reload logic`,
      remediation: "Extract `useTaskCreate()` hook · returns `{ create, busy, lastError }` · each UX path calls one helper.",
      estimateLines: -80,
    });
  }

  // 6. PROP DRILLING
  // Find the largest JSX prop list (heuristic · count `=` chars in <Component\n  prop=...>
  const propRuns = text.match(/<(LoopStream|ProjectDetail|ReviewWizard)\b[\s\S]{0,3000}?\/>/g) ?? [];
  const biggestProps = Math.max(
    ...propRuns.map((s) => (s.match(/^\s+\w+=/gm) ?? []).length),
    0,
  );
  console.log(`\nPROP-DRILLING: largest single component receives ${biggestProps} props`);
  if (biggestProps > 12) {
    findings.push({
      severity: "medium",
      category: "prop-drilling",
      detail: `${biggestProps}-prop component is hauling state through · context or composition would simplify`,
      remediation: "Use Context for shared state (selected mission/goal pickers) · or split the component into composition-friendly sub-trees.",
      estimateLines: -20,
    });
  }

  // ─── Print findings ──────────────────────────────────────
  console.log(`\n═══ Findings (${findings.length}) ═══\n`);
  findings.sort((a, b) => {
    const order = { high: 0, medium: 1, low: 2 };
    return order[a.severity] - order[b.severity];
  });

  for (const f of findings) {
    const tag =
      f.severity === "high" ? "🔴 HIGH" : f.severity === "medium" ? "🟡 MED " : "⚪ LOW ";
    console.log(`${tag} [${f.category}]`);
    console.log(`  ${f.detail}`);
    console.log(`  → ${f.remediation}`);
    if (f.estimateLines !== 0) {
      const sign = f.estimateLines < 0 ? "" : "+";
      console.log(`  ≈ ${sign}${f.estimateLines} lines after remediation`);
    }
    console.log("");
  }

  const totalDelta = findings.reduce((sum, f) => sum + f.estimateLines, 0);
  console.log(`Estimated net LOC delta after full remediation: ${totalDelta}`);
  console.log(`Projected post-fix size: ${loc + totalDelta} lines (was ${loc})`);
}

main();
