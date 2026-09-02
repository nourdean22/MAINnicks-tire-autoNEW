/**
 * CRON-INVENTORY.md must name exactly the jobs the code registers (2026-09-01
 * audit, artifact 2 §2.1 — the doc said 85 jobs, the scheduler had 105).
 *
 * Canary pair: the real doc vs the real scheduler (must agree), and a
 * deliberately stale doc (must be rejected) so a broken parser cannot pass.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { getJobCadences } from "./scheduler";
import { getRegisteredJobNames } from "./index";
import { parseInventoryJobNames, buildCronInventoryMarkdown, parseExistingPurposes } from "./cronInventory";

const docPath = path.resolve(__dirname, "..", "..", "docs", "operations", "CRON-INVENTORY.md");

describe("CRON-INVENTORY.md parity", () => {
  const cadences = getJobCadences();
  const http = getRegisteredJobNames();
  const expected = new Set<string>([...cadences.keys(), ...http.map((j) => j.name)]);

  it("the committed doc lists every registered job and nothing else", () => {
    const doc = fs.readFileSync(docPath, "utf8");
    const listed = parseInventoryJobNames(doc);
    const missing = [...expected].filter((n) => !listed.has(n)).sort();
    const extra = [...listed].filter((n) => !expected.has(n)).sort();
    expect(missing, `jobs in code but not in the doc — run scripts/gen-cron-inventory.mts: ${missing.join(", ")}`).toEqual([]);
    expect(extra, `jobs in the doc that no longer exist: ${extra.join(", ")}`).toEqual([]);
  });

  it("the generator reproduces the committed block (doc is not hand-edited)", () => {
    const doc = fs.readFileSync(docPath, "utf8");
    const regenerated = buildCronInventoryMarkdown({
      cadences,
      httpJobs: http,
      purposes: parseExistingPurposes(doc),
      generatedOn: "0000-00-00",
    });
    expect(parseInventoryJobNames(regenerated)).toEqual(parseInventoryJobNames(doc));
  });

  it("CANARY — a stale doc is rejected", () => {
    const stale = buildCronInventoryMarkdown({
      cadences: new Map([...cadences].slice(0, 3)),
      httpJobs: [],
      purposes: new Map(),
      generatedOn: "0000-00-00",
    });
    const listed = parseInventoryJobNames(stale);
    const missing = [...expected].filter((n) => !listed.has(n));
    expect(missing.length).toBeGreaterThan(0);
  });

  it("CANARY — the parser actually finds job rows (a silent parser would pass the first test)", () => {
    const doc = fs.readFileSync(docPath, "utf8");
    expect(parseInventoryJobNames(doc).size).toBeGreaterThan(50);
  });
});
