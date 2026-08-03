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

/**
 * Category words that are package-name SUFFIXES, not package identities.
 * `@modelcontextprotocol/sdk` reduces to the bare token "sdk", so matching
 * bare names blindly made a truthful future limitation like "Browser SDK
 * not installed" fail the suite — flagging a claim about a package that
 * genuinely is not installed. A scanner that cries wolf gets deleted, so
 * these force a match on the FULL scoped name instead.
 */
const GENERIC_NAME_PARTS = new Set([
  "sdk", "api", "cli", "core", "client", "server", "common", "utils",
  "types", "node", "react", "plugin", "adapter", "config", "shared",
]);

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The token(s) that actually IDENTIFY this package in prose.
 *
 * "@browserbasehq/stagehand"  -> ["stagehand"]                 specific enough
 * "@modelcontextprotocol/sdk" -> ["@modelcontextprotocol/sdk"] generic bare name,
 *                                                              so demand the full name
 * "ai"                        -> []                            UNSCOPED and generic:
 *   there is no more-specific form to fall back on, so this package cannot be
 *   named unambiguously in prose at all. Deliberate false NEGATIVE — a scanner
 *   that flags "the AI helper is not installed" gets muted, and a muted scanner
 *   catches nothing. Scoped packages keep full coverage via their full name.
 */
function identifiersFor(dep: string): string[] {
  const scoped = dep.includes("/");
  const bare = scoped ? dep.slice(dep.lastIndexOf("/") + 1) : dep;
  const tooGeneric = GENERIC_NAME_PARTS.has(bare.toLowerCase()) || bare.length <= 3;
  if (!tooGeneric) return [bare];
  return scoped ? [dep] : [];
}

/**
 * Boundaries that work for scoped names too. `\b` is useless here: it needs a
 * word/non-word transition, and "@modelcontextprotocol/sdk" STARTS with "@",
 * so `\b@` never matches at position 0. Excluding only [\w-] on each side lets
 * "/" and "@" sit adjacent, so bare "stagehand" still matches inside
 * "@browserbasehq/stagehand" while "stagehandxyz" stays unmatched.
 */
const boundedRe = (id: string) => new RegExp(`(?<![\\w-])${escape(id)}(?![\\w-])`, "i");

/** Every dependency this limitation string names as uninstalled. */
export function falselyClaimedUninstalled(
  limitation: string,
  deps: readonly string[],
): string[] {
  if (!/not installed/i.test(limitation)) return [];
  return deps.filter((dep) => identifiersFor(dep).some((id) => boundedRe(id).test(limitation)));
}

describe("tool registry claims match the repo", () => {
  it("never claims a package is uninstalled while it is a pinned dependency", () => {
    const violations: string[] = [];

    for (const cap of getToolCapabilities()) {
      for (const limitation of cap.currentLimitations) {
        for (const dep of falselyClaimedUninstalled(limitation, installedDeps)) {
          violations.push(
            `${cap.id}: claims "not installed" but ${dep} is a dependency -- "${limitation}"`,
          );
        }
      }
    }

    expect(violations).toEqual([]);
  });
});

describe("the claim scanner does not cry wolf", () => {
  // Regression for the exact false positive found in review: the generic
  // token "sdk" (from @modelcontextprotocol/sdk) must not make a TRUTHFUL
  // claim about some other package register as a violation.
  const deps = ["@modelcontextprotocol/sdk", "@browserbasehq/stagehand", "ai", "exceljs"];

  it("flags a claim naming a package that IS installed", () => {
    expect(falselyClaimedUninstalled("Stagehand SDK not installed.", deps)).toEqual([
      "@browserbasehq/stagehand",
    ]);
  });

  it("does NOT flag a truthful claim about a package that is absent", () => {
    // "Browser" is not a dependency; the trailing "SDK" must not match
    // @modelcontextprotocol/sdk.
    expect(falselyClaimedUninstalled("Browser SDK not installed.", deps)).toEqual([]);
  });

  it("does NOT let a 2-3 char package name match unrelated prose", () => {
    expect(falselyClaimedUninstalled("The AI helper is not installed.", deps)).toEqual([]);
  });

  it("still flags a generic-named package when its FULL name is used", () => {
    expect(
      falselyClaimedUninstalled("@modelcontextprotocol/sdk not installed.", deps),
    ).toEqual(["@modelcontextprotocol/sdk"]);
  });

  it("ignores limitations that make no installation claim at all", () => {
    expect(falselyClaimedUninstalled("Stagehand is parked by choice.", deps)).toEqual([]);
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
