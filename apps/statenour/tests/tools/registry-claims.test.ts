import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { getToolCapabilities } from "../../lib/tools/tool-registry";
import { evaluateToolAction } from "../../lib/tools/tool-policy";

/**
 * Registry claims must stay true.
 *
 * 2026-08-03 · An external audit read `browser.*` and reported the tool
 * registry as lying: the entries carried "Stagehand SDK not installed."
 * while @browserbasehq/stagehand@3.7.0 was a pinned dep and
 * docs/UPSTREAMS.md recorded the lane ADOPTED. The clause was true when
 * written and rotted on 2026-07-22. Nothing caught it for twelve days
 * because the sentence was copy-pasted into four entries — no single
 * place read as one fact that could go stale.
 *
 * Same disease as the tool-count drift that catalog-integrity.test.ts
 * pins (113 -> 174 across audits because nothing pinned it), so: same
 * cure. These tests make the rot mechanical instead of a reading task.
 */

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

const pkg = JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
) as PackageJson;

const installedDeps = Object.keys({
  ...(pkg.dependencies ?? {}),
  ...(pkg.devDependencies ?? {}),
});

/** "@browserbasehq/stagehand" -> "stagehand" · "exceljs" -> "exceljs" */
function bareName(dep: string): string {
  return dep.includes("/") ? dep.slice(dep.lastIndexOf("/") + 1) : dep;
}

describe("tool registry claims match the repo", () => {
  it("never claims a package is uninstalled while it is a pinned dependency", () => {
    const violations: string[] = [];

    for (const cap of getToolCapabilities()) {
      for (const limitation of cap.currentLimitations) {
        if (!/not installed/i.test(limitation)) continue;

        for (const dep of installedDeps) {
          const token = bareName(dep);
          // Word-boundary so "ai" doesn't match "chain", "openai", etc.
          const mentions = new RegExp(`\\b${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
          if (mentions.test(limitation)) {
            violations.push(
              `${cap.id}: claims "not installed" but ${dep} is a dependency -- "${limitation}"`,
            );
          }
        }
      }
    }

    expect(violations).toEqual([]);
  });
});

describe("browser.* parking is an operator decision", () => {
  const BROWSER_IDS = ["browser.navigate", "browser.observe", "browser.extract", "browser.act"];

  /**
   * `status: "inert"` is a HARD EXECUTION GATE (tool-policy.ts denies
   * inert/scaffolded outright), not a cosmetic label. browser.act is
   * riskClass "critical" with externalMutation: true. An agent that
   * "fixes the stale registry" by flipping these to active/restricted
   * silently arms a critical browser-mutation tool.
   *
   * If you are here because this test failed: the operator must make
   * that call, not you. See docs/UPSTREAMS.md (Stagehand: ADOPTED) and
   * the BROWSER_PARKED_NOTE comment in tool-registry.ts.
   */
  it.each(BROWSER_IDS)("%s stays parked and unexecutable", (id) => {
    const cap = getToolCapabilities().find((c) => c.id === id);
    expect(cap, `${id} missing from TOOL_REGISTRY`).toBeDefined();
    expect(cap!.status).toBe("inert");

    // Assert on the verdict, not the reason: check #4 (missing env) runs
    // before check #5 (inert), so the *reason* depends on whether the
    // runner happens to have BROWSERBASE keys. "deny" holds either way.
    const decision = evaluateToolAction({ toolId: id, actionType: "execute" });
    expect(decision.decision, `${id} became executable -- parking is an operator decision`).toBe(
      "deny",
    );
  });
});
