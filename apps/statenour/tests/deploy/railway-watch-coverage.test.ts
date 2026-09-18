/**
 * A shared-package change MUST be able to trigger the deploy that consumes it.
 *
 * ★★★ THE DEFECT THIS ENCODES, MEASURED 2026-09-18 AGAINST LIVE RAILWAY.
 * `statenour-web` watched `["apps/statenour/**"]` and nothing else, while its
 * Dockerfile copies four workspace packages (utils, lenses, social-assets,
 * ai-capabilities) plus the lockfile. So editing `packages/utils` changed what
 * production WOULD build and did not cause production to build it. The old code
 * kept running until some unrelated `apps/statenour/**` commit happened to
 * trigger a rebuild — a deploy that silently does not happen, which is the
 * hardest kind to notice because every dashboard stays green.
 * `statenour-worker` had the same gap around `packages/reel-engine`.
 *
 * ★ WHY THIS GATE CAN EXIST AT ALL. docs/adr/0014-railway-root-directory-trap.md
 * considered a CI check against the Railway API and REJECTED it as
 * over-engineering: it needs API access plus secrets in CI. That reasoning was
 * right, and it is why this gate reads `railway.json` instead — moving the
 * patterns into version control (the ADR's own "revisit if it recurs" remedy)
 * turns an un-testable dashboard setting into two files this test can compare
 * with no network, no credentials and no Railway access whatsoever.
 *
 * ⚠ COVERAGE, NOT EQUALITY. The assertion is that every build input is watched,
 * never that the list matches exactly. Extra patterns are harmless — they cause
 * an unnecessary rebuild. A MISSING pattern is the bug. So this gate can only
 * push toward deploying more often, never less, which is the safe direction for
 * a check whose failure mode is "production quietly runs stale code".
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const REPO = join(__dirname, "../../../..");

/** Deployable services that build from this monorepo with a Dockerfile. */
const SERVICES = [
  { app: "apps/statenour", label: "statenour-web" },
  { app: "apps/worker", label: "statenour-worker" },
];

/**
 * Inputs every Dockerfile build depends on regardless of app: the pruner stage
 * resolves the workspace from these, so a change to any of them changes the
 * produced image.
 */
const ALWAYS_REQUIRED = ["pnpm-lock.yaml", "pnpm-workspace.yaml", "package.json"];

const readJson = (p: string) => JSON.parse(readFileSync(p, "utf8"));

/** package name -> directory, for every workspace package. */
function packageDirs(): Map<string, string> {
  const out = new Map<string, string>();
  for (const d of readdirSync(join(REPO, "packages"))) {
    const manifest = join(REPO, "packages", d, "package.json");
    if (!existsSync(manifest)) continue;
    out.set(readJson(manifest).name, `packages/${d}`);
  }
  return out;
}

/**
 * The workspace packages an app actually depends on, transitively.
 *
 * ⚠ DERIVED FROM package.json, NOT FROM THE DOCKERFILE. The manifest is what
 * `turbo prune` reads to decide what goes into the image, so it is the cause;
 * the Dockerfile's COPY lines are a hand-maintained echo of it. Asserting
 * against the echo would pass happily on the day the two drift apart — which is
 * exactly the day a package silently stops being deployed.
 */
export function workspaceClosure(appDir: string): string[] {
  const dirs = packageDirs();
  const byName = new Map([...dirs.entries()]);
  const seen = new Set<string>();
  const seed = (p: string): string[] => {
    const m = readJson(join(REPO, p, "package.json"));
    const deps = { ...(m.dependencies ?? {}), ...(m.devDependencies ?? {}) };
    return Object.entries(deps)
      .filter(([, v]) => typeof v === "string" && v.startsWith("workspace:"))
      .map(([k]) => k);
  };
  const stack = seed(appDir);
  while (stack.length > 0) {
    const name = stack.pop() as string;
    const dir = byName.get(name);
    if (!dir || seen.has(dir)) continue;
    seen.add(dir);
    stack.push(...seed(dir));
  }
  return [...seen].sort();
}

/**
 * Does `pattern` cause `required` to be watched?
 *
 * Patterns here are prefix globs (`packages/utils/**`) or exact files
 * (`pnpm-lock.yaml`). A bare `**` watches everything.
 */
