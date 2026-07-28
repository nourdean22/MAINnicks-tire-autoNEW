#!/usr/bin/env node
/**
 * lint-pii.mjs · skill-audit B3 port · privacy-by-design 2026-05-26
 *
 * Catches PII (personally identifiable information) leakage in NEW
 * code before it ships. Addresses audit findings #102 (firstName in
 * Railway logs), #128 (venice prompt sizes with raw PII), #223
 * (logger PII scrubbing gap) — and prevents the next 10 of the
 * same class.
 *
 * What counts as PII (TCPA + CCPA + common-sense):
 *   - Phone numbers (full or last-10 normalized)
 *   - Email addresses
 *   - Full customer names (firstName + lastName together OR full
 *     customer.name field)
 *   - VINs (vehicle identification numbers)
 *   - Street addresses (where the customer lives)
 *   - Credit card / payment card numbers
 *   - SSN / TaxID
 *   - Driver's license numbers
 *
 * Where logging PII is dangerous:
 *   - `log.info(..., { phone: ... })` · Railway logs are searchable
 *     by anyone with dashboard access · phone numbers in plaintext
 *     means a leaked dashboard credential = leaked customer list
 *   - `console.log(...customer.email...)` · same problem
 *   - Error message strings · `throw new Error(\`Failed for ${phone}\`)`
 *     · the error message goes into Sentry / Railway / logs in plain
 *   - URL query params · GET /api/customer?phone=2168620005 is logged
 *     by Railway's HTTP access log (PII in URL = PII in access log)
 *
 * Two modes (same shape as lint-brand-voice.mjs):
 *   - PRE-COMMIT (default when staged files exist) · scans ADDED
 *     lines in `git diff --cached`
 *   - AUDIT (--audit flag) · scans all in-scope files
 *
 * Scope: server-side TypeScript + JavaScript files where logs +
 * errors actually emit. Client code is OUT of scope (client console
 * logs don't reach Railway · still bad but lower priority).
 *
 * Exit 0 = clean · 1 = violations in pre-commit mode.
 * Bypass: `git commit --no-verify` (use sparingly + leave a comment).
 */
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const APP_ROOT = resolve(__dirname, "..");

const AUDIT_MODE = process.argv.includes("--audit");

