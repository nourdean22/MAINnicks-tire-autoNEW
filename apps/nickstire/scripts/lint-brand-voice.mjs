#!/usr/bin/env node
/**
 * lint-brand-voice.mjs — wave-181.49
 *
 * Catches brand-voice kill-list violations in NEW customer-facing copy
 * before they ship. Backed by the canonical guidelines at
 * .claude/brand-voice-guidelines.md (Section 3 — The Kill List).
 *
 * Two modes:
 *   - PRE-COMMIT (default when staged files exist) — scans only the
 *     ADDED lines in `git diff --cached`. Pre-existing violations in
 *     the codebase don't block; only NEW violations introduced by
 *     this commit do. Keeps the lint surgical without forcing a
 *     massive cleanup wave on day 1.
 *   - AUDIT (--audit flag, or manual run with no staged files) —
 *     scans ALL in-scope files and reports the full violation set.
 *     Useful for periodic cleanup work. Doesn't exit non-zero.
 *
 * Scope (only files where customers see the text):
 *   - client/src/pages/**.tsx       — page copy
 *   - client/src/components/**.tsx  — component copy (string literals)
 *   - server/services/vapi.ts       — Brian's voice (canonical source)
 *   - server/cron/jobs/*Sequences.ts
 *   - server/cron/jobs/*Outreach.ts
 *   - server/cron/jobs/*Recovery.ts — SMS templates
 *   - shared/routes.ts              — SEO meta titles + descriptions
 *
 * Out of scope (legitimate technical use of the same words):
 *   - tests, types, drizzle/schema.ts
 *   - admin/* (internal operator UI, not customer copy)
 *   - server/_core/, server/lib/, server/routers/ (infra, not copy)
 *
 * Exit code 0 = clean, 1 = violations found in pre-commit mode.
 * To bypass a false positive: `git commit --no-verify`.
 */
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const APP_ROOT = resolve(__dirname, "..");

const AUDIT_MODE = process.argv.includes("--audit");

