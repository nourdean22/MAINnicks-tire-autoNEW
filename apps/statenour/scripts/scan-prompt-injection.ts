#!/usr/bin/env tsx
/**
 * scripts/scan-prompt-injection.ts · Phase K (2026-05-18 PM)
 *
 * Static checks for AI-engine code · catches the misuse patterns
 * that classic linters miss. Specific to the H-series reasoning
 * engine + the chat/* handlers + any code that pipes user input
 * into LLM messages.
 *
 * Rules:
 *   · PI-001 · template-string user content in aiChat() message
 *     content · classic prompt injection vector
 *   · PI-002 · missing requireSession on a route under /api/nick/*
 *     or /api/operator/*
 *   · PI-003 · missing checkBudget on a new POST under /api/nick/*
 *     that reaches the reasoning engine
 *   · PI-004 · use of dangerouslySetInnerHTML in any operator surface
 *   · PI-005 · console.log of req.body or session details (logs leak)
 *
 * Pure-TS · runs in <3s · no AST parser dependency · regex + line
 * scanning. False-positive friendly · uses allow comments to suppress.
 *
 * Usage:
 *   pnpm tsx scripts/scan-prompt-injection.ts
 *   pnpm tsx scripts/scan-prompt-injection.ts --json
 */

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { globSync } from "glob";

interface Finding {
  file: string;
  line: number;
  rule: string;
  severity: "critical" | "high" | "medium";
  message: string;
  snippet: string;
}

interface ScanRule {
  id: string;
  severity: Finding["severity"];
  filePattern: RegExp;
  /** Returns findings for a file's lines */
  scan: (lines: string[], filePath: string) => Array<Omit<Finding, "file">>;
}

