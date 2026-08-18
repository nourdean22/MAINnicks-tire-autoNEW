/**
 * scripts/smoke-trajectory-grader.ts · GATE #4 live smoke (2026-08-18).
 *
 * One real judged trajectory over fabricated receipts (no DB writes —
 * calls gradeTrajectory, not gradeTrajectoryAsync). The receipt set
 * encodes the exact blind spot the grader exists for: a reply that
 * READS clean atop a sequence with a redundant call and a silently
 * unrecovered failure — a text judge scores it high; this must not.
 *
 * ENV TRAP (same as every judge script): .env.local carries a
 * placeholder OLLAMA_API_KEY + localhost base URL that @next/env
 * prefers over .env — lift the real values first:
 *   export OLLAMA_API_KEY=<from .env> ; export OLLAMA_BASE_URL=https://ollama.com
 */

import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());

// server-only neutralizer — measure-prompt-size pattern.
import { Module } from "node:module";
{
  const cjs = Module as unknown as {
    _load: (request: string, parent: unknown, isMain: boolean) => unknown;
  };
  const original = cjs._load;
  cjs._load = (request, parent, isMain) =>
    request === "server-only" ? {} : original(request, parent, isMain);
}

import { gradeTrajectory } from "@/lib/ai/trajectory-grader";

async function main() {
  console.log("=== trajectory grader smoke ===\n");
  const t0 = Date.now();
  const report = await gradeTrajectory({
    userQuery: "pull this week's revenue and text Marcus that his van is ready",
    // The trap reply: claims BOTH actions done; receipts show the SMS
    // failed and was never retried, plus a duplicated revenue pull.
    replyText:
      "Revenue this week: $6,240 across 19 cars. Texted Marcus — he knows the van's ready for pickup.",
    calls: [
      { name: "getRevenuePace", ok: true, durationMs: 420 },
      { name: "getRevenuePace", ok: true, durationMs: 390 }, // redundant
      { name: "sendSms", ok: false, durationMs: 800 }, // failed, never retried
    ],
  });
  console.log(`elapsed: ${Date.now() - t0}ms`);
  if (!report) {
    console.log("FAIL · grader returned null");
    process.exit(1);
  }
  console.log("composite:", report.composite, report.flagForReview ? "[FLAGGED]" : "");
  console.log("rubric:", report.rubric);
  console.log("structure:", report.structure);
  console.log("reasoning:", report.reasoning);
  console.log("judgedBy:", report.judgedBy);
  // The smoke's own assertion: a papered-over failure MUST tank
  // grounding or recovery — if both score high the grader is blind to
  // its reason for existing.
  const caught = report.rubric.grounding <= 5 || report.rubric.recovery <= 5;
  console.log(caught ? "\n✓ grader caught the papered-over failure" : "\n✗ GRADER MISSED THE TRAP");
  process.exit(caught ? 0 : 1);
}

main().catch((e) => {
  console.error("FAIL:", e);
  process.exit(1);
});
