// v10.0.415 · validate the LLM-synthesized proposedRuleChange path.
import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());
import { analyzeJudgmentsWithSynthesis } from "@/lib/brain/improve-agent";

const SYNTHETIC_JUDGMENTS = Array.from({ length: 30 }, (_, i) => ({
  messageId: `m_${i}`,
  composite: 5,
  rubric: {
    accuracy: 8,
    actionability: 8,
    brevity: 8,
    tone: i < 8 ? 2 : 8, // 8/30 fail tone
    evidence: 8,
  },
  reasoning: i < 8
    ? [
        "Reply opens with 'Great question!' · sycophantic preamble",
        "Reply contains corporate softener 'I appreciate that you...'",
        "Reply ends with 'Let me know if you have any other questions' · filler",
        "Reply uses 'Absolutely!' as the first word",
        "Reply restates the question in 'so what you're asking is...'",
        "Reply opens with 'That's a great point' before answering",
        "Reply has 'happy to help' phrase before content",
        "Reply opens with 'Of course!'",
      ][i]
    : "fine",
  judgedAt: new Date(),
}));

async function main() {
  console.log("=== synthesis smoke · v10.0.415 ===\n");
  const t0 = Date.now();
  const out = await analyzeJudgmentsWithSynthesis(SYNTHETIC_JUDGMENTS);
  console.log(`elapsed: ${Date.now() - t0}ms\n`);
  for (const h of out) {
    console.log(`AXIS · ${h.axis} · ${Math.round(h.failureRate * 100)}% failing`);
    console.log(`  proposedRuleChange:`);
    console.log(`    ${h.proposedRuleChange}`);
    console.log("");
  }
  process.exit(0);
}
main().catch((e) => { console.error("FAIL:", e); process.exit(1); });
