/**
 * "What changed?" system digest (F2) — one crisp, operational answer to
 * "what changed since last time?" after a Claude Code session.
 *
 * Reuses existing truth infrastructure (does NOT re-implement): the latest
 * RECONCILIATION entry, the memory-eval scoreboard, the stale-doc scanner, the
 * runbook catalog, and the deploy identity. Pure helpers (parse/assemble/deploy)
 * are unit-tested with injected inputs; the wrapper does the fs/env IO.
 *
 * HARD RULE: never hallucinate deploy status. statenour deploys on Railway, so
 * we read the Railway env vars first, then Vercel; if neither is present we
 * report "unknown" (verify on bdnick.info) — we never assert "deployed".
 *
 * See docs/project/NEXT-INTELLIGENCE-WAVE.md (F2).
 */

import fs from "node:fs";
import path from "node:path";
import { scanContent } from "@/scripts/check-stale-docs";
import { runMemoryEvals } from "@/lib/evals/memory-eval-runner";
import { MEMORY_EVALS } from "@/lib/evals/memory-evals";
import { RUNBOOKS } from "@/lib/runbooks/catalog";
import { extractShas } from "@/lib/utils/git-sha";

export interface ReconEntry {
  date: string | null;
  title: string | null;
  ships: string[];
  verifyGate: string | null;
}

// truth-substrate audit P0 (#11/#14): deploy-identity moved to the canonical
// lib/services/deploy-identity.ts (Railway-first, shared by every surface).
// Imported locally (used in the interfaces below) AND re-exported so existing
// consumers of these names keep working.
import { readDeployIdentity, type DeployStatus, type DeployIdentity } from "@/lib/services/deploy-identity";
export type { DeployStatus, DeployIdentity };
// Re-export the VALUE too — the pre-existing system-change-digest.test.ts (and
// any other consumer) imports readDeployIdentity from THIS module.
export { readDeployIdentity };

export interface SystemChangeDigest {
  generatedAt: string;
  latestWave: ReconEntry | null;
  truth: {
    staleCriticalInKeyDocs: number;
    staleWarnInKeyDocs: number;
    evals: { total: number; passed: number; failed: number; manual: number };
    runbooksActive: number;
    runbooksOldestVerified: string | null;
  };
  deployment: DeployIdentity;
  checksAvailable: string[];
  risks: string[];
  nextOwnerDecision: string;
}

/** Key truth docs an agent reads first — a critical stale finding here is worst. */
const KEY_DOCS = ["docs/CURRENT-TRUTH.md", "AGENTS.md", "docs/runbooks/index.md"];

/**
 * Parse the top blockquote entry of RECONCILIATION.md. Pure. Reads only the
 * first ~120 lines (the latest entry is always at the top).
 */
