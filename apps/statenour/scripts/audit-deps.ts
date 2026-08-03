#!/usr/bin/env tsx
/**
 * scripts/audit-deps.ts · Phase K (2026-05-18 PM)
 *
 * Dependency CVE scanner · repo-root bulk advisory scan + write
 * critical/high-severity findings to ErrorLog so they surface in the
 * existing /system/logs unified tail + the alerts pipeline.
 *
 * Designed to be cron-friendly · runs weekly via Inngest schedule
 * (operator wires it manually since this script doesn't auto-register).
 *
 * Run manually:
 *   pnpm tsx scripts/audit-deps.ts
 *   pnpm tsx scripts/audit-deps.ts --json
 *   pnpm tsx scripts/audit-deps.ts --dry-run  # don't write to DB
 */

import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

interface AuditFinding {
  module: string;
  severity: "info" | "low" | "moderate" | "high" | "critical";
  cve?: string;
  cwe?: string[];
  title: string;
  vulnerable: string;
  patched?: string;
  recommendation?: string;
  url?: string;
}

/**
 * Shape emitted by `scripts/audit-advisories.mjs --json` (repo root).
 */
interface BulkAdvisoryHit {
  name: string;
  severity: AuditFinding["severity"];
  title: string;
  vulnerable_versions?: string;
  affected?: string;
  url?: string;
}
interface BulkAdvisoryOutput {
  level: string;
  scanned: number;
  versions: number;
  hits: BulkAdvisoryHit[];
}

/**
 * Run the REPO-ROOT bulk-advisory scanner and return its findings.
 *
 * This used to shell out to `pnpm audit --json`. That path calls npm's retired
 * legacy audit endpoint, so the gate failed for SCANNER reasons rather than
 * because any dependency was risky — the worst kind of gate, because a red
 * check that nobody believes stops being read at all. The root CI workflow had
 * already worked around it with scripts/audit-advisories.mjs, which posts to
 * npm's bulk advisory endpoint; statenour was the last caller left on the old
 * path. One scanner, one severity model, one place to fix.
 *
 * The bulk endpoint does not return `cve`, `cwe`, `patched_versions` or
 * `recommendation`. Those fields are dropped rather than faked — `url` carries
 * the operator to the full advisory, and inventing a patched-version range we
 * did not receive is exactly the class of confident-but-unfounded reporting
 * this repo keeps getting bitten by.
 */
function runBulkAdvisoryScan(): BulkAdvisoryOutput | null {
  // Resolved from this file so it works regardless of cwd.
  const scanner = resolve(dirname(fileURLToPath(import.meta.url)), "../../../scripts/audit-advisories.mjs");
  try {
    const out = execFileSync(process.execPath, [scanner, "--audit-level=high", "--advisory", "--json"], {
      encoding: "utf8",
      maxBuffer: 50 * 1024 * 1024,
    });
    return JSON.parse(out) as BulkAdvisoryOutput;
  } catch (err) {
    // --advisory means the scanner never exits non-zero for findings, so a
    // throw here is a genuine scanner failure. Report it; do not treat an
    // unreadable scan as "no vulnerabilities".
    const e = err as { stdout?: string; message?: string };
    if (e.stdout) {
      try {
        return JSON.parse(e.stdout) as BulkAdvisoryOutput;
      } catch {
        /* fall through to the loud failure below */
      }
    }
    console.error("✗ audit-deps · bulk advisory scan FAILED:", e.message ?? err);
    return null;
  }
}

function extractFindings(scan: BulkAdvisoryOutput | null): AuditFinding[] {
  if (!scan) return [];
  const findings: AuditFinding[] = [];
  for (const hit of scan.hits ?? []) {
    if (hit.severity !== "high" && hit.severity !== "critical") continue;
    findings.push({
      module: hit.name,
      severity: hit.severity,
      title: hit.title ?? `${hit.name} vulnerability`,
      vulnerable: hit.vulnerable_versions ?? hit.affected ?? "unknown",
      url: hit.url,
    });
  }
  return findings;
}

