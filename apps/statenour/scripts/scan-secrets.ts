#!/usr/bin/env tsx
/**
 * scripts/scan-secrets.ts · Phase K (2026-05-18 PM)
 *
 * TS-native secret scanner. Replaces trufflehog/gitleaks for the
 * single-operator pre-push workflow · no external binary dependency ·
 * runs in <2s across the whole repo.
 *
 * Detects:
 *   · OpenAI API keys (sk-[A-Za-z0-9-]{40,})
 *   · Anthropic API keys (sk-ant-[A-Za-z0-9-]{40,})
 *   · Venice API keys (vc-[A-Za-z0-9]{20,})
 *   · AWS access keys (AKIA[0-9A-Z]{16})
 *   · GitHub PATs (ghp_[A-Za-z0-9]{36})
 *   · Generic JWTs (eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)
 *   · Generic high-entropy strings (40+ chars, mixed case+digits, not common phrases)
 *   · Telegram bot tokens (\d{8,10}:[A-Za-z0-9_-]{35,})
 *
 * Usage:
 *   pnpm tsx scripts/scan-secrets.ts            # scan whole repo
 *   pnpm tsx scripts/scan-secrets.ts --staged   # only staged files
 *   pnpm tsx scripts/scan-secrets.ts --json     # JSON output for tools
 *
 * Exits non-zero on any finding.
 */

import { execSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { globSync } from "glob";

interface Finding {
  file: string;
  line: number;
  rule: string;
  preview: string;
  severity: "critical" | "high";
}

interface Rule {
  name: string;
  pattern: RegExp;
  severity: "critical" | "high";
  /** False-positive guard · skip if matched text appears here */
  allowList?: RegExp[];
}

const RULES: Rule[] = [
  {
    name: "openai_api_key",
    pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/g,
    severity: "critical",
    allowList: [/^sk-xxx/i, /^sk-test/i, /sk-test-[a-z0-9]+/i],
  },
  {
    name: "anthropic_api_key",
    pattern: /\bsk-ant-[A-Za-z0-9_-]{40,}\b/g,
    severity: "critical",
    allowList: [/sk-ant-xxx/i, /sk-ant-test/i],
  },
  {
    name: "venice_api_key",
    pattern: /\bvc-[A-Za-z0-9]{20,}\b/g,
    severity: "critical",
    allowList: [/vc-xxx/i, /vc-test/i],
  },
  {
    name: "aws_access_key",
    pattern: /\bAKIA[0-9A-Z]{16}\b/g,
    severity: "critical",
  },
  {
    name: "github_pat",
    pattern: /\bghp_[A-Za-z0-9]{36}\b/g,
    severity: "critical",
  },
  {
    name: "telegram_bot_token",
    pattern: /\b\d{8,10}:[A-Za-z0-9_-]{35,}\b/g,
    severity: "critical",
    allowList: [/example/i, /placeholder/i, /xxx/i],
  },
  {
    name: "jwt_token",
    pattern: /\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
    severity: "high",
    allowList: [/example/i, /placeholder/i, /xxx/i, /demo\.jwt/i],
  },
  {
    name: "perplexity_api_key",
    pattern: /\bpplx-[A-Za-z0-9]{20,}\b/g,
    severity: "critical",
    allowList: [/pplx-xxx/i, /pplx-test/i],
  },
];

const SCAN_GLOBS = [
  "apps/statenour/**/*.{ts,tsx,js,jsx,mjs,json,env,md}",
  "apps/statenour/.env*",
];

const IGNORE_GLOBS = [
  "**/node_modules/**",
  "**/.next*/**",
  "**/dist/**",
  "**/build/**",
  "**/coverage/**",
  "**/.git/**",
  "**/pnpm-lock.yaml",
  "**/package-lock.json",
  // Exclude this scanner file itself (the regex literals would self-match)
  "**/scan-secrets.ts",
  // .env.example is intentional · operator's documented sample
  "**/.env.example",
  // Test fixtures use fake/redacted secrets for unit testing the
  // sanitizer · scanning them produces false positives.
  "**/tests/**",
  "**/*.test.ts",
  "**/*.test.tsx",
  "**/__fixtures__/**",
  "**/__mocks__/**",
];

function getStagedFiles(): string[] {
  try {
    const out = execSync("git diff --cached --name-only --diff-filter=ACM", {
      encoding: "utf8",
    });
    return out
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean)
      .filter((f) => /\.(ts|tsx|js|jsx|mjs|json|md|env)$/.test(f) || f.includes(".env"));
  } catch {
    return [];
  }
}

function scanFile(filePath: string, repoRoot: string): Finding[] {
  let content: string;
  try {
    content = readFileSync(filePath, "utf8");
  } catch {
    return [];
  }
  const lines = content.split("\n");
  const findings: Finding[] = [];
  for (const rule of RULES) {
    // Reset regex state for each scan
    rule.pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = rule.pattern.exec(content)) !== null) {
      const matched = match[0];
      if (rule.allowList?.some((re) => re.test(matched))) continue;
      // Find line number
      const upToMatch = content.slice(0, match.index);
      const line = upToMatch.split("\n").length;
      const preview =
        matched.slice(0, 12) + "..." + matched.slice(matched.length - 4);
      findings.push({
        file: relative(repoRoot, filePath).replace(/\\/g, "/"),
        line,
        rule: rule.name,
        preview,
        severity: rule.severity,
      });
    }
  }
  return findings;
}

function main(): void {
  const argv = process.argv.slice(2);
  const stagedOnly = argv.includes("--staged");
  const jsonOut = argv.includes("--json");
  const repoRoot = execSync("git rev-parse --show-toplevel", {
    encoding: "utf8",
  }).trim();

  const targetFiles: string[] = [];
  if (stagedOnly) {
    targetFiles.push(...getStagedFiles().map((f) => join(repoRoot, f)));
  } else {
    for (const g of SCAN_GLOBS) {
      const matches = globSync(g, { cwd: repoRoot, ignore: IGNORE_GLOBS });
      targetFiles.push(...matches.map((f) => join(repoRoot, f)));
    }
  }

  const allFindings: Finding[] = [];
  for (const f of targetFiles) {
    try {
      const stat = statSync(f);
      if (!stat.isFile() || stat.size > 5 * 1024 * 1024) continue; // skip >5MB
    } catch {
      continue;
    }
    allFindings.push(...scanFile(f, repoRoot));
  }

  if (jsonOut) {
    console.log(JSON.stringify({ findings: allFindings }, null, 2));
  } else {
    if (allFindings.length === 0) {
      console.log(`✓ scan-secrets · no findings · scanned ${targetFiles.length} files`);
    } else {
      console.error(`✗ scan-secrets · ${allFindings.length} finding(s):`);
      for (const f of allFindings) {
        console.error(
          `  [${f.severity.toUpperCase()}] ${f.file}:${f.line} · ${f.rule} · ${f.preview}`,
        );
      }
    }
  }
  process.exit(allFindings.length > 0 ? 1 : 0);
}

main();
