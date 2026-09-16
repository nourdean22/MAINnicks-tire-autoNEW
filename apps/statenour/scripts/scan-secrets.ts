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
 *
 * ⚠ `--staged` SCANNED ZERO FILES ON EVERY COMMIT until 2026-09-16, and said
 * "✓ no findings" while doing it. Measured end to end, not inferred:
 *
 *   A real `git commit` exports `GIT_DIR` (absolute) and no `GIT_WORK_TREE` to
 *   its hooks, and lefthook runs this job with `root: "apps/statenour"`. With
 *   `GIT_DIR` set and `GIT_WORK_TREE` unset git stops discovering the repo from
 *   the filesystem and takes the CURRENT DIRECTORY as the work-tree root — so
 *   `git rev-parse --show-toplevel` returned `<repo>/apps/statenour`, while
 *   `git diff --cached --name-only` kept returning repo-root-relative paths
 *   (`apps/statenour/lib/x.ts`). `join(repoRoot, f)` therefore built
 *   `<repo>/apps/statenour/apps/statenour/lib/x.ts`, `statSync` threw, and the
 *   loop `continue`d past it.
 *
 *   The receipt lied twice over: the count printed was `targetFiles.length`,
 *   taken BEFORE the skip, so the output read "scanned 1 files · no findings"
 *   about a file that was never opened.
 *
 *   PROBE (throwaway index, real file on disk, one fake `AKIA…` key):
 *     clean env → ✗ 1 finding [CRITICAL] aws_access_key, exit 1
 *     GIT_DIR set → ✓ no findings · scanned 1 files, exit 0
 *
 * Both halves are fixed below: git runs with the hook's `GIT_DIR` /
 * `GIT_WORK_TREE` stripped, and a staged file that cannot be opened is now a
 * LOUD failure instead of a `continue`. Same root cause and same fix as
 * `apps/nickstire/scripts/lint-brand-voice.ts`.
 */

import { execFileSync, execSync } from "node:child_process";
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

/**
 * The hook environment, neutralised — see the header. `GIT_INDEX_FILE` is kept
 * on purpose: git sets it to an absolute path, and it is what makes a PARTIAL
 * commit (`git commit -- <paths>`, which builds a temporary index) scan the
 * bytes actually being committed.
 */
const GIT_ENV: NodeJS.ProcessEnv = (() => {
  const env = { ...process.env };
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  return env;
})();