export function covers(pattern: string, required: string): boolean {
  if (pattern === "**" || pattern === "**/*") return true;
  const prefix = pattern.replace(/\/\*\*(\/\*)?$/, "").replace(/\/$/, "");
  if (prefix === required) return true;
  // `packages/**` must cover `packages/utils`
  if (required.startsWith(`${prefix}/`)) return true;
  // `packages/utils/**` must cover a required dir `packages/utils`
  if (prefix.startsWith(`${required}/`)) return true;
  return false;
}

export function missingPatterns(required: string[], patterns: string[]): string[] {
  return required.filter((r) => !patterns.some((p) => covers(p, r)));
}

describe("railway watch patterns cover every build input", () => {
  for (const { app, label } of SERVICES) {
    it(`${label} watches everything its build consumes`, () => {
      const cfgPath = join(REPO, app, "railway.json");
      expect(existsSync(cfgPath), `${app}/railway.json must exist`).toBe(true);
      const cfg = readJson(cfgPath);
      const patterns: string[] = cfg?.build?.watchPatterns ?? [];

      expect(
        patterns.length,
        `${app}/railway.json has no build.watchPatterns. Without it Railway falls back ` +
          `to the dashboard setting, which is invisible to code review and was measured ` +
          `wrong on 2026-09-18.`,
      ).toBeGreaterThan(0);

      const required = [app, ...workspaceClosure(app), ...ALWAYS_REQUIRED];
      const missing = missingPatterns(required, patterns);

      expect(
        missing,
        `${label} builds from these paths but does not watch them, so changing one ` +
          `would NOT redeploy it and production would keep running the old code:\n` +
          missing.map((m) => `    - ${m}`).join("\n"),
      ).toEqual([]);
    });
  }

  it("the Dockerfile's copied packages are a subset of the declared closure", () => {
    // Catches the drift in the other direction: a COPY added to the Dockerfile
    // without a matching workspace dependency. That package would be in the
    // image but absent from the closure this gate derives, so it would be
    // silently unwatched even while this gate passed.
    for (const { app, label } of SERVICES) {
      const df = join(REPO, app, "Dockerfile");
      if (!existsSync(df)) continue;
      const copied = [
        ...readFileSync(df, "utf8").matchAll(/\/repo\/(packages\/[a-z0-9-]+)\//g),
      ].map((m) => m[1]);
      const closure = new Set(workspaceClosure(app));
      const strays = [...new Set(copied)].filter((p) => !closure.has(p));
      expect(
        strays,
        `${label}: Dockerfile copies ${strays.join(", ")} but package.json declares no ` +
          `workspace dependency on it — the closure this gate derives would miss it.`,
      ).toEqual([]);
    }
  });
});

/**
 * ── MUTATION FIXTURES ────────────────────────────────────────────────
 * The repo rule: no gate ships without a test that breaks it and asserts it
 * fails. A coverage check that can only ever pass proves nothing, and this
 * repo has shipped two of those in one night.
 */
describe("MUTATION · the coverage check actually rejects", () => {
  it("detects the exact live misconfiguration measured on 2026-09-18", () => {
    const wasLive = ["apps/statenour/**"];
    const required = ["apps/statenour", "packages/utils", "pnpm-lock.yaml"];
    expect(missingPatterns(required, wasLive)).toEqual(["packages/utils", "pnpm-lock.yaml"]);
  });

  it("accepts a correct superset", () => {
    const good = ["apps/statenour/**", "packages/utils/**", "pnpm-lock.yaml"];
    expect(missingPatterns(["apps/statenour", "packages/utils", "pnpm-lock.yaml"], good)).toEqual(
      [],
    );
  });

  it("a broad packages/** covers an individual package", () => {
    expect(covers("packages/**", "packages/utils")).toBe(true);
  });

  it("a DIFFERENT package does not count as coverage", () => {
    // The failure that would make this gate useless: treating any
    // packages/-prefixed pattern as covering every package.
    expect(covers("packages/lenses/**", "packages/utils")).toBe(false);
  });

  it("an empty pattern list covers nothing", () => {
    expect(missingPatterns(["apps/statenour"], [])).toEqual(["apps/statenour"]);
  });
});