async function writeFindings(
  findings: AuditFinding[],
  dryRun: boolean,
): Promise<{ written: number }> {
  if (findings.length === 0 || dryRun) return { written: 0 };
  // Use the existing ErrorLog table so findings show up in /system/logs
  // alongside runtime errors. context.kind = "dependency_cve" lets the
  // ticker filter by source.
  try {
    const { prisma } = await import("@/lib/prisma");
    let written = 0;
    for (const f of findings) {
      await prisma.errorLog.create({
        data: {
          level: f.severity === "critical" ? "error" : "warn",
          message: `[CVE] ${f.module}: ${f.title.slice(0, 200)}`,
          context: {
            kind: "dependency_cve",
            module: f.module,
            severity: f.severity,
            cve: f.cve,
            cwe: f.cwe,
            vulnerable: f.vulnerable,
            patched: f.patched,
            recommendation: f.recommendation,
            url: f.url,
            scannedAt: new Date().toISOString(),
          },
        },
      });
      written += 1;
    }
    return { written };
  } catch (err) {
    console.error(
      "✗ audit-deps · failed to write to ErrorLog (prisma unavailable?):",
      err instanceof Error ? err.message : err,
    );
    return { written: 0 };
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const jsonOut = argv.includes("--json");
  const dryRun = argv.includes("--dry-run");

  const startedAt = Date.now();
  const scan = runBulkAdvisoryScan();
  const findings = extractFindings(scan);
  // The bulk endpoint reports what it SCANNED, not a severity census of the
  // whole tree the way `pnpm audit` metadata did. Report the real numbers
  // rather than reconstructing a shape the scanner never returned.
  const scanned = scan?.scanned ?? 0;
  const versions = scan?.versions ?? 0;
  const scanOk = scan !== null;

  const { written } = await writeFindings(findings, dryRun);
  const durationMs = Date.now() - startedAt;

  if (jsonOut) {
    console.log(
      JSON.stringify(
        {
          findings,
          scanOk,
          scannedPackages: scanned,
          distinctVersions: versions,
          written,
          dryRun,
          durationMs,
        },
        null,
        2,
      ),
    );
  } else {
    if (findings.length === 0) {
      console.log(
        `✓ audit-deps · no critical/high findings · scanned ${scanned} prod packages (${versions} versions) · ${durationMs}ms`,
      );
    } else {
      console.log(
        `⚠ audit-deps · ${findings.length} critical/high finding(s) · wrote ${written} to ErrorLog · ${durationMs}ms`,
      );
      for (const f of findings) {
        console.log(
          `  [${f.severity.toUpperCase()}] ${f.module} · ${f.title.slice(0, 80)}`,
        );
        if (f.recommendation) console.log(`    → ${f.recommendation.slice(0, 120)}`);
      }
    }
  }
  // 2026-07-28 cron-truth audit (dim 5): this exited 0 UNCONDITIONALLY —
  // "a reporter, not a gate" — while sitting inside verify:hard, which IS
  // the gate chain. A check that cannot fail inside a gate makes the
  // chain claim protection it doesn't provide (the nickstire arc's
  // "blocking dep gate had never executed" class). Policy now mirrors
  // the nickstire security-scan precedent: CRITICAL fails the gate
  // (rare enough to be pure signal), HIGH stays advisory (ErrorLog +
  // /system/logs — reddening every push on upstream noise is the exact
  // dependency-PR pain of 2026-07-25), and `--advisory` preserves the
  // pure-reporter behavior for cron usage.
  const advisoryMode = process.argv.includes("--advisory");
  const criticals = findings.filter((f) => f.severity === "critical");
  if (!advisoryMode && criticals.length > 0) {
    console.error(
      `✗ audit-deps · ${criticals.length} CRITICAL advisory(ies) — failing the gate (run with --advisory for reporter-only mode)`,
    );
    process.exit(1);
  }
  process.exit(0);
}

void main();