// ─── KILL LIST ────────────────────────────────────────
const KILL_LIST = [
  { pattern: /\btrusted\b/gi, why: "Fake-corporate adjective label", fix: "Show, don't claim — use 4.9★ / 1,700+ reviews / specific story" },
  { pattern: /\bexperts?\b/gi, why: "Fake-corporate adjective label", fix: "Use 'we do this every day' or '7 days a week'" },
  // ROS-058 note: this `fix` used to read "$60 installed includes mount +
  // balance" — the exact fabricated price that arc removed from the SMS catalog.
  // Guidance that names a drifted number is a reinfection vector: the next
  // developer copies it in good faith. The BUSINESS SSOT is a $25 qualifying
  // floor with most standard sizes $40-80, so ~$60 is a midpoint, never a floor.
  // Point at the SSOT instead of restating any number here.
  { pattern: /\bquality\b/gi, why: "Fake-corporate adjective label", fix: "Use a concrete spec, or interpolate the price band from BUSINESS (shared/business.ts) — never hardcode a dollar figure in copy" },
  { pattern: /\brest assured\b/gi, why: "Customer-service-bot phrase", fix: "Use direct promise: 'free check, written quote'" },
  { pattern: /\bhassle.?free\b/gi, why: "Marketing cliché", fix: "Use concrete: 'walk in, drop it off, we'll text you when it's ready'" },
  { pattern: /\bstate.of.the.art\b/gi, why: "Marketing cliché", fix: "Name the actual equipment or skip it" },
  { pattern: /\bcomprehensive\b/gi, why: "Fake-corporate", fix: "List what you do, don't claim 'comprehensive'" },
  { pattern: /\bpremium\b/gi, why: "Fake-corporate (unless naming a literal tier like 'premium synthetic oil')", fix: "Use concrete spec" },
  { pattern: /\btop.notch\b/gi, why: "Marketing cliché", fix: "Show with a star rating or review quote" },
  { pattern: /\bper your inquiry\b/gi, why: "Customer-service-bot phrase", fix: "Be direct" },
  { pattern: /\bhow may I assist\b/gi, why: "Customer-service-bot phrase", fix: "Be direct" },
  { pattern: /\bfree inspection\b/gi, why: "Customer says 'check' not 'inspection'", fix: "'free check'" },
  { pattern: /\bdiagnostic fee\b/gi, why: "Customer-language: 'we'll tell you what's wrong'", fix: "'free check' or 'we'll tell you what's wrong before any wrench moves'" },
  { pattern: /\bwithout your approval\b/gi, why: "Formal/procedural — softer than brand voice", fix: "'you don't pay until you say yes'" },
  { pattern: /\bno surprises\b/gi, why: "Passive — frame it actively instead", fix: "'we tell you the cost before we touch anything'" },
  { pattern: /\bsame great service\b/gi, why: "Generic + KILL LIST 'great'", fix: "Be concrete: 'same shop, same line, same fair price'" },

  // ─── ARCHETYPE VIOLATIONS · port from brand-perception-psychologist ───
  // Nick's Tire is a CAREGIVER + EVERYMAN archetype: neighborhood
  // shop, takes-care-of-you, regular-guy-fair-deal. These patterns
  // are HERO / RULER / SAGE archetype invasions · they break tone.
  // Caregiver "we look after you" tone gets undercut by Hero swagger
  // ("BEST", "DOMINANT") or Sage authority ("RESEARCH SHOWS",
  // "CERTIFIED TECHNICIANS"). When CAREGIVER + HERO mix, customers
  // sense incongruence even if they can't name it — trust drops.
  // ───────────────────────────────────────────────────────────────
  { pattern: /\b(best|#1|number one|leading|world.?class|industry.?leader)\s+(tire|auto|shop|mechanic|service)/gi, why: "HERO archetype invasion · Nick's is CAREGIVER, not the dominant champion", fix: "Replace with proof: '4.9★ on 1,700+ reviews · since 1989' · let the data say best" },
  { pattern: /\b(dominant|elite|exclusive|prestigious|luxury)\b/gi, why: "RULER archetype invasion · Nick's is everyman, not the gatekeeper", fix: "Drop the word · use 'fair price' or 'straight deal'" },
  { pattern: /\b(unmatched|unparalleled|second.to.none)\b/gi, why: "HERO swagger · breaks Caregiver tone (you're not bragging, you're taking care of them)", fix: "Replace with specific proof point: 'same-day on 90% of jobs'" },
  { pattern: /\b(research shows|studies prove|scientifically proven|clinically.tested)\b/gi, why: "SAGE archetype invasion · Caregiver doesn't lecture, Caregiver listens", fix: "Replace with first-person + specific: 'we've seen this 100x · here's what causes it'" },
  { pattern: /\bcertified.{0,20}(technicians?|mechanics?|professionals?)\b/gi, why: "SAGE / corporate-credential framing · Nick's is regular-guys-who-do-this-every-day", fix: "Replace with concrete: 'same crew who's been turning wrenches here since 2019'" },
  { pattern: /\b(empowering|empowered) (you|our customers|drivers)\b/gi, why: "Corporate-coach speak · Caregiver doesn't 'empower' · Caregiver does the work for you", fix: "Replace with action verb: 'we tell you what's wrong before anything happens'" },
  { pattern: /\b(award.winning|highly.rated|five.?star) (shop|service|team)/gi, why: "Fake-corporate self-praise · Caregiver shows proof, doesn't claim award status", fix: "Show the actual award/rating with a year + source ('4.9★ on Google · 2024')" },
  { pattern: /\b(family.owned|locally.owned).{0,30}(operated|business|shop)\b/gi, why: "Cliché — every shop says this · Caregiver uses specific stories instead", fix: "Replace with named-person specificity: 'Moe's been running this since 2019'" },
  { pattern: /\b(experience|professional) (you can trust|driven|first)\b/gi, why: "Trust-me-bro phrase · Caregiver shows up, doesn't beg trust", fix: "Show: '4.9★ / 1,700+ reviews / 12,000+ jobs since 2019'" },
  { pattern: /\bsatisfaction.guaranteed\b/gi, why: "Marketing cliché · means nothing · breaks Caregiver authenticity", fix: "Specific promise: 'free re-do if anything we touched isn't right'" },

  // ─── UNSLOP · LLM-output tells (skill-audit S2 unslop port) ──────
  // These are ChatGPT/Claude-isms that show up in AI-generated copy
  // but no human-written shop copy ever uses. Catching them at lint
  // time prevents the "this was written by AI" smell that erodes
  // trust without operators realizing why.
  //
  // The skill argues the brand-voice problem isn't bad WORDS · it's
  // structural patterns: preamble verbs, hedge stacking, robotic
  // transitions, performative reassurance. These are the slop tells.
  // ────────────────────────────────────────────────────────────────
  { pattern: /\b(let'?s|let us)\s+(dive in|dive into|get started|break (it|this) down|explore|unpack|tackle)\b/gi, why: "LLM preamble · humans don't say 'let's dive in' before writing", fix: "Cut the preamble · start with the actual point" },
  { pattern: /\bhere'?s the thing\b/gi, why: "LLM-pivot phrase · marks AI output", fix: "Just state the thing · drop the announce" },
  { pattern: /\b(in conclusion|to wrap up|to summarize|in summary)\b/gi, why: "LLM closing tic · breaks reader flow", fix: "End with the punchline · let the closing be implicit" },
  { pattern: /\b(it'?s worth (noting|mentioning)|it should be noted)\b/gi, why: "LLM hedge-stacking · weakens the actual claim", fix: "Make the claim directly · 'Brakes wear faster in city traffic' not 'It's worth noting brakes wear faster'" },
  { pattern: /\b(i'?d be happy to|i'?m happy to|happy to help)\b/gi, why: "Performative customer-service-bot reassurance", fix: "Just do the thing · 'Call (216) 862-0005 · we'll sort it out'" },
  { pattern: /\b(feel free to|don'?t hesitate to|please don'?t hesitate)\b/gi, why: "Performative permission · sounds robotic", fix: "Direct: 'Call us', 'Text us', 'Walk in'" },
  { pattern: /\b(furthermore|moreover|additionally|consequently)\b/gi, why: "Robotic transition · humans use 'plus', 'and', 'so', or just a period", fix: "Replace with 'plus', 'and', or start a new sentence" },
  { pattern: /\b(buckle up|fasten your seatbelt|hold onto your hat)\b/gi, why: "Forced-enthusiasm LLM tic · cringe-adjacent", fix: "Cut · let the content carry the energy" },
  { pattern: /\b(it'?s important to remember|remember that|keep in mind that)\b/gi, why: "Lecturing pose · Caregiver doesn't lecture", fix: "Just state the thing · drop the meta-instruction" },
  { pattern: /\b(in today'?s (fast.paced|digital|modern) (world|landscape|age))\b/gi, why: "LLM filler opener · adds zero value · marks AI output instantly", fix: "Cut entirely · start with the concrete claim" },
  { pattern: /\b(a wide (range|variety|array) of|a plethora of|a multitude of)\b/gi, why: "LLM elaboration · 'we do brakes, oil, tires' beats 'a wide variety of services'", fix: "List the actual things · or use 'every' / 'all' / 'most'" },
  { pattern: /\b(unleash|unlock|empower|elevate) (your|the)/gi, why: "Marketing-LLM verb · sounds like a Squarespace template", fix: "Concrete verb: 'fix', 'replace', 'install', 'check'" },
];

const IN_SCOPE = [
  /^client\/src\/pages\/.*\.tsx$/,
  /^client\/src\/components\/.*\.tsx$/,
  /^server\/services\/vapi\.ts$/,
  /^server\/cron\/jobs\/.*Sequences\.ts$/,
  /^server\/cron\/jobs\/.*Outreach\.ts$/,
  /^server\/cron\/jobs\/.*Recovery\.ts$/,
  /^shared\/routes\.ts$/,
];

function isInScope(relPath) {
  if (relPath.includes("admin/")) return false;
  return IN_SCOPE.some((rx) => rx.test(relPath));
}

// ─── PRE-COMMIT MODE: scan only ADDED lines in the staged diff ────
function scanStagedDiff() {
  let diff;
  try {
    // -U0 = no context lines, only changed lines
    // Use repo-root-relative paths because git is invoked from APP_ROOT
    diff = execSync("git diff --cached -U0", { cwd: APP_ROOT, encoding: "utf8" });
  } catch (err) {
    console.error("[brand-voice] git diff failed:", err.message);
    return { violations: [], filesScanned: 0 };
  }

  // Parse unified diff. Track current file. Only consider added lines ("+").
  const violations = [];
  let currentFile = null;
  let currentLineNum = 0;
  const filesScanned = new Set();

  for (const line of diff.split("\n")) {
    // File header: "+++ b/path/to/file.tsx"
    const fileMatch = line.match(/^\+\+\+ b\/(.+)$/);
    if (fileMatch) {
      // Strip apps/nickstire/ prefix to compare against IN_SCOPE patterns
      currentFile = fileMatch[1].replace(/^apps\/nickstire\//, "");
      currentLineNum = 0;
      if (isInScope(currentFile)) filesScanned.add(currentFile);
      continue;
    }
    // Hunk header: "@@ -L1,N1 +L2,N2 @@" — track new-file line number
    const hunkMatch = line.match(/^@@ .* \+(\d+)(?:,\d+)? @@/);
    if (hunkMatch) {
      currentLineNum = parseInt(hunkMatch[1], 10) - 1;
      continue;
    }
    // Track line advancement: added or context lines advance; deletions don't
    if (line.startsWith("+") && !line.startsWith("+++")) {
      currentLineNum++;
      if (!currentFile || !isInScope(currentFile)) continue;
      // Strip leading "+" to get the actual added text
      const text = line.slice(1);
      // Skip if line is inside a comment (heuristic — start with // or *)
      const trimmed = text.trim();
      if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) continue;
      // Scan against kill list
      for (const rule of KILL_LIST) {
        rule.pattern.lastIndex = 0;
        const m = rule.pattern.exec(text);
        if (m) {
          violations.push({
            file: currentFile,
            line: currentLineNum,
            match: m[0],
            context: text.trim().slice(0, 120),
            why: rule.why,
            fix: rule.fix,
          });
        }
      }
    } else if (line.startsWith(" ")) {
      currentLineNum++;
    }
    // "-" lines don't advance the new-file line counter
  }

  return { violations, filesScanned: filesScanned.size };
}

// ─── AUDIT MODE: scan ALL in-scope files ─────────────
function scanAllFiles() {
  const out = execSync("git ls-files", { cwd: APP_ROOT, encoding: "utf8" });
  const files = out.split("\n").filter(Boolean).filter(isInScope);

  const violations = [];
  for (const f of files) {
    let body;
    try {
      body = readFileSync(resolve(APP_ROOT, f), "utf8");
    } catch {
      continue;
    }
    // Strip comments to avoid false positives in documentation
    const stripped = body
      .replace(/\/\/[^\n]*/g, "")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
    for (const rule of KILL_LIST) {
      rule.pattern.lastIndex = 0;
      let m;
      while ((m = rule.pattern.exec(stripped)) !== null) {
        const lineNum = stripped.slice(0, m.index).split("\n").length;
        violations.push({ file: f, line: lineNum, match: m[0], why: rule.why, fix: rule.fix });
      }
    }
  }
  return { violations, filesScanned: files.length };
}

// ─── MAIN ────────────────────────────────────────────
const { violations, filesScanned } = AUDIT_MODE ? scanAllFiles() : scanStagedDiff();

if (violations.length === 0) {
  console.log(`[brand-voice] ${filesScanned} file(s) scanned · 0 violations · ✓`);
  process.exit(0);
}

const byFile = new Map();
for (const v of violations) {
  if (!byFile.has(v.file)) byFile.set(v.file, []);
  byFile.get(v.file).push(v);
}

for (const [file, vs] of byFile) {
  console.log(`\n❌ ${file}`);
  for (const v of vs) {
    console.log(`   line ${v.line}: "${v.match}"`);
    if (v.context) console.log(`     ↳ ${v.context}`);
    console.log(`     why: ${v.why}`);
    console.log(`     fix: ${v.fix}`);
  }
}

console.log(`\n${"━".repeat(60)}`);
console.log(`Found ${violations.length} brand-voice violation(s) in ${byFile.size} file(s).`);
console.log(`Mode: ${AUDIT_MODE ? "AUDIT (all files)" : "PRE-COMMIT (staged diff only)"}`);
console.log(`See .claude/brand-voice-guidelines.md §3 for the full list.`);

if (AUDIT_MODE) {
  console.log(`(audit mode — not blocking. Pre-commit mode would only block on NEW lines.)`);
  process.exit(0);
}

console.log(`To bypass for a legitimate one-off: git commit --no-verify`);
process.exit(1);
