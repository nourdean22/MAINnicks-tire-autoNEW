
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  classifyCommitRelation,
  parseGraphReport,
} from "../../../../scripts/graphify-governance-receipt.mjs";

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const REPO_ROOT = resolve(APP_ROOT, "../..");

describe("Graphify governance receipt", () => {
  it("parses the pinned graph shape and source commit from GRAPH_REPORT", () => {
    const tick = String.fromCharCode(96);
    const report = [
      "# Graph Report - .  (2026-09-28)",
      "",
      "## Summary",
      "- 63,099 nodes · 115,045 edges · 3,401 communities (2,737 shown, 664 thin omitted)",
      "- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 2,162 edges (avg confidence: 0.65)",
      "",
      "## Graph Freshness",
      "- Built from commit: " + tick + "9c4f30f4" + tick,
    ].join("\n");

    expect(parseGraphReport(report)).toEqual({
      sourceCommit: "9c4f30f4",
      nodeCount: 63099,
      edgeCount: 115045,
      communityCount: 3401,
      communitiesShown: 2737,
      thinCommunitiesOmitted: 664,
      extraction: {
        extractedPct: 98,
        inferredPct: 2,
        ambiguousPct: 0,
        inferredEdges: 2162,
        inferredAvgConfidence: 0.65,
      },
    });
  });

  it("classifies current, tolerably behind, stale, divergent, and unknown distinctly", () => {
    expect(
      classifyCommitRelation({
        same: true,
        ancestor: true,
        commitsBehind: 0,
      }),
    ).toBe("current");
    expect(
      classifyCommitRelation({
        same: false,
        ancestor: true,
        commitsBehind: 4,
      }),
    ).toBe("ok");
    expect(
      classifyCommitRelation({
        same: false,
        ancestor: true,
        commitsBehind: 26,
      }),
    ).toBe("stale");
    expect(
      classifyCommitRelation({
        same: false,
        ancestor: false,
        commitsBehind: null,
      }),
    ).toBe("diverged");
    expect(
      classifyCommitRelation({
        same: false,
        ancestor: null,
        commitsBehind: null,
      }),
    ).toBe("unknown");
  });

  it("the scheduled sync runs necropsy and writes a governance receipt without replacing Graphify", () => {
    const sync = readFileSync(
      resolve(REPO_ROOT, "scripts/graphify-obsidian-sync.ps1"),
      "utf8",
    );

    expect(sync).toContain("scripts\\graphify-necropsy.mjs");
    expect(sync).toContain("scripts\\graphify-governance-receipt.mjs");
    expect(sync).toContain("--label-status $labelStatus");
    expect(sync).toContain("graph_core_success");
    expect(sync).toMatch(/NON-FATAL/i);
  });

  it("session-start consumes only a receipt that matches the exact selected report snapshot", () => {
    const context = readFileSync(
      resolve(REPO_ROOT, "scripts/graphify-session-context.ps1"),
      "utf8",
    );

    expect(context).toContain("GRAPH_RECEIPT.json");
    expect(context).toContain("RECEIPT MISMATCH");
    expect(context).toContain("$receiptCommit -ne $builtFrom");
    expect(context).toContain("Get-FileHash -Path $report -Algorithm SHA256");
    expect(context).toContain("$receiptHash.ToLowerInvariant() -ne $selectedHash");
    expect(context).toContain("graph necropsy:");
  });
});
