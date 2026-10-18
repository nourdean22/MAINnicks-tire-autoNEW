/**
 * preflight.sh's "vitest related" step follows vitest's import graph, so a test
 * that READS a file as text (readFileSync on a source or a data file) is never
 * selected by it. scripts/preflight-text-scan.mjs closes that gap. Witnessed
 * 2026-10-18 on #3152: capability-ledger.json changed, preflight said "all green",
 * CI's node job failed on completionAuthority.test.ts, which reads that JSON at
 * runtime. One billed CI run. The scan takes data files (json, md) as well as ts.
 *
 * The test drives the CLI exactly as preflight.sh does, so what it proves is the
 * entry point in use, not an export.
 */
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

const APP = resolve(__dirname, "../..");
const scan = (...changed: string[]) =>
  execFileSync(process.execPath, [resolve(APP, "scripts/preflight-text-scan.mjs"), ...changed], { cwd: APP, encoding: "utf8" })
    .split(/\r?\n/)
    .filter(Boolean);

describe("preflight text scan selects tests that read a changed file as text", () => {
  it("a capability-ledger.json change selects completionAuthority.test.ts, which reads it at runtime", () => {
    expect(scan("docs/operations/capability-ledger.json")).toContain("server/completionAuthority.test.ts");
  });

  it("an unrelated change does not select it (control)", () => {
    expect(scan("server/services/no-such-module-for-this-test.ts")).not.toContain("server/completionAuthority.test.ts");
  });

  it("a changed test file is never a scan key (it runs by itself)", () => {
    expect(scan("server/completionAuthority.test.ts")).toEqual([]);
  });

  it("the 'dir', 'base' spelling (path.join style) is also a hit", () => {
    // completionAuthority.test.ts reads scripts/render-reality-ledger.mjs via resolve(cwd, "scripts/render-reality-ledger.mjs").
    expect(scan("scripts/render-reality-ledger.mjs")).toContain("server/completionAuthority.test.ts");
  });
});
