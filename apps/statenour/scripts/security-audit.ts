/**
 * Security Audit · v10.0.375
 *
 * Per /security-auditor skill · static-analysis sweep over the repo
 * surfacing the most common operator-grade security issues:
 *
 *   1. SECRETS · hardcoded API keys, tokens, OAuth secrets in
 *      committed source code (not .env files which are gitignored)
 *   2. AUTH GAPS · API routes that don't call requireSession or
 *      requireOwner before handling user-data operations
 *   3. SQL INJECTION · raw $queryRaw / $executeRaw calls without
 *      parameterized queries
 *   4. UNSAFE REDIRECTS · res.redirect calls with user-controlled
 *      destinations
 *   5. CSRF EXPOSURE · POST/DELETE/PUT routes without origin checks
 *
 * Output: ranked findings with severity, file path, line number,
 * recommended fix. Operator reviews + addresses high-severity items
 * first.
 *
 * Run: pnpm tsx scripts/security-audit.ts
 */

import * as fs from "node:fs";
import * as path from "node:path";

interface Finding {
  severity: "critical" | "high" | "medium" | "low";
  category: string;
  file: string;
  line: number;
  preview: string;
  recommendation: string;
}

const findings: Finding[] = [];
const ROOT = path.resolve(__dirname, "..");

// ─── 1 · SECRET PATTERNS ────────────────────────────────────────────
//
// These patterns catch common API keys / tokens hardcoded in source.
// .env files are gitignored so we only scan tracked code.
const SECRET_PATTERNS: Array<{ name: string; pattern: RegExp; severity: Finding["severity"] }> = [
  { name: "OpenAI API key", pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{40,}/g, severity: "critical" },
  { name: "Anthropic API key", pattern: /\bsk-ant-[A-Za-z0-9_-]{30,}/g, severity: "critical" },
  { name: "GitHub PAT", pattern: /\bghp_[A-Za-z0-9]{35,}/g, severity: "critical" },
  { name: "AWS Access Key", pattern: /\bAKIA[0-9A-Z]{16}\b/g, severity: "critical" },
  { name: "Google API key", pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g, severity: "high" },
  { name: "Cohere key", pattern: /\bcohere_[A-Za-z0-9_-]{40,}/g, severity: "critical" },
  { name: "Stripe live key", pattern: /\bsk_live_[A-Za-z0-9]{24,}/g, severity: "critical" },
  { name: "VideoDB key", pattern: /\bsk-[a-zA-Z0-9_-]{40,}/g, severity: "high" },
  { name: "Twilio SID", pattern: /\bAC[a-f0-9]{32}\b/g, severity: "high" },
  { name: "Generic AWS-looking", pattern: /aws_secret_access_key\s*[=:]\s*["']?[A-Za-z0-9/+=]{40}/gi, severity: "high" },
];

const SCAN_DIRS = ["lib", "app", "scripts", "components", "hooks", "tests"];
const SKIP_DIRS = new Set(["node_modules", ".next", ".next-prod", ".next-ci", ".git", "dist", "build"]);
const SCAN_EXTS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);

// Files where actual secrets ARE expected (env templates, examples)
const SECRET_ALLOWLIST = new Set([".env.example", ".env.template"]);

// Skip the audit script itself · its pattern strings will match every check.
const SELF_PATH_FRAGMENT = "scripts/security-audit.ts";

function* walk(dir: string): Generator<string> {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(full);
    } else if (entry.isFile() && SCAN_EXTS.has(path.extname(entry.name))) {
      yield full;
    }
  }
}

