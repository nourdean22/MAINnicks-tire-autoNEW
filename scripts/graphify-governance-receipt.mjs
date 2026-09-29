#!/usr/bin/env node
/**
 * Compact governance receipt for the existing Graphify snapshot.
 *
 * Graphify's manifest.json is its large per-file AST cache. This script writes
 * a separate GRAPH_RECEIPT.json with source commit, freshness, shape, labeling
 * provenance, architecture deltas, and importer-death docket state.
 *
 * It never edits code, fetches remotes, or promotes graph output into memory.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const RECEIPT_SCHEMA_VERSION = 1;
export const DEFAULT_STALE_COMMIT_THRESHOLD = 25;

function intValue(raw) {
  return Number.parseInt(String(raw).replaceAll(",", ""), 10);
}

function numberValue(raw) {
  return Number.parseFloat(String(raw).replaceAll(",", ""));
}

export function parseGraphReport(text) {
  const summary = text.match(
    /^- ([\d,]+) nodes · ([\d,]+) edges · ([\d,]+) communities \(([\d,]+) shown, ([\d,]+) thin omitted\)$/m,
  );
  const extraction = text.match(
    /^- Extraction: ([\d.]+)% EXTRACTED · ([\d.]+)% INFERRED · ([\d.]+)% AMBIGUOUS · INFERRED: ([\d,]+) edges \(avg confidence: ([\d.]+)\)$/m,
  );
  const source = text.match(/Built from commit:\s*\x60([0-9a-f]+)\x60/i);

  if (!summary || !source) {
    throw new Error(
      "GRAPH_REPORT.md is missing the expected Summary or Built from commit fields",
    );
  }

  return {
    sourceCommit: source[1].toLowerCase(),
    nodeCount: intValue(summary[1]),
    edgeCount: intValue(summary[2]),
    communityCount: intValue(summary[3]),
    communitiesShown: intValue(summary[4]),
    thinCommunitiesOmitted: intValue(summary[5]),
    extraction: extraction
      ? {
          extractedPct: numberValue(extraction[1]),
          inferredPct: numberValue(extraction[2]),
          ambiguousPct: numberValue(extraction[3]),
          inferredEdges: intValue(extraction[4]),
          inferredAvgConfidence: numberValue(extraction[5]),
        }
      : null,
  };
}

export function classifyCommitRelation(input) {
  const threshold =
    input.threshold === undefined
      ? DEFAULT_STALE_COMMIT_THRESHOLD
      : input.threshold;
  if (input.same) return "current";
  if (input.ancestor === false) return "diverged";
  if (input.ancestor !== true || !Number.isFinite(input.commitsBehind)) {
    return "unknown";
  }
  return input.commitsBehind > threshold ? "stale" : "ok";
}

function git(repo, args) {
  try {
    return execFileSync("git", ["-C", repo, ...args], {
      encoding: "utf8",
      timeout: 15000,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

function gitStatus(repo, args) {
  const result = spawnSync("git", ["-C", repo, ...args], {
    encoding: "utf8",
    timeout: 15000,
    stdio: "ignore",
  });
  return result.status;
}

export function compareCommit(repo, sourceCommit, targetRef) {
  const sourceFull = git(repo, ["rev-parse", sourceCommit + "^{commit}"]);
  const targetFull = git(repo, ["rev-parse", targetRef + "^{commit}"]);

  if (!sourceFull || !targetFull) {
    return {
      targetRef,
      targetCommit: targetFull,
      state: "unknown",
      commitsBehind: null,
    };
  }

  const same = sourceFull === targetFull;
  let ancestor = null;
  let commitsBehind = null;

  if (same) {
    ancestor = true;
    commitsBehind = 0;
  } else {
    const status = gitStatus(repo, [
      "merge-base",
      "--is-ancestor",
      sourceFull,
      targetFull,
    ]);
    ancestor = status === 0 ? true : status === 1 ? false : null;
    if (ancestor) {
      const count = git(repo, [
        "rev-list",
        "--count",
        sourceFull + ".." + targetFull,
      ]);
      commitsBehind =
        count && /^\d+$/.test(count) ? Number.parseInt(count, 10) : null;
    }
  }

  return {
    targetRef,
    targetCommit: targetFull,
    state: classifyCommitRelation({ same, ancestor, commitsBehind }),
    commitsBehind,
  };
}

function reportPathIn(dir) {
  const candidate = join(dir, "GRAPH_REPORT.md");
  return existsSync(candidate) ? candidate : null;
}

export function findPreviousSnapshot(outDir, sourceCommit) {
  if (!existsSync(outDir)) return null;

  const dirs = readdirSync(outDir, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(entry.name),
    )
    .map((entry) => entry.name)
    .sort()
    .reverse();

  for (const date of dirs) {
    const reportPath = reportPathIn(join(outDir, date));
    if (!reportPath) continue;
    try {
      const parsed = parseGraphReport(readFileSync(reportPath, "utf8"));
      if (parsed.sourceCommit !== sourceCommit) {
        return { date, reportPath, parsed };
      }
    } catch {
      // Malformed historical snapshots are skipped, never allowed to poison
      // today's receipt.
    }
  }
  return null;
}

function parseNecropsy(outDir) {
  const path = join(outDir, "NECROPSY.md");
  if (!existsSync(path)) {
    return { path: null, importerDeaths: null };
  }
  try {
    const text = readFileSync(path, "utf8");
    const match = text.match(/\*\*(\d+) death event\(s\)\.\*\*/);
    return {
      path: "graphify-out/NECROPSY.md",
      importerDeaths: match ? Number.parseInt(match[1], 10) : null,
    };
  } catch {
    return {
      path: "graphify-out/NECROPSY.md",
      importerDeaths: null,
    };
  }
}

