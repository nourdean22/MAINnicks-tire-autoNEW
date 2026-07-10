/**
 * tests/meta/stale-docs-gate.test.ts · de-Venice control-plane lock.
 *
 * Locks that the stale-docs guard stays wired into BOTH gates so doc
 * drift (e.g. lingering Venice references in runbooks/audits) can't
 * merge silently. Pure fs reads — no mocks.
 *
 * Two halves:
 *   1. package.json — `verify:hard` must invoke `check:stale-docs` in
 *      strict mode (STALE_DOCS_STRICT=1), and the script must exist.
 *   2. CI workflow — the repo-root .github/workflows/test.yml must carry
 *      a statenour-scoped stale-doc guard step (`@statenour/web
 *      check:stale-docs` gated on the statenour change filter, with
 *      STALE_DOCS_STRICT), alongside the Turbo --affected pipeline.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

// __dirname = apps/statenour/tests/meta -> STATENOUR_ROOT = apps/statenour,
// REPO_ROOT = the worktree/repo root that holds .github/.
const STATENOUR_ROOT = path.resolve(__dirname, "..", "..");
const REPO_ROOT = path.resolve(STATENOUR_ROOT, "..", "..");

function read(rel: string, from = STATENOUR_ROOT): string {
  return readFileSync(path.resolve(from, rel), "utf-8");
}

describe("stale-docs gate · package.json wiring", () => {
  const pkg = JSON.parse(read("package.json")) as {
    scripts: Record<string, string>;
  };

  it("verify:hard invokes check:stale-docs", () => {
    expect(pkg.scripts["verify:hard"]).toBeTypeOf("string");
    expect(pkg.scripts["verify:hard"]).toContain("check:stale-docs");
  });

  it("verify:hard runs the stale-docs check in strict mode", () => {
    expect(pkg.scripts["verify:hard"]).toMatch(/STALE_DOCS_STRICT=1/);
  });

  it("the check:stale-docs script exists and points at the checker", () => {
    expect(pkg.scripts["check:stale-docs"]).toBeTypeOf("string");
    expect(pkg.scripts["check:stale-docs"]).toMatch(/check-stale-docs/);
  });
});

describe("stale-docs gate · CI workflow", () => {
  const workflow = read(".github/workflows/test.yml", REPO_ROOT);

  it("runs the Turbo affected verify pipeline", () => {
    expect(workflow.length).toBeGreaterThan(0);
    expect(workflow).toMatch(/turbo run check lint test build --affected/);
  });

  it("has a dedicated statenour stale-doc guard step (strict)", () => {
    expect(workflow).toMatch(/@statenour\/web check:stale-docs/);
    expect(workflow).toMatch(/STALE_DOCS_STRICT/);
    expect(workflow).toMatch(/(steps|needs)\.changes\.outputs\.statenour/);
  });
});

function walkDir(dir: string, callback: (filePath: string) => void) {
  const files = readdirSync(dir);
  for (const file of files) {
    const filePath = path.join(dir, file);
    const stat = statSync(filePath);
    if (stat.isDirectory()) {
      // Exclude tests, docs, node_modules, .next, .remember, etc.
      if (
        file === "node_modules" ||
        file === ".next" ||
        file === "tests" ||
        file === "docs" ||
        file === ".remember"
      ) {
        continue;
      }
      walkDir(filePath, callback);
    } else if (stat.isFile()) {
      callback(filePath);
    }
  }
}

describe("de-Venice drift guard", () => {
  it("ensures api.venice.ai is not referenced in any source files", () => {
    const violations: string[] = [];
    walkDir(STATENOUR_ROOT, (filePath) => {
      const ext = path.extname(filePath);
      if (![".ts", ".tsx", ".js", ".jsx", ".mjs", ".json"].includes(ext)) return;
      const content = readFileSync(filePath, "utf-8");
      if (content.includes("venice.ai")) {
        violations.push(path.relative(STATENOUR_ROOT, filePath));
      }
    });
    expect(violations).toEqual([]);
  });

  it("ensures retired files do not exist", () => {
    const { existsSync } = require("node:fs");
    expect(existsSync(path.resolve(STATENOUR_ROOT, "app/api/ai/venice-status/route.ts"))).toBe(false);
    expect(existsSync(path.resolve(STATENOUR_ROOT, "scripts/probe-venice-suggestions.mjs"))).toBe(false);
  });

  it("ensures specific files are cleaned of active Venice references", () => {
    const nextConfig = readFileSync(path.resolve(STATENOUR_ROOT, "next.config.ts"), "utf-8");
    expect(nextConfig).not.toContain("venice.ai");

    const healthTrpc = readFileSync(path.resolve(STATENOUR_ROOT, "lib/trpc/routers/system/health.ts"), "utf-8");
    expect(healthTrpc).not.toContain("veniceStatus");

    const chatSuggestions = readFileSync(path.resolve(STATENOUR_ROOT, "lib/services/chat-suggestions.ts"), "utf-8");
    expect(chatSuggestions).not.toContain('ai ? "venice" :');

    const hqStatus = readFileSync(path.resolve(STATENOUR_ROOT, "components/ultron/top-strip/hq-status-chips.tsx"), "utf-8");
    expect(hqStatus).not.toContain("Venice slow?");

    const errorDiag = readFileSync(path.resolve(STATENOUR_ROOT, "components/chat/error-diagnostic-panel.tsx"), "utf-8");
    expect(errorDiag).not.toContain("pinging Venice");

    const errorCard = readFileSync(path.resolve(STATENOUR_ROOT, "components/ui/error-card.tsx"), "utf-8");
    expect(errorCard).not.toContain('"chat:stream": "Venice');
    expect(errorCard).not.toContain('"chat:request": "The chat request couldn\'t even start. Check Venice');

    const telemetry = readFileSync(path.resolve(STATENOUR_ROOT, "components/brain/suggestion-telemetry-panel.tsx"), "utf-8");
    expect(telemetry).not.toContain("stats.veniceOk");
    expect(telemetry).not.toContain("stats.veniceFail");
    expect(telemetry).not.toContain("venice success rate");

    const directProbe = readFileSync(path.resolve(STATENOUR_ROOT, "scripts/probe-providers-direct.mjs"), "utf-8");
    expect(directProbe).not.toContain("VENICE_KEY");

    const safety = readFileSync(path.resolve(STATENOUR_ROOT, "scripts/_lib/safety.ts"), "utf-8");
    expect(safety).not.toContain("callVenice");

    const runnerState = readFileSync(path.resolve(STATENOUR_ROOT, "lib/services/runner-state.ts"), "utf-8");
    expect(runnerState).not.toContain('"venice"');
  });
});