const RULES: ScanRule[] = [
  {
    id: "PI-001",
    severity: "high",
    filePattern: /\.(ts|tsx)$/,
    scan: (lines) => {
      const findings: Array<Omit<Finding, "file">> = [];
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // Pattern: `role: "user"` followed within 8 lines by a backtick
        // template literal containing ${ (user-content interpolation)
        if (/role:\s*['"]user['"]/.test(line)) {
          const window = lines.slice(i, Math.min(lines.length, i + 8)).join("\n");
          if (/content:\s*`[^`]*\$\{[^}]+\}/m.test(window)) {
            // Allow if there's a sanitize() call in the forward window
            // OR a `SAFE:` comment in the prior 4 lines (preferred
            // suppression style · explains rationale next to the call).
            const prefix = lines
              .slice(Math.max(0, i - 4), i)
              .join("\n");
            if (
              /sanitize|escapePrompt/.test(window) ||
              /SAFE:/.test(prefix) ||
              /SAFE:/.test(window)
            ) {
              continue;
            }
            findings.push({
              line: i + 1,
              rule: "PI-001",
              severity: "high",
              message:
                'Template-string interpolation in role:"user" message content · prompt-injection risk',
              snippet: line.trim().slice(0, 160),
            });
          }
        }
      }
      return findings;
    },
  },
  {
    id: "PI-002",
    severity: "critical",
    filePattern: /app\/api\/(?:nick|operator)\/[^/]+(?:\/[^/]+)*\/route\.ts$/,
    scan: (lines) => {
      const findings: Array<Omit<Finding, "file">> = [];
      const fileText = lines.join("\n");
      // Exempt routes that internally call requireSession through a
      // shared helper · the apiHandler wrapper uses auth:'owner' option
      // which counts as protected.
      const hasRequireSession = /requireSession\s*\(/.test(fileText);
      const hasApiHandlerOwner = /apiHandler\s*\([\s\S]*auth:\s*['"]owner['"]/.test(fileText);
      const hasExportRoute =
        /export\s+(?:async\s+function|const)\s+(GET|POST|PUT|PATCH|DELETE)/.test(fileText);
      if (hasExportRoute && !hasRequireSession && !hasApiHandlerOwner) {
        // Find first export line for the finding location
        const exportLine = lines.findIndex((l) =>
          /export\s+(?:async\s+function|const)\s+(?:GET|POST|PUT|PATCH|DELETE)/.test(l),
        );
        findings.push({
          line: exportLine + 1,
          rule: "PI-002",
          severity: "critical",
          message:
            "Route under /api/nick or /api/operator missing requireSession() or apiHandler({auth:'owner'})",
          snippet: lines[exportLine]?.trim().slice(0, 160) ?? "",
        });
      }
      return findings;
    },
  },
  {
    id: "PI-003",
    severity: "high",
    filePattern: /app\/api\/nick\/reason(?:\/[^/]+)*\/route\.ts$/,
    scan: (lines) => {
      const findings: Array<Omit<Finding, "file">> = [];
      const fileText = lines.join("\n");
      // Reasoning routes that call reason() or reasonStreaming() MUST
      // gate via checkBudget · the inflight reservation is also expected.
      const reachesEngine =
        /\bawait\s+reason\s*\(/.test(fileText) ||
        /\breasonStreaming\s*\(/.test(fileText);
      const hasBudgetGate = /\bcheckBudget\s*\(/.test(fileText);
      if (reachesEngine && !hasBudgetGate) {
        const callLine = lines.findIndex((l) =>
          /\b(reason|reasonStreaming)\s*\(/.test(l),
        );
        findings.push({
          line: callLine + 1,
          rule: "PI-003",
          severity: "high",
          message:
            "Route reaches reasoning engine without checkBudget() gate · spend cap unenforced",
          snippet: lines[callLine]?.trim().slice(0, 160) ?? "",
        });
      }
      return findings;
    },
  },
  {
    id: "PI-004",
    severity: "high",
    filePattern: /\.(ts|tsx)$/,
    scan: (lines) => {
      const findings: Array<Omit<Finding, "file">> = [];
      for (let i = 0; i < lines.length; i++) {
        if (/dangerouslySetInnerHTML/.test(lines[i])) {
          // Allow comment-suppressed
          const prev = lines[i - 1] ?? "";
          if (/PI-004-SAFE/.test(prev) || /sanitize/i.test(prev)) continue;
          findings.push({
            line: i + 1,
            rule: "PI-004",
            severity: "high",
            message: "dangerouslySetInnerHTML without sanitize · XSS vector",
            snippet: lines[i].trim().slice(0, 160),
          });
        }
      }
      return findings;
    },
  },
  {
    id: "PI-005",
    severity: "medium",
    filePattern: /\.(ts|tsx)$/,
    scan: (lines) => {
      const findings: Array<Omit<Finding, "file">> = [];
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (
          /console\.(log|info|warn|debug)\s*\([^)]*(?:req\.body|session\.user|ctx\.session)/.test(
            line,
          )
        ) {
          findings.push({
            line: i + 1,
            rule: "PI-005",
            severity: "medium",
            message:
              "console.log of req.body / session contents · PII leaks to runtime logs",
            snippet: line.trim().slice(0, 160),
          });
        }
      }
      return findings;
    },
  },
];

// Scoped to the H/J series surfaces · this scanner protects NEW code
// in the reasoning engine + operator API + tRPC routers · it does not
// retroactively scan the 100+ legacy LLM call sites (lib/brain, lib/ai/
// non-reasoning, etc). Those have their own audit history.
const SCAN_GLOBS = [
  "apps/statenour/lib/ai/reasoning/**/*.{ts,tsx}",
  "apps/statenour/lib/trpc/**/*.{ts,tsx}",
  "apps/statenour/app/api/nick/**/*.{ts,tsx}",
  "apps/statenour/app/api/operator/**/*.{ts,tsx}",
  "apps/statenour/app/api/trpc/**/*.{ts,tsx}",
  "apps/statenour/components/operator/**/*.{ts,tsx}",
  "apps/statenour/components/providers/**/*.{ts,tsx}",
  "apps/statenour/app/(mastery)/reason/**/*.{ts,tsx}",
];

const IGNORE_GLOBS = [
  "**/node_modules/**",
  "**/.next*/**",
  "**/dist/**",
  "**/build/**",
  "**/coverage/**",
  "**/*.test.ts",
  "**/*.test.tsx",
  "**/scan-prompt-injection.ts",
];

function main(): void {
  const argv = process.argv.slice(2);
  const jsonOut = argv.includes("--json");
  const repoRoot = execSync("git rev-parse --show-toplevel", {
    encoding: "utf8",
  }).trim();

  const targetFiles: string[] = [];
  for (const g of SCAN_GLOBS) {
    const matches = globSync(g, { cwd: repoRoot, ignore: IGNORE_GLOBS });
    targetFiles.push(...matches.map((f) => join(repoRoot, f)));
  }

  const findings: Finding[] = [];
  for (const f of targetFiles) {
    let lines: string[];
    try {
      lines = readFileSync(f, "utf8").split("\n");
    } catch {
      continue;
    }
    for (const rule of RULES) {
      if (!rule.filePattern.test(f.replace(/\\/g, "/"))) continue;
      const ruleFindings = rule.scan(lines, f);
      for (const rf of ruleFindings) {
        findings.push({
          ...rf,
          file: relative(repoRoot, f).replace(/\\/g, "/"),
        });
      }
    }
  }

  if (jsonOut) {
    console.log(JSON.stringify({ findings }, null, 2));
  } else {
    if (findings.length === 0) {
      console.log(
        `✓ scan-prompt-injection · no findings · scanned ${targetFiles.length} files · 5 rules`,
      );
    } else {
      console.error(`✗ scan-prompt-injection · ${findings.length} finding(s):`);
      for (const f of findings) {
        console.error(
          `  [${f.severity.toUpperCase()}] ${f.file}:${f.line} · ${f.rule} · ${f.message}`,
        );
        console.error(`    ${f.snippet}`);
      }
    }
  }
  // Exit non-zero only on critical/high (not medium)
  const blocking = findings.filter(
    (f) => f.severity === "critical" || f.severity === "high",
  );
  process.exit(blocking.length > 0 ? 1 : 0);
}

main();