function graphifyVersion() {
  try {
    const out = execFileSync("graphify", ["--version"], {
      encoding: "utf8",
      timeout: 10000,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return out || null;
  } catch {
    return null;
  }
}

export function buildReceipt(input) {
  const parsed = parseGraphReport(input.reportText);
  const outDir = join(input.repo, "graphify-out");
  const previous = findPreviousSnapshot(outDir, parsed.sourceCommit);
  const necropsy = parseNecropsy(outDir);
  const reportStat = statSync(input.reportPath);

  const delta = previous
    ? {
        previousSnapshotDate: previous.date,
        previousSourceCommit: previous.parsed.sourceCommit,
        nodeDelta: parsed.nodeCount - previous.parsed.nodeCount,
        edgeDelta: parsed.edgeCount - previous.parsed.edgeCount,
        communityDelta: parsed.communityCount - previous.parsed.communityCount,
      }
    : null;

  return {
    schemaVersion: RECEIPT_SCHEMA_VERSION,
    generatedAt: input.generatedAt || new Date().toISOString(),
    generator: "scripts/graphify-governance-receipt.mjs",
    runStatus: input.runStatus || "manual_evaluation",
    labelProvenance: input.labelProvenance || "unknown",
    graphifyVersion: graphifyVersion(),
    report: {
      path: "graphify-out/GRAPH_REPORT.md",
      sourceCommit: parsed.sourceCommit,
      sha256: createHash("sha256").update(input.reportText).digest("hex"),
      modifiedAt: reportStat.mtime.toISOString(),
      nodeCount: parsed.nodeCount,
      edgeCount: parsed.edgeCount,
      communityCount: parsed.communityCount,
      communitiesShown: parsed.communitiesShown,
      thinCommunitiesOmitted: parsed.thinCommunitiesOmitted,
      extraction: parsed.extraction,
    },
    comparedTo: {
      head: compareCommit(input.repo, parsed.sourceCommit, "HEAD"),
      originMain: compareCommit(input.repo, parsed.sourceCommit, "origin/main"),
    },
    architectureDelta: delta,
    importerDeathDocket: necropsy,
    caveats: [
      "origin/main is the locally observed remote-tracking ref; this script never fetches.",
      "Graphify includes documentation nodes; node and edge deltas are drift signals, not quality scores.",
      "Community ids are unstable across reclustering and must not be compared across runs.",
      "This receipt governs the graph artifact only; Graphify is not canonical product memory.",
    ],
  };
}

function parseArgs(argv) {
  const args = {
    repo: process.cwd(),
    labelStatus: "unknown",
    runStatus: "manual_evaluation",
    selfTest: false,
  };

  for (let index = 0; index < argv.length; index++) {
    if (argv[index] === "--repo") args.repo = argv[++index];
    else if (argv[index] === "--label-status") {
      args.labelStatus = argv[++index];
    } else if (argv[index] === "--run-status") {
      args.runStatus = argv[++index];
    } else if (argv[index] === "--self-test") {
      args.selfTest = true;
    }
  }

  return args;
}

function selfTest() {
  const fixture = [
    "# Graph Report - .  (2026-09-28)",
    "",
    "## Summary",
    "- 100 nodes · 250 edges · 12 communities (10 shown, 2 thin omitted)",
    "- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 5 edges (avg confidence: 0.65)",
    "",
    "## Graph Freshness",
    "- Built from commit: " + String.fromCharCode(96) + "abc12345" + String.fromCharCode(96),
  ].join("\n");

  const parsed = parseGraphReport(fixture);
  const ok =
    parsed.sourceCommit === "abc12345" &&
    parsed.nodeCount === 100 &&
    parsed.edgeCount === 250 &&
    parsed.communityCount === 12 &&
    parsed.extraction &&
    parsed.extraction.inferredEdges === 5 &&
    classifyCommitRelation({
      same: true,
      ancestor: true,
      commitsBehind: 0,
    }) === "current" &&
    classifyCommitRelation({
      same: false,
      ancestor: true,
      commitsBehind: 4,
    }) === "ok" &&
    classifyCommitRelation({
      same: false,
      ancestor: true,
      commitsBehind: 40,
    }) === "stale" &&
    classifyCommitRelation({
      same: false,
      ancestor: false,
      commitsBehind: null,
    }) === "diverged";

  console.log(
    ok
      ? "graphify governance self-test PASS"
      : "graphify governance self-test FAIL",
  );
  process.exit(ok ? 0 : 1);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.selfTest) selfTest();

  const repo = resolve(args.repo);
  const outDir = join(repo, "graphify-out");
  const reportPath = join(outDir, "GRAPH_REPORT.md");

  if (!existsSync(reportPath)) {
    console.error("missing " + reportPath);
    process.exit(2);
  }

  const reportText = readFileSync(reportPath, "utf8");
  const receipt = buildReceipt({
    repo,
    reportText,
    reportPath,
    labelProvenance: args.labelStatus,
    runStatus: args.runStatus,
  });
  const outPath = join(outDir, "GRAPH_RECEIPT.json");
  writeFileSync(outPath, JSON.stringify(receipt, null, 2) + "\n", "utf8");

  console.log(
    "graph receipt: " +
      receipt.report.sourceCommit +
      " · " +
      receipt.report.nodeCount +
      " nodes · origin/main " +
      receipt.comparedTo.originMain.state +
      " · " +
      outPath,
  );
}

const isMain =
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isMain) main();
