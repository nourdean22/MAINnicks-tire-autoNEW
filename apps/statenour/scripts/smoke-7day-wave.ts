/**
 * scripts/smoke-7day-wave.ts · v10.0.417
 *
 * Comprehensive smoke for the entire v10.0.397-417 wave. Hits every
 * new lib + endpoint that backs an operator-visible surface.
 *
 * Failure here = an operator-visible feature is broken. Pre-push
 * passes type/lint/test gates but doesn't catch "the function works
 * against mock data but explodes against production data".
 */
import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());
import { prisma } from "@/lib/prisma";
import { getRecentJudgments, analyzeJudgments } from "@/lib/brain/improve-agent";
import { runWisdomEvolution } from "@/lib/brain/wisdom-evolution";
import { computeWisdomViolations } from "@/lib/brain/wisdom-violations";
import { getViolationContext } from "@/lib/brain/violation-context";
import { tagWisdomTopics, classifyQueryTopics } from "@/lib/brain/wisdom-topic-tagger";
import {
  DO_NOT_AUTO_TASKIFY,
  NO_SYCOPHANCY,
  BREVITY_DEFAULT,
  INLINE_CITATIONS,
  CONFIDENCE_CUES,
  TIME_OF_DAY_VOICE,
  MODE_PERSONAS,
  TRUTH_RULE_NEVER_FABRICATE,
  getOperatorPolicyBlock,
} from "@/lib/ai/prompt/policy/operator-rules";
import { withEfSearch, EF_SEARCH } from "@/lib/db/vector-tuning";
import { applyMode, nextMode } from "@/components/chat/mode-persona-chip";

interface SmokeResult { layer: string; pass: boolean; detail: string; ms: number }

async function check(name: string, fn: () => Promise<string>): Promise<SmokeResult> {
  const t0 = Date.now();
  try {
    const detail = await fn();
    return { layer: name, pass: true, detail, ms: Date.now() - t0 };
  } catch (err) {
    return {
      layer: name,
      pass: false,
      detail: err instanceof Error ? err.message.slice(0, 200) : String(err),
      ms: Date.now() - t0,
    };
  }
}

