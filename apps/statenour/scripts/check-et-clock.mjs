#!/usr/bin/env node
/**
 * Bare `getHours()` / `getDay()` must be unrepresentable, not merely absent.
 *
 * THE DEFECT, 2026-08-23. The operator's phone read 5:21 PM. Nick's reply
 * opened "Sunday night, 9:20pm. Shop's closed." and closed "Late night, Sunday.
 * This is the loop where you ruminate and degrade Monday." Exactly +4h: the ET
 * offset. Not off by four hours — in the wrong FRAME. Nick's posture is keyed to
 * time of day, so every behavioural inference downstream was anchored to a state
 * the operator was not in.
 *
 * MECHANISM: the server runs UTC on Railway, so `new Date().getHours()` returns
 * 21 at 5pm ET. Anything using the bare form and reaching Nick's context hands
 * him a UTC clock as if it were the operator's wall time.
 *
 * WHY THIS SCRIPT EXISTS RATHER THAN JUST A FIX. `lib/utils/datetime.ts` already
 * exported `hourET()` and `weekdayET()`, and already documented the reason in a
 * comment that reads like a postmortem:
 *
 *     "The server runs UTC (Railway), so `new Date().getHours()` returns the UTC
 *      hour — use this for ET time-gates so they fire at the right wall-clock."
 *
 * Someone diagnosed this exactly, wrote the correct helper, and explained it.
 * It then reached 108 files and stopped at 38 others. **The knowledge was never
 * the missing piece. The enforcement was.** Fixing 38 call sites without a gate
 * guarantees a 39th, because adoption already demonstrably does not hold.
 *
 * A SECOND-ORDER NOTE WORTH KEEPING. The one place that got it right —
 * `buildTemporalContext`, explicit `Intl.DateTimeFormat` with America/New_York
 * and a "Vercel runs UTC; we use Intl" comment — sits in the same prompt builder
 * as several wrong ones. Correct and incorrect implementations of one concept,
 * inside one context window, and the correct one's presence made the surrounding
 * block look trustworthy.
 *
 * ALLOWLIST POLICY: a UTC clock is legitimate when the value IS a UTC quantity —
 * a duration, an expiry offset, a bucket key over already-UTC data. Each entry
 * states why. An unexplained entry is how a gate becomes theatre.
 *
 * THE SAME RULE APPLIES TO THE EXEMPTION CATEGORIES BELOW, not only to individual
 * entries, because a category exemption is the one a future reader is most likely
 * to "fix". Each is stated with its reasoning at the point it is applied:
 *
 *   · CLIENT COMPONENTS — the important one. In the browser `getHours()` returns
 *     the OPERATOR'S OWN local time, which is exactly what a UI should render.
 *     Forcing ET there would plant this very bug for anyone outside Cleveland,
 *     and would do it in the surface the operator looks at most. The defect is
 *     server-side only: the identical call means different things across the
 *     wire. Anyone reading this exemption and thinking "that looks like an
 *     oversight" should read this paragraph twice before removing it.
 *   · setHours(x.getHours() + n) — a DURATION, not a wall-clock reading. The
 *     value never leaves the arithmetic.
 *   · getUTCHours / getUTCDay — explicitly UTC, therefore deliberate.
 *   · COMMENTS — a comment describing the hazard is not the hazard.
 *     command-center-state.ts documents this exact trap and was being reported
 *     for saying so, which is how a gate teaches people to stop writing warnings.
 */
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

/** Legitimate UTC uses. `reason` is mandatory — no bare paths. */
const ALLOW = [
  { path: "lib/utils/datetime.ts", reason: "the helper itself — it is what everything else must call" },
  { path: "scripts/check-et-clock.mjs", reason: "this gate quotes the patterns it forbids" },
  { path: "lib/ai/runtime/approval-gate.ts", reason: "setHours(+24) is a DURATION, not a wall-clock reading" },
  { path: "lib/tools/guardian.ts", reason: "setHours(+N) expiry offset, not a wall clock" },
  { path: "lib/logger.ts", reason: "log line timestamps are machine-facing and deliberately UTC" },
  { path: "lib/hooks/use-commander-greeting.ts", reason: "React hook — runs in the BROWSER via useEffect, so getHours() is the operator's own local time, which is what a greeting should use" },
];

const PATTERNS = [
  { re: /\.getHours\s*\(\s*\)/g, name: "getHours()", fix: "hourET() from @/lib/utils/datetime" },
  { re: /\.getDay\s*\(\s*\)/g, name: "getDay()", fix: "weekdayET() from @/lib/utils/datetime" },
];

/** `setHours(x.getHours() + n)` is an offset, not a reading. */
const OFFSET_RE = /set(?:UTC)?Hours\s*\(\s*[A-Za-z0-9_.]*\.get(?:UTC)?Hours\s*\(\s*\)\s*[+-]/;

function tracked() {
  return execFileSync("git", ["ls-files", "--", "lib", "app", "components"], {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  })
    .split("\n")
    .map((l) => l.trim())
    .filter((f) => f.endsWith(".ts") || f.endsWith(".tsx"));
}

const allowed = new Set(ALLOW.map((a) => a.path));
const offenders = [];

for (const file of tracked()) {
  if (allowed.has(file)) continue;
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  // CLIENT COMPONENTS ARE CORRECT AS-IS, and this exemption is the difference
  // between a gate that survives and one that gets disabled. In the browser
  // `new Date().getHours()` returns the OPERATOR'S OWN local time, which is
  // exactly what a UI should render — forcing ET there would introduce this very
  // bug for anyone not in Cleveland. The defect is server-side only: Railway runs
  // UTC, so the identical call means different things across the wire.
  if (/^\s*["']use client["']/m.test(text)) continue;

  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Comments describing the hazard are not the hazard. command-center-state.ts
    // documents this exact trap and would otherwise be reported for saying so.
    const trimmed = line.trim();
    if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) continue;
    // A UTC-explicit call is a deliberate UTC quantity and is fine.
    if (/getUTCHours|getUTCDay/.test(line)) continue;
    if (OFFSET_RE.test(line)) continue;
    // An inline waiver must say why, on the same line.
    if (/et-clock-allow:/.test(line)) continue;
    for (const p of PATTERNS) {
      p.re.lastIndex = 0;
      if (p.re.test(line)) {
        offenders.push({ file, line: i + 1, name: p.name, fix: p.fix, text: line.trim().slice(0, 96) });
        break;
      }
    }
  }
}

if (offenders.length === 0) {
  console.log(`✅ ET clock: no bare getHours()/getDay() outside the allowlist (${ALLOW.length} entries, each with a reason)`);
  process.exit(0);
}

console.error(`❌ ET clock: ${offenders.length} bare UTC clock reading(s).`);
console.error(`   The server runs UTC. new Date().getHours() is 21 at 5pm ET — this is the`);
console.error(`   defect that told the operator it was 9:20pm on a Sunday afternoon.\n`);
for (const o of offenders) {
  console.error(`   ${o.file}:${o.line}`);
  console.error(`     ${o.text}`);
  console.error(`     fix · use ${o.fix}`);
}
console.error(`\n   If a reading is genuinely a UTC quantity, add \`// et-clock-allow: <why>\``);
console.error(`   on the line, or add the file to ALLOW in this script WITH a reason.`);
process.exit(1);
