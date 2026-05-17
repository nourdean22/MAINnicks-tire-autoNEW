// v10.0.412 · validate the refactored judge actually fires + persists.
import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());
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