async function main() {
  console.log("=== 7-day wave smoke · v10.0.397-417 ===\n");
  const results: SmokeResult[] = [];

  // v10.0.404 · operator-rules constants (in-process, no IO)
  results.push(
    await check("operator-rules.constants", async () => {
      if (!DO_NOT_AUTO_TASKIFY.includes("AUTO-TASKIFY")) throw new Error("missing AUTO-TASKIFY");
      if (!NO_SYCOPHANCY.includes("Great question")) throw new Error("missing Great question");
      if (!BREVITY_DEFAULT.match(/[≤<]\s*80/)) throw new Error("missing 80-word cap");
      if (!INLINE_CITATIONS.includes("Buffett")) throw new Error("missing Buffett tag");
      if (!CONFIDENCE_CUES.includes("Don't know")) throw new Error("missing Don't know");
      if (!/morning/i.test(TIME_OF_DAY_VOICE)) throw new Error("missing time bands");
      if (!MODE_PERSONAS.includes("/battle")) throw new Error("missing /battle");
      if (!TRUTH_RULE_NEVER_FABRICATE.includes("never claim")) throw new Error("missing never claim");
      const block = getOperatorPolicyBlock();
      return `8 rules · ${block.length} chars`;
    }),
  );

  // v10.0.394 · topic tagger
  results.push(
    await check("topic-tagger", async () => {
      const t1 = tagWisdomTopics("Focus on revenue · cut everything else.");
      const t2 = classifyQueryTopics("how do I close more leads?");
      if (t1.length === 0 && t2.length === 0) throw new Error("both classifications empty");
      return `wisdom-topics: [${t1.join(",")}] · query-topics: [${t2.join(",")}]`;
    }),
  );

  // v10.0.413 · mode-persona pure helpers
  results.push(
    await check("mode-persona.helpers", async () => {
      if (applyMode("hello", "default") !== "hello") throw new Error("default should be unchanged");
      if (applyMode("hello", "battle") !== "/battle hello") throw new Error("battle prefix");
      if (applyMode("/battle hi", "battle") !== "/battle hi") throw new Error("double-prefix bug");
      if (nextMode("execute") !== "default") throw new Error("cycle wrap");
      return "applyMode + nextMode green";
    }),
  );

  // v10.0.405 · improve-agent (live DB)
  results.push(
    await check("improve-agent.judgments", async () => {
      const judgments = await getRecentJudgments(7);
      const hypotheses = analyzeJudgments(judgments);
      return `${judgments.length} judgments · ${hypotheses.length} axis hypotheses`;
    }),
  );

  // v10.0.406 · wisdom-evolution (live DB)
  results.push(
    await check("wisdom-evolution.candidates", async () => {
      const r = await runWisdomEvolution();
      return `stale ${r.stale.length} · redundant ${r.redundant.length} · low-trust ${r.lowTrust.length}`;
    }),
  );

  // v10.0.399 · wisdom-violations (live DB · output sample)
  results.push(
    await check("wisdom-violations.compute", async () => {
      const v = await computeWisdomViolations({ daysBack: 7, limit: 5 });
      const sample = v[0]
        ? `${v[0].key} · rate ${(v[0].violationRate * 100).toFixed(0)}%`
        : "no violations";
      return `${v.length} violations · ${sample}`;
    }),
  );

  // v10.0.414 · violation-context (live DB · cached, also tests the
  // junk-filter post-cleanup)
  results.push(
    await check("violation-context.block", async () => {
      const block = await getViolationContext();
      if (block && block.includes("[PROMOTED TO WISDOM]")) {
        throw new Error("junk filter regression · [PROMOTED TO WISDOM] leaked into prompt");
      }
      if (block && block.includes("[PROVEN PATTERN]")) {
        throw new Error("junk filter regression · [PROVEN PATTERN] leaked into prompt");
      }
      return `${block.length} chars · ${block ? "live" : "empty (clean)"}`;
    }),
  );

  // v10.0.403 · withEfSearch wrapper (live DB · runs in transaction)
  results.push(
    await check("vector-tuning.withEfSearch", async () => {
      const result = await withEfSearch(prisma, EF_SEARCH.HIGH_RECALL, async (tx) => {
        const rows = await tx.$queryRawUnsafe<{ n: number }[]>(
          `SELECT COUNT(*)::int AS n FROM vector_embeddings WHERE embedding_vec_1536 IS NOT NULL LIMIT 1`,
        );
        return rows[0]?.n ?? 0;
      });
      return `embedding count = ${result}`;
    }),
  );

  // v10.0.402 · wisdom graph (cosine similarity computation)
  results.push(
    await check("wisdom-graph.cosine", async () => {
      const wisdoms = await prisma.brainMemory.findMany({
        where: { category: "wisdom", deletedAt: null, confidence: { gte: 0.8 } },
        select: { id: true },
        take: 1,
      });
      if (wisdoms.length === 0) return "no wisdoms · skipped";
      const e = await prisma.vectorEmbedding.findFirst({
        where: { sourceType: "brain_memory", sourceId: wisdoms[0].id },
        select: { embedding: true },
      });
      if (!e) return "no embedding for sample wisdom · skipped";
      const vec = JSON.parse(e.embedding) as number[];
      return `embedding dim ${vec.length}`;
    }),
  );

  // Print results
  const failures = results.filter((r) => !r.pass);
  for (const r of results) {
    const icon = r.pass ? "✓" : "✗";
    console.log(`  ${icon} ${r.layer.padEnd(28)} ${String(r.ms).padStart(5)}ms · ${r.detail}`);
  }
  console.log(`\n  ${results.length - failures.length}/${results.length} passed`);
  await prisma.$disconnect();
  if (failures.length > 0) process.exit(1);
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
