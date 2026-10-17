/**
 * Brain W4 deletions stay deleted (2026-10-16).
 *
 * Three one-line re-export shims (lib/ai/output-critic.ts, hallucination-guard.ts,
 * fact-check.ts -> `export * from "./chat/output-guardian"`) and
 * lib/brain/reflection-engine.ts (only tests imported it; production reflections
 * all come from lib/services/reflection.ts) were removed because they made
 * readers believe there were four modules where there is one.
 *
 * A deleted file is re-created by the first stale import that "fixes" a red
 * build, so this scans every module specifier (import, dynamic import, require,
 * vi.mock, relative or aliased) for the dead paths instead of trusting a grep
 * done once. The scan proves it can fire first (positive control).
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/** apps/statenour, from this file, so the scan cannot go vacuous under a different cwd. */
const ROOT = join(__dirname, "..", "..");

const DEAD_FILES = [
  "lib/ai/output-critic.ts",
  "lib/ai/hallucination-guard.ts",
  "lib/ai/fact-check.ts",
  "lib/brain/reflection-engine.ts",
];

/** A quoted specifier that resolves to one of the dead modules, alias or relative. */
const DEAD_SPECIFIER =
  /["'](?:@\/lib\/ai\/(?:output-critic|hallucination-guard|fact-check)|@\/lib\/brain\/reflection-engine|(?:\.{1,2}\/)+(?:lib\/)?(?:ai\/)?(?:output-critic|hallucination-guard|fact-check)|(?:\.{1,2}\/)+(?:lib\/)?(?:brain\/)?reflection-engine)(?:\.[cm]?[jt]sx?)?["']/g;

const ROOTS = ["lib", "app", "components", "features", "hooks", "tests", "scripts", "config"];
const SELF = "tests/repo/deleted-brain-w4-modules.test.ts";

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(?:[cm]?[jt]sx?)$/.test(p)) out.push(p);
  }
  return out;
}

function deadSpecifiers(src: string): string[] {
  return [...src.matchAll(DEAD_SPECIFIER)].map((m) => m[0]);
}

describe("brain W4 deletions", () => {
  it("positive control: the scan fires on every import shape", () => {
    const planted = [
      `import { critiqueOutput } from "@/lib/ai/output-critic";`,
      `const m = await import("@/lib/ai/hallucination-guard");`,
      `vi.mock("@/lib/ai/fact-check", () => ({}));`,
      `import { x } from "./output-critic";`,
      `import { runDailyReflection } from "@/lib/brain/reflection-engine";`,
      `require('../brain/reflection-engine.ts')`,
      // Relative paths that walk up and back down through lib/ (tests, scripts).
      `import { critiqueOutput } from "../../lib/ai/output-critic";`,
      `import { runDailyReflection } from "../lib/brain/reflection-engine";`,
      `vi.mock("../../../lib/ai/fact-check", () => ({}));`,
    ];
    for (const line of planted) expect(deadSpecifiers(line), line).toHaveLength(1);
    // The live module and the live reflection service are not matched.
    expect(deadSpecifiers(`import { x } from "@/lib/ai/chat/output-guardian";`)).toHaveLength(0);
    expect(deadSpecifiers(`import { x } from "@/lib/services/reflection";`)).toHaveLength(0);
  });

  it("the dead files are gone", () => {
    // Anchor: the live module resolves from ROOT, so "absent" below is not a wrong-root artifact.
    expect(existsSync(join(ROOT, "lib/ai/chat/output-guardian.ts"))).toBe(true);
    for (const f of DEAD_FILES) expect(existsSync(join(ROOT, f)), f).toBe(false);
  });

  it("no source, test or mock names a dead module", { timeout: 60_000 }, () => {
    const files = ROOTS.flatMap((r) => walk(join(ROOT, r)));
    // A wrong root makes walk() return [] and every check pass; this app has thousands.
    expect(files.length).toBeGreaterThan(100);
    const hits: string[] = [];
    for (const f of files) {
      const rel = relative(ROOT, f).replace(/\\/g, "/");
      if (rel === SELF) continue;
      for (const spec of deadSpecifiers(readFileSync(f, "utf8"))) hits.push(`${rel}: ${spec}`);
    }
    expect(hits).toEqual([]);
  });
});