export function parseLatestReconciliation(content: string): ReconEntry | null {
  const lines = (content ?? "").split(/\r?\n/).slice(0, 120);
  // The latest entry header looks like:  > ## 2026-06-09 · title...
  const headerIdx = lines.findIndex((l) => /^>\s*##\s+\d{4}-\d{2}-\d{2}/.test(l));
  if (headerIdx === -1) return null;
  const header = lines[headerIdx];
  const date = header.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? null;
  const title = header.replace(/^>\s*##\s+\d{4}-\d{2}-\d{2}\s*[·:\-]?\s*/, "").trim().slice(0, 160) || null;

  // The block runs until the next "> ## <date>" header or a non-blockquote line.
  const block: string[] = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    if (/^>\s*##\s+\d{4}-\d{2}-\d{2}/.test(lines[i])) break; // next dated entry
    if (lines[i].trim() && !/^>/.test(lines[i])) break; // true end-of-blockquote (matches the doc)
    block.push(lines[i]);
  }
  const ships = extractShas(block.join("\n")).slice(0, 12);
  const verifyLine = block.find((l) => /verify\b/i.test(l)) ?? null;
  const verifyGate = verifyLine ? verifyLine.replace(/^>\s*[-*]?\s*/, "").replace(/\*\*/g, "").trim().slice(0, 220) : null;

  return { date, title, ships, verifyGate };
}

// readDeployIdentity now lives in lib/services/deploy-identity.ts (imported above).

export interface DigestParts {
  reconciliation: ReconEntry | null;
  staleCriticalInKeyDocs: number;
  staleWarnInKeyDocs: number;
  evals: { total: number; passed: number; failed: number; manual: number };
  runbooksActive: number;
  runbooksOldestVerified: string | null;
  deployment: DeployIdentity;
  now: string;
}

/** Assemble the digest from already-computed parts. Pure. */
export function assembleDigest(p: DigestParts): SystemChangeDigest {
  const risks: string[] = [];
  if (p.staleCriticalInKeyDocs > 0) risks.push(`${p.staleCriticalInKeyDocs} critical stale-deploy claim(s) in key truth docs.`);
  if (p.evals.failed > 0) risks.push(`${p.evals.failed} failing truth eval(s).`);
  if (p.deployment.status === "unknown") risks.push("Deploy status unverified from this runtime.");

  let nextOwnerDecision = "Nothing pending — truth + checks are green.";
  if (p.staleCriticalInKeyDocs > 0) nextOwnerDecision = "Fix the critical stale-doc finding(s) before they mislead an agent.";
  else if (p.evals.failed > 0) nextOwnerDecision = `Resolve ${p.evals.failed} failing truth eval(s).`;
  else if (p.deployment.status === "unknown") nextOwnerDecision = "Verify the live deploy on bdnick.info (runtime can't confirm it).";

  return {
    generatedAt: p.now,
    latestWave: p.reconciliation,
    truth: {
      staleCriticalInKeyDocs: p.staleCriticalInKeyDocs,
      staleWarnInKeyDocs: p.staleWarnInKeyDocs,
      evals: p.evals,
      runbooksActive: p.runbooksActive,
      runbooksOldestVerified: p.runbooksOldestVerified,
    },
    deployment: p.deployment,
    checksAvailable: ["check:stale-docs", "check:runbooks", "check:crons", "eval:memory", "typecheck", "test"],
    risks,
    nextOwnerDecision,
  };
}

export interface DigestDeps {
  loadDoc?: (relPath: string) => string | null;
  env?: Record<string, string | undefined>;
  now?: () => string;
}

function defaultLoadDoc(relPath: string): string | null {
  const full = path.join(process.cwd(), relPath);
  try {
    return fs.existsSync(full) ? fs.readFileSync(full, "utf8") : null;
  } catch {
    return null;
  }
}

/** Build the change digest. IO wrapper around the pure helpers above. */
export async function buildSystemChangeDigest(deps: DigestDeps = {}): Promise<SystemChangeDigest> {
  const loadDoc = deps.loadDoc ?? defaultLoadDoc;
  const env = deps.env ?? process.env;
  const now = deps.now ? deps.now() : new Date().toISOString();

  const reconciliation = parseLatestReconciliation(loadDoc("docs/RECONCILIATION.md") ?? "");

  // Stale-doc scan over the key truth docs only (bounded + the worst place for a regression).
  let staleCriticalInKeyDocs = 0;
  let staleWarnInKeyDocs = 0;
  for (const rel of KEY_DOCS) {
    const content = loadDoc(rel);
    if (content == null) continue;
    for (const f of scanContent(rel, content)) {
      if (f.severity === "critical") staleCriticalInKeyDocs++;
      else staleWarnInKeyDocs++;
    }
  }

  // Memory-eval scoreboard against grounding docs that are readable.
  const docs = new Set(MEMORY_EVALS.map((e) => e.groundingDoc).filter(Boolean) as string[]);
  const sources: Record<string, string> = {};
  for (const rel of docs) {
    const c = loadDoc(rel);
    if (c != null) sources[rel] = c;
  }
  const evalRun = runMemoryEvals(MEMORY_EVALS, { sources });

  const active = RUNBOOKS.filter((r) => r.status === "active");
  const runbooksOldestVerified = active.length
    ? active.map((r) => r.lastVerified).sort()[0]
    : null;

  return assembleDigest({
    reconciliation,
    staleCriticalInKeyDocs,
    staleWarnInKeyDocs,
    evals: { total: evalRun.total, passed: evalRun.passed, failed: evalRun.failed, manual: evalRun.manual },
    runbooksActive: active.length,
    runbooksOldestVerified,
    deployment: readDeployIdentity(env),
    now,
  });
}