function getStagedFiles(): string[] {
  try {
    const out = execSync("git diff --cached --name-only --diff-filter=ACM", {
      encoding: "utf8",
      env: GIT_ENV,
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

const MAX_SCAN_BYTES = 5 * 1024 * 1024;

/**
 * `--staged` reads the STAGED BYTES, not the working tree.
 *
 * Two reasons, and the first is a bug in its own right: `git add` a file with a
 * key in it, then edit the key out of the working copy, and a disk-reading
 * scanner finds nothing while the secret goes into the commit. A pre-commit
 * gate has to inspect what is being committed. The second is structural — this
 * path no longer builds a filesystem path at all, so it cannot be fooled by a
 * wrong `--show-toplevel` the way `join(repoRoot, f)` was (see the header).
 *
 * `:<path>` is resolved by git relative to the TOP OF THE WORKING TREE, not
 * cwd — verified from `apps/statenour/` with and without `GIT_DIR` set.
 */
function stagedBlob(repoRelPath: string): { content?: string; oversize?: boolean; error?: string } {
  const g = (args: string[]) =>
    execFileSync("git", args, { encoding: "utf8", env: GIT_ENV, maxBuffer: 64 * 1024 * 1024 });
  try {
    const size = Number(g(["cat-file", "-s", `:${repoRelPath}`]).trim());
    if (Number.isFinite(size) && size > MAX_SCAN_BYTES) return { oversize: true };
    return { content: g(["show", `:${repoRelPath}`]) };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

function scanFile(filePath: string, repoRoot: string): Finding[] {
  let content: string;
  try {
    content = readFileSync(filePath, "utf8");
  } catch {
    return [];
  }
  return scanContent(relative(repoRoot, filePath).replace(/\\/g, "/"), content);
}

/** The rule loop, over text from either source. `label` is what a finding reports. */
function scanContent(label: string, content: string): Finding[] {
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
        file: label,
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
    env: GIT_ENV,
  }).trim();

  const allFindings: Finding[] = [];
  /** What was actually OPENED. The old receipt printed `targetFiles.length`. */
  let scanned = 0;
  /** Deliberately skipped, and named in the output so a skip is never invisible. */
  const oversize: string[] = [];
  /**
   * Could not be opened. In `--staged` mode this is NOT a skip: the file is
   * about to enter history and the scanner has no idea what is in it.
   */
  const unreadable: string[] = [];

  if (stagedOnly) {
    // Repo-root-relative paths straight from `--name-only`, handed to git as
    // `:<path>` — no filesystem path is constructed, so nothing here depends on
    // `--show-toplevel` being right.
    for (const f of getStagedFiles()) {
      const blob = stagedBlob(f);
      if (blob.oversize) {
        oversize.push(f);
        continue;
      }
      if (blob.content === undefined) {
        unreadable.push(f);
        continue;
      }
      scanned += 1;
      allFindings.push(...scanContent(f, blob.content));
    }
  } else {
    const targetFiles: string[] = [];
    for (const g of SCAN_GLOBS) {
      const matches = globSync(g, { cwd: repoRoot, ignore: IGNORE_GLOBS });
      targetFiles.push(...matches.map((f) => join(repoRoot, f)));
    }
    for (const f of targetFiles) {
      try {
        const stat = statSync(f);
        if (!stat.isFile()) continue;
        if (stat.size > MAX_SCAN_BYTES) {
          oversize.push(f);
          continue;
        }
      } catch {
        unreadable.push(f);
        continue;
      }
      scanned += 1;
      allFindings.push(...scanFile(f, repoRoot));
    }
  }

  // UNKNOWN is not CLEAN. A staged file the scanner could not read is the exact
  // state the GIT_DIR bug produced for EVERY file, silently, for months — and
  // the pass line was indistinguishable from a real one.
  if (stagedOnly && unreadable.length > 0) {
    // `--json` gets the same verdict, in its own shape. Gating this on the
    // human output would have left a consumer of the JSON reading `findings: []`
    // as clean over files nothing had opened — the identical defect, one
    // interface along.
    if (jsonOut) {
      console.log(JSON.stringify({ findings: allFindings, unreadable, scanned, oversize }, null, 2));
    } else {
      console.error(
        `✗ scan-secrets · ${unreadable.length} staged file(s) could not be read from the index — NOT scanned, NOT a pass:`,
      );
      for (const f of unreadable) console.error(`  [UNREAD] ${f}`);
      console.error(`  Nothing below has been verified for these files. Fix the read, do not bypass.`);
    }
    process.exit(1);
  }

  if (jsonOut) {
    // `scanned` travels with the findings so a consumer can tell "clean" from
    // "read nothing" — the distinction this whole change is about.
    console.log(JSON.stringify({ findings: allFindings, scanned, oversize }, null, 2));
  } else {
    if (allFindings.length === 0) {
      // `scanned`, not `targetFiles.length` — the old count was taken before the
      // skip, so it reported files it had never opened.
      const skipped = oversize.length ? ` · ${oversize.length} skipped >5MB` : "";
      console.log(
        scanned === 0
          ? `· scan-secrets · NOTHING SCANNED (0 files${stagedOnly ? " staged in scope" : " matched"}) — no findings is not a clean bill of health${skipped}`
          : `✓ scan-secrets · no findings · scanned ${scanned} files${skipped}`,
      );
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