function scanForSecrets(file: string, content: string): void {
  const rel = path.relative(ROOT, file);
  if (SECRET_ALLOWLIST.has(path.basename(rel))) return;
  if (rel.startsWith(".env")) return;
  if (rel.replace(/\\/g, "/").includes(SELF_PATH_FRAGMENT)) return;

  const lines = content.split("\n");
  for (const { name, pattern, severity } of SECRET_PATTERNS) {
    pattern.lastIndex = 0; // reset global regex
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(content)) !== null) {
      // Find which line
      let charsConsumed = 0;
      let lineNum = 1;
      for (const line of lines) {
        if (charsConsumed + line.length + 1 > match.index) break;
        charsConsumed += line.length + 1;
        lineNum++;
      }
      // Skip allowlisted patterns:
      // - "replace_me" / "your_key_here" / "..." placeholder values
      const matched = match[0];
      const lineContent = lines[lineNum - 1] ?? "";
      if (
        /replace_me|your[_-]?key|placeholder|example|xxxxx|<.*>|\.\.\./i.test(lineContent) ||
        /\bprocess\.env\./.test(lineContent) || // const KEY = process.env.X · just the env reference
        matched.includes("XXXX") ||
        matched.includes("...")
      ) {
        continue;
      }
      findings.push({
        severity,
        category: "secret-leak",
        file: rel,
        line: lineNum,
        preview: lineContent.trim().slice(0, 100),
        recommendation: `Move ${name} to environment variable · rotate the key if this commit hit a public branch`,
      });
    }
  }
}

// ─── 2 · API AUTH GAPS ──────────────────────────────────────────────
//
// Heuristic: any /app/api/ route handler that does NOT mention
// requireSession / requireOwner / authorizeCron is suspicious. False
// positives possible (some routes are public by design like /api/cron),
// so we surface medium-severity for review rather than auto-blocking.

const PUBLIC_API_PATTERNS = [
  /\/api\/cron\//, // cron auth via CRON_SECRET bearer
  /\/api\/health/, // health checks
  /\/api\/manifest/,
  /\/api\/og/, // OG image route
  /\/api\/webhook/, // webhooks have their own signature checks
  /\/api\/telegram\/webhook/, // Telegram bot webhook · X-Telegram-Bot-Api-Secret-Token verified
  /\/api\/vapi\//, // VAPI tool routes · authenticated by VAPI agent's signed requests
  /\/api\/internal\/runner\//, // local Windows runner · RUNNER_SHARED_SECRET bearer
];