// ─── PII PATTERNS ────────────────────────────────────────
//
// 2026-07-28 hardening sweep · `maskable: true` rules recognize an
// already-masked value on the SAME LINE (maskPhone(/maskEmail(/
// .slice(-4)/last4) and stand down. The linter previously flagged the
// KEY NAME regardless of the value — `to: to.slice(-4)` (masked, safe)
// counted the same as `to: phone` (raw leak), which is how the baseline
// grew to 62 "violations" nobody could green. Masking-awareness is
// deliberately scoped to the log-field rules ONLY: hardcoded numbers,
// SSNs and card patterns can never be excused by a coincidental token.
// Line-level granularity means one masked + one raw field on the SAME
// line would slip — accepted and documented; the raw field still flags
// the moment it's on its own line, and review covers the rest.
const MASKED_VALUE_SIGNAL = /maskPhone\s*\(|maskEmail\s*\(|maskName\s*\(|\.slice\(\s*-4\s*\)|\blast4\b|maskPII\s*\(/;

const PII_PATTERNS = [
  // ─── Direct PII-field logging in structured logs ───
  {
    pattern: /\blog\.(info|warn|error|debug)\s*\([^)]*\b(phone|customerPhone|to|recipientPhone)\b\s*[:,]/gi,
    why: "Phone number in structured log · TCPA + CCPA risk if dashboard leaks",
    fix: "Mask: pass `phone: maskPhone(phone)` → last 4 digits only · OR remove field entirely",
    maskable: true,
  },
  {
    pattern: /\blog\.(info|warn|error|debug)\s*\([^)]*\b(email|customerEmail|recipientEmail|to_email)\b\s*[:,]/gi,
    why: "Email address in structured log · CCPA disclosure risk",
    fix: "Mask: pass `email: maskEmail(email)` → 'j***@nick***.com' · OR remove field",
    maskable: true,
  },
  {
    pattern: /\blog\.(info|warn|error|debug)\s*\([^)]*\b(firstName|lastName|fullName|customerName|customer\.name)\b\s*[:,]/gi,
    why: "Customer name in structured log · CCPA + brand-reputation risk if logs are public-facing",
    fix: "Use opaque customer ID instead · 'customerId: c.id' not 'customerName: c.firstName'",
    maskable: true,
  },
  {
    pattern: /\blog\.(info|warn|error|debug)\s*\([^)]*\b(vin|vehicleVIN|vehicle\.vin)\b\s*[:,]/gi,
    why: "VIN in structured log · indirect-PII (links to owner via DMV records)",
    fix: "Last 4 digits or vehicle make/model only",
  },
  {
    pattern: /\blog\.(info|warn|error|debug)\s*\([^)]*\b(address|streetAddress|customer\.address)\b\s*[:,]/gi,
    why: "Customer address in structured log · CCPA + physical-safety risk",
    fix: "Use ZIP or city only · 'zip: c.zip' not 'address: c.address'",
  },

  // ─── Plain console.log of PII ───
  {
    pattern: /\bconsole\.(log|info|warn|error|debug)\s*\([^)]*\$\{[^}]*\b(phone|email|firstName|lastName|customerName|vin|address)\b[^}]*\}/gi,
    why: "console.* with PII template literal · same Railway-log exposure as log.* + worse (often left in dev path that ships)",
    fix: "Remove the console statement OR scrub the PII · use mask helpers",
  },

  // ─── Error messages with raw PII ───
  {
    pattern: /\b(throw new Error|new Error)\s*\(\s*[`'"][^`'"]*\$\{[^}]*\b(phone|email|firstName|lastName|customerName|customerPhone|vin)\b[^}]*\}/gi,
    why: "Error message contains raw PII · errors propagate to Sentry + Railway logs + sometimes to client",
    fix: "Throw with opaque ID: `throw new Error(\\`Failed for customer ${customerId}\\`)` · or use a structured error with PII as a separate scrubbed field",
  },

  // ─── PII in GET URL paths or query strings ───
  {
    pattern: /\?(phone|email|customerPhone|customerEmail|vin)=\$\{/gi,
    why: "PII in URL query string · Railway HTTP access log captures the full URL · plain-text PII in logs",
    fix: "Use POST with body, OR pass an opaque token that resolves server-side to the PII",
  },
  {
    pattern: /\/(phone|email)\/[\w@.\-+]/gi,
    why: "PII in URL path segment · same Railway access-log exposure",
    fix: "Use opaque IDs in URL paths · '/customer/123' not '/customer/2168620005'",
    // 2026-07-28 · prose like "name/phone/email/problem as CSV" inside a
    // COMMENT matched this URL-shape rule (shared/adminPermissions.ts) —
    // a comment can't put PII in an access log. Hardcoded-number rules
    // deliberately do NOT get this skip: a real number in a comment
    // still leaks via the repo.
    skipComments: true,
  },

  // ─── Hardcoded test PII (often committed by accident) ───
  {
    pattern: /\b(216|330|440|234)\s*[\-.\s]?\s*\d{3}\s*[\-.\s]?\s*\d{4}\b/g,
    why: "Hardcoded Cleveland-area phone in source · looks like real customer data committed by accident",
    fix: "Use a fixture file with explicit test marker OR use 555-prefix phones (555-0100 is RFC-reserved for fiction)",
    // 2026-07-05 · the shop's own PUBLIC line is not PII — it's plastered
    // on every page of the site. Before this allowlist, adding the
    // business number anywhere tripped the pre-commit gate (exit 1) and
    // trained `--no-verify` bypasses. Checked per MATCHED SUBSTRING
    // (digits-normalized), so a real customer number on the same line
    // still flags. Deliberately NOT allowlisted: the 216862000X
    // check-live-sms fixtures (can't prove those aren't real subscriber
    // numbers — the linter's own advice says use 555 for fiction).
    // 2026-07-28 hardening sweep · two more BUSINESS-OWNED lines join the
    // shop main: the VAPI line (216-424-9249 — vapi.ts:1016 "NOT the shop
    // main") and the Twilio number (216-769-9977 — emergency.ts "clearly
    // NOT a customer"). Same rule as before: business-owned ≠ PII; a real
    // customer number on the same line still flags. Additionally, any
    // match whose EXCHANGE is 555 is fiction by NANP reservation
    // (216-555-XXXX cannot be a subscriber) — handled in ruleViolates.
    allowDigits: new Set(["2168620005", "2164249249", "2167699977"]),
    fictionExchange: true,
  },
  {
    pattern: /[a-zA-Z0-9._%+-]+@(gmail|yahoo|hotmail|outlook|aol|icloud)\.com\b/g,
    why: "Hardcoded personal-email-provider address in source · looks like real customer data",
    fix: "Use a fixture · OR use `@example.com` for tests (RFC-reserved)",
    // 2026-07-28 · the BUSINESS'S OWN addresses are identity, not customer
    // PII — and load-bearing (email-notify overrideTo SENDS to the shop
    // inbox; payments copy tells the operator where to look; businessFacts
    // is the canonical business record). Checked per matched substring,
    // lowercased — a customer gmail on the same line still flags.
    allowEmails: new Set(["moeseuclid@gmail.com", "nourdean22@gmail.com"]),
  },

  // ─── Credit card patterns (Luhn-like) ───
  {
    pattern: /\b(?:\d{4}[- ]?){3}\d{4}\b/g,
    why: "16-digit number that LOOKS like a credit card · even if it's not, false-positives leak when audited · also could be real",
    fix: "If test fixture, use a clearly-fake number like '4111-1111-1111-1111' (Stripe test card) · if production, remove · NEVER log card numbers",
  },

  // ─── SSN patterns ───
  {
    pattern: /\b\d{3}[- ]\d{2}[- ]\d{4}\b/g,
    why: "Looks like a Social Security Number · highest-severity PII · IRS-regulated",
    fix: "If test, use '000-00-0000' (RFC-reserved invalid SSN) · if production, this is a critical leak · escalate",
  },
];

const IN_SCOPE = [
  // server-side files that actually emit logs / throw errors
  /^server\/.*\.ts$/,
  /^server\/.*\.tsx$/,
  /^server\/.*\.mjs$/,
  /^server\/.*\.js$/,
  // shared business logic that might log
  /^shared\/.*\.ts$/,
  // CI scripts that touch customer data
  /^scripts\/.*\.ts$/,
  /^scripts\/.*\.mjs$/,
];

const OUT_OF_SCOPE = [
  // archived scripts never execute · 2026-07-28 hardening sweep
  /^scripts\/_archive\//,
  // tests use fake data intentionally
  /\.test\.ts$/,
  /\.spec\.ts$/,
  // type definitions don't emit
  /\.d\.ts$/,
  /types\/.*\.ts$/,
  // drizzle schema is structural · no PII output
  /drizzle\/schema\.ts$/,
  // this lint file itself contains PII patterns as regex literals
  /scripts\/lint-pii\.mjs$/,
];

function isInScope(relPath) {
  if (OUT_OF_SCOPE.some((rx) => rx.test(relPath))) return false;
  return IN_SCOPE.some((rx) => rx.test(relPath));
}

function getStagedFiles() {
  try {
    const out = execSync("git diff --cached --name-only --diff-filter=ACMR", {
      cwd: APP_ROOT,
      encoding: "utf8",
    });
    return out
      .split("\n")
      .map((f) => f.trim())
      .filter(Boolean)
      .map((f) => f.replace(/^apps\/nickstire\//, ""))
      .filter(isInScope);
  } catch {
    return [];
  }
}

function getAddedLines(relPath) {
  try {
    const diff = execSync(`git diff --cached -U0 -- "${relPath}"`, {
      cwd: APP_ROOT,
      encoding: "utf8",
    });
    const lines = [];
    let lineNum = 0;
    for (const line of diff.split("\n")) {
      const hunkMatch = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)/);
      if (hunkMatch) {
        lineNum = parseInt(hunkMatch[1], 10);
        continue;
      }
      if (line.startsWith("+") && !line.startsWith("+++")) {
        lines.push({ lineNum, text: line.slice(1) });
        lineNum++;
      } else if (!line.startsWith("-") && !line.startsWith("---")) {
        lineNum++;
      }
    }
    return lines;
  } catch {
    return [];
  }
}

/**
 * True when the line violates the rule. A rule with `allowDigits` only
 * violates if at least one matched substring is NOT an allowlisted
 * number after stripping non-digits — so the shop's public line never
 * flags, but a real customer number sharing the line still does.
 */
function ruleViolates(rule, text) {
  // 2026-07-28 · masked values stand down (log-field rules only) and
  // comment prose can't trip URL-shape rules. See the pattern-block
  // comments for scope + the accepted line-level granularity trade.
  if (rule.maskable && MASKED_VALUE_SIGNAL.test(text)) return false;
  if (rule.skipComments && /^\s*(\/\/|\*|\/\*)/.test(text)) return false;
  if (rule.allowEmails) {
    const matches = [...text.matchAll(rule.pattern)];
    rule.pattern.lastIndex = 0;
    return matches.some((m) => !rule.allowEmails.has(m[0].toLowerCase()));
  }
  if (!rule.allowDigits) {
    const hit = rule.pattern.test(text);
    rule.pattern.lastIndex = 0;
    return hit;
  }
  const matches = [...text.matchAll(rule.pattern)];
  rule.pattern.lastIndex = 0;
  return matches.some((m) => {
    const digits = m[0].replace(/\D/g, "");
    if (rule.allowDigits.has(digits)) return false;
    // 555 exchange = NANP fiction reservation · 216-555-XXXX cannot be a
    // subscriber number, so docblock/bot examples shaped that way are safe.
    if (rule.fictionExchange && digits.length === 10 && digits.slice(3, 6) === "555") return false;
    return true;
  });
}

function scanFile(relPath, mode) {
  const violations = [];
  if (mode === "pre-commit") {
    const addedLines = getAddedLines(relPath);
    for (const { lineNum, text } of addedLines) {
      for (const rule of PII_PATTERNS) {
        if (ruleViolates(rule, text)) {
          violations.push({ relPath, lineNum, text: text.trim().slice(0, 120), why: rule.why, fix: rule.fix });
        }
      }
    }
  } else {
    try {
      const content = readFileSync(resolve(APP_ROOT, relPath), "utf8");
      content.split("\n").forEach((text, i) => {
        for (const rule of PII_PATTERNS) {
          if (ruleViolates(rule, text)) {
            violations.push({ relPath, lineNum: i + 1, text: text.trim().slice(0, 120), why: rule.why, fix: rule.fix });
          }
        }
      });
    } catch { /* file removed or unreadable */ }
  }
  return violations;
}

// ─── MAIN ─────────────────────────────────────────────
const stagedFiles = AUDIT_MODE ? [] : getStagedFiles();
const mode = AUDIT_MODE || stagedFiles.length === 0 ? "audit" : "pre-commit";

let files;
if (mode === "pre-commit") {
  files = stagedFiles;
} else {
  // Audit mode: walk all in-scope files
  const out = execSync('git ls-files', { cwd: APP_ROOT, encoding: "utf8" });
  files = out.split("\n").map((f) => f.trim()).filter(Boolean).filter(isInScope);
}

const allViolations = files.flatMap((f) => scanFile(f, mode));

if (allViolations.length === 0) {
  console.log(`✅ lint-pii (${mode}): clean (${files.length} files scanned)`);
  process.exit(0);
}

console.error(`❌ lint-pii (${mode}): ${allViolations.length} violation(s) in ${files.length} file(s)\n`);
for (const v of allViolations) {
  console.error(`  ${v.relPath}:${v.lineNum}`);
  console.error(`    "${v.text}"`);
  console.error(`    WHY: ${v.why}`);
  console.error(`    FIX: ${v.fix}\n`);
}
if (mode === "pre-commit") {
  console.error(`Bypass: \`git commit --no-verify\` (leave a comment explaining why)`);
  process.exit(1);
}
process.exit(0);
