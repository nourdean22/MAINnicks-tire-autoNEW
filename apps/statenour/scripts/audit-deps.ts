#!/usr/bin/env tsx
/**
 * scripts/audit-deps.ts · Phase K (2026-05-18 PM)
 *
 * Dependency CVE scanner · pnpm audit --json + write
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

import { execSync } from "node:child_process";

interface PnpmAdvisory {
  id?: number;
  cve?: string;
  module_name: string;
  severity: "info" | "low" | "moderate" | "high" | "critical";
  title?: string;
  url?: string;
  vulnerable_versions?: string;
  patched_versions?: string;
  recommendation?: string;
  cwe?: string[];
}

interface PnpmAuditOutput {
  advisories?: Record<string, PnpmAdvisory>;
  metadata?: {
    vulnerabilities: Record<string, number>;
    totalDependencies: number;
  };
}

interface AuditFinding {
  module: string;
  severity: PnpmAdvisory["severity"];
  cve?: string;
  cwe?: string[];
  title: string;
  vulnerable: string;
  patched?: string;
  recommendation?: string;
  url?: string;
}

function runPnpmAudit(): PnpmAuditOutput {
  try {
    const out = execSync("pnpm audit --json", {
      encoding: "utf8",
      maxBuffer: 50 * 1024 * 1024,
    });
    return JSON.parse(out) as PnpmAuditOutput;
  } catch (err) {
    // pnpm audit exits non-zero when vulns exist · stdout still has JSON
    const stdout = (err as { stdout?: string }).stdout ?? "";
    if (stdout) {
      try {
        return JSON.parse(stdout) as PnpmAuditOutput;
      } catch {
        // fallthrough
      }
    }
    console.error("✗ audit-deps · pnpm audit failed:", err);
    return {};
  }
}

function extractFindings(audit: PnpmAuditOutput): AuditFinding[] {
  const findings: AuditFinding[] = [];
  for (const adv of Object.values(audit.advisories ?? {})) {
    if (adv.severity !== "high" && adv.severity !== "critical") continue;
    findings.push({
      module: adv.module_name,
      severity: adv.severity,
      cve: adv.cve,
      cwe: adv.cwe,
      title: adv.title ?? `${adv.module_name} vulnerability`,
      vulnerable: adv.vulnerable_versions ?? "unknown",
      patched: adv.patched_versions,
      recommendation: adv.recommendation,
      url: adv.url,
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
  const audit = runPnpmAudit();
  const findings = extractFindings(audit);
  const meta = audit.metadata;

  const { written } = await writeFindings(findings, dryRun);
  const durationMs = Date.now() - startedAt;

  if (jsonOut) {
    console.log(
      JSON.stringify(
        {
          findings,
          totals: meta?.vulnerabilities ?? {},
          totalDependencies: meta?.totalDependencies ?? 0,
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
        `✓ audit-deps · no critical/high findings · scanned ${meta?.totalDependencies ?? "?"} deps · ${durationMs}ms`,
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