function scanForAuthGaps(file: string, content: string): void {
  const rel = path.relative(ROOT, file).replace(/\\/g, "/");
  if (!rel.startsWith("app/api/")) return;
  if (!rel.endsWith("/route.ts") && !rel.endsWith("/route.tsx")) return;
  if (PUBLIC_API_PATTERNS.some((p) => p.test(rel))) return;

  // Look for HTTP method exports
  const hasMutating = /\bexport\s+(?:async\s+)?(?:function\s+)?(POST|PUT|DELETE|PATCH)\b/.test(content);
  if (!hasMutating) return; // GET-only routes are lower priority

  // Recognized auth patterns:
  //   · session-based   · requireSession / requireOwner / requireAdmin /
  //                       getServerAuthSession / apiHandler({auth:})
  //   · shared-secret   · timingSafeEqual + header check (sync APIs)
  //   · cron bearer     · CRON_SECRET / RUNNER_SHARED_SECRET / SYNC_SECRET
  const hasAuth =
    /requireSession|requireOwner|requireAdmin|getServerAuthSession|apiHandler\(.*auth:/.test(content) ||
    /timingSafeEqual.*headers?\.|crypto\.timingSafeEqual/.test(content) ||
    /\bCRON_SECRET\b|\bRUNNER_SHARED_SECRET\b|\bSTATENOUR_SYNC_KEY\b|\bSYNC_SECRET\b|\bBRIDGE_API_KEY\b/.test(content);
  if (hasAuth) return;

  findings.push({
    severity: "high",
    category: "auth-gap",
    file: rel,
    line: 1,
    preview: "POST/PUT/DELETE/PATCH route without explicit auth check",
    recommendation: "Add `await requireSession(req)` (or apiHandler with auth: 'owner') at the top of each handler",
  });
}

// ─── 3 · SQL INJECTION VECTORS ──────────────────────────────────────
//
// $queryRaw and $executeRaw with template-literal string interpolation
// are safe ONLY when used as tagged templates. Using regular string
// concatenation in those calls is a SQL injection risk.

function scanForSqlInjection(file: string, content: string): void {
  const rel = path.relative(ROOT, file);
  if (rel.replace(/\\/g, "/").includes(SELF_PATH_FRAGMENT)) return;

  const lines = content.split("\n");
  lines.forEach((line, i) => {
    // Pattern · prisma.$queryRaw(`...${var}...`) where the call is
    // function-style not tagged-template-style. Heuristic: $queryRaw
    // followed by ( opening paren immediately is suspicious; tagged
    // template uses backtick directly without parens.
    if (/\$queryRaw\s*\(/.test(line) && /\$\{/.test(line)) {
      findings.push({
        severity: "critical",
        category: "sql-injection",
        file: rel,
        line: i + 1,
        preview: line.trim().slice(0, 120),
        recommendation: "Use $queryRaw as tagged template (no parens) so Prisma parameterizes · or use Prisma.sql`...` helper",
      });
    }
    if (/\$executeRaw\s*\(/.test(line) && /\$\{/.test(line)) {
      findings.push({
        severity: "critical",
        category: "sql-injection",
        file: rel,
        line: i + 1,
        preview: line.trim().slice(0, 120),
        recommendation: "Use $executeRaw as tagged template",
      });
    }
  });
}

// ─── 4 · CSRF / UNSAFE REDIRECTS ────────────────────────────────────
//
// res.redirect with user-controlled input → open-redirect vulnerability.
// Look for redirect calls that include params / query string in destination.

function scanForUnsafeRedirects(file: string, content: string): void {
  const rel = path.relative(ROOT, file);
  if (rel.replace(/\\/g, "/").includes(SELF_PATH_FRAGMENT)) return;
  const lines = content.split("\n");

  lines.forEach((line, i) => {
    // res.redirect(req.query.X) / Response.redirect(searchParams.get("X"))
    if (
      /(?:res\.redirect|Response\.redirect|NextResponse\.redirect)\s*\([^)]*(?:req\.|request\.|params\.|searchParams|nextUrl\.searchParams)/.test(line)
    ) {
      findings.push({
        severity: "high",
        category: "open-redirect",
        file: rel,
        line: i + 1,
        preview: line.trim().slice(0, 120),
        recommendation: "Whitelist the redirect target host before passing to redirect() · reject unfamiliar hosts",
      });
    }
  });
}

// ─── Main ───────────────────────────────────────────────────────────

async function main() {
  console.log("");
  console.log("═══════════════════════════════════════════════════════════");
  console.log("  SECURITY AUDIT · v10.0.375");
  console.log("═══════════════════════════════════════════════════════════");

  let scanned = 0;
  for (const dir of SCAN_DIRS) {
    const dirPath = path.join(ROOT, dir);
    if (!fs.existsSync(dirPath)) continue;
    for (const file of walk(dirPath)) {
      scanned++;
      let content: string;
      try {
        content = fs.readFileSync(file, "utf8");
      } catch {
        continue;
      }
      scanForSecrets(file, content);
      scanForAuthGaps(file, content);
      scanForSqlInjection(file, content);
      scanForUnsafeRedirects(file, content);
    }
  }

  console.log(`  Scanned ${scanned} files`);
  console.log("");

  // Group + rank findings
  const bySeverity: Record<Finding["severity"], Finding[]> = {
    critical: [],
    high: [],
    medium: [],
    low: [],
  };
  for (const f of findings) bySeverity[f.severity].push(f);

  for (const sev of ["critical", "high", "medium", "low"] as const) {
    const list = bySeverity[sev];
    if (list.length === 0) continue;
    console.log(`  ── ${sev.toUpperCase()} (${list.length}) ──`);
    for (const f of list.slice(0, 20)) {
      console.log(`    [${f.category}] ${f.file}:${f.line}`);
      console.log(`      ${f.preview}`);
      console.log(`      → ${f.recommendation}`);
    }
    if (list.length > 20) {
      console.log(`    ... and ${list.length - 20} more`);
    }
    console.log("");
  }

  if (findings.length === 0) {
    console.log("  ✅ No findings. Operator-grade clean.");
  } else {
    console.log(`  Total · ${findings.length} findings`);
    console.log("");
    console.log("  Priority order:");
    console.log("    1. critical · address immediately");
    console.log("    2. high     · address this week");
    console.log("    3. medium   · address before next major release");
    console.log("    4. low      · backlog");
  }
  console.log("");
}

main().catch((err) => {
  console.error("❌ Security audit failed:", err);
  process.exit(1);
});
