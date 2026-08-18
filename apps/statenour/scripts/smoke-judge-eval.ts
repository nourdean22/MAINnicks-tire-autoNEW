// v10.0.412 · validate the refactored judge actually fires + persists.
import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());

// 2026-08-18 · neutralize `server-only` for bare tsx — judgeReply
// dynamically imports traced-aichat.ts (`import "server-only"`, wave-AO)
// which throws outside a react-server context, so this smoke crashed
// before judging anything. Same Module._load pattern as
// scripts/measure-prompt-size.ts / backfill-persona-judgments.ts.
//
// ENV NOTE: .env.local carries a placeholder OLLAMA_API_KEY + localhost
// OLLAMA_BASE_URL (test isolation) which @next/env prefers over .env —
// under the cost firewall the chain then sees zero available providers.
// Lift the real values into process env before running:
//   export OLLAMA_API_KEY=<from .env> ; export OLLAMA_BASE_URL=https://ollama.com
import { Module } from "node:module";
{
  const cjs = Module as unknown as {
    _load: (request: string, parent: unknown, isMain: boolean) => unknown;
  };
  const original = cjs._load;
  cjs._load = (request, parent, isMain) =>
    request === "server-only" ? {} : original(request, parent, isMain);
}

import { judgeReply } from "@/lib/ai/judge-eval";

async function main() {
  console.log("=== judge eval smoke ===\n");

  const t0 = Date.now();
  const report = await judgeReply({
    userQuery: "what's my revenue this week?",
    assistantReply: "I don't have this week's number in front of me · pull it via getRevenuePace and I'll trend vs the 28-day baseline. Want me to fire that?",
  });

  console.log(`elapsed: ${Date.now() - t0}ms`);
  if (!report) {
    console.log("FAIL · judge returned null");
    process.exit(1);
  }
  console.log("composite:", report.composite);
  console.log("rubric:", report.rubric);
  console.log("reasoning:", report.reasoning);
  console.log("flagForReview:", report.flagForReview);
  console.log("judgedBy:", report.judgedBy);
  console.log("durationMs:", report.durationMs);
  console.log("\n✓ judge fires + parses · provider chain working");
  process.exit(0);
}

main().catch((e) => { console.error("FAIL:", e); process.exit(1); });
