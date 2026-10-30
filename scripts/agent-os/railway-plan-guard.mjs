#!/usr/bin/env node
/**
 * Refuse a `railway config plan` that would destroy anything.
 *
 * 2026-10-30: the plan for the merged railway.ts (#3384) read "2 to change, 28 to
 * destroy". Variables run in managed mode, so 28 live variables that railway.ts
 * never declared would have been deleted, and nickstire's start command would
 * have lost NODE_ENV=production. Nothing was applied: the manager read the plan.
 * This makes that read mechanical.
 *
 * Usage, before every apply:
 *   railway config plan > plan.txt
 *   node scripts/agent-os/railway-plan-guard.mjs plan.txt
 * Exit 0 = no destroy. Exit 1 = destroys listed, or the text is not a plan.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * A missing "Plan:" summary is NOT a clean plan: a failed evaluation prints an
 * error and no summary, and that must never read as "0 to destroy".
 */
const UP_TO_DATE_LINE = "\u2713 Your Railway configuration is already up to date.";

function isUpToDateTranscript(lines) {
  const nonEmpty = lines.map((l) => l.trim()).filter(Boolean);
  return (
    nonEmpty[0] === "Railway configuration" &&
    nonEmpty.includes(UP_TO_DATE_LINE) &&
    !nonEmpty.some((l) => /\b(error|failed|exception|panic)\b/i.test(l))
  );
}

export function planDestroys(text) {
  const lines = String(text).split(/\r?\n/);
  const deletes = lines.filter((l) => /^\s*-\s+(Delete|Destroy|Remove)\b/.test(l)).map((l) => l.trim());
  const summary = lines.map((l) => l.match(/^\s*Plan:\s*\d+ to add,\s*\d+ to change,\s*(\d+) to destroy/)).find(Boolean);
  // The CLI prints no Plan: line when live already matches the file (2026-10-30, after the first apply).
  // Accept only its complete success transcript: the header first, the exact success line, and no
  // error line. A failed run that merely MENTIONS the phrase is refused (Codex review, PR 3416).
  if (!summary && deletes.length === 0 && isUpToDateTranscript(lines)) return { ok: true, destroyCount: 0, deletes };
  if (!summary) return { ok: false, destroyCount: null, deletes, reason: "no Plan: summary line, so this is not a finished plan" };
  const destroyCount = Number(summary[1]);
  return { ok: destroyCount === 0 && deletes.length === 0, destroyCount, deletes };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const file = process.argv[2];
  if (!file) {
    console.error("usage: node scripts/agent-os/railway-plan-guard.mjs <plan.txt>");
    process.exit(1);
  }
  const r = planDestroys(readFileSync(file, "utf8"));
  if (r.ok) {
    console.log("railway plan guard: 0 to destroy");
    process.exit(0);
  }
  console.error(`railway plan guard: REFUSE apply (${r.reason ?? `${r.destroyCount} to destroy`})`);
  for (const d of r.deletes) console.error("  " + d);
  process.exit(1);
}
