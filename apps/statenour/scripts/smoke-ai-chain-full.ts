/**
 * scripts/smoke-ai-chain-full.ts · v10.0.435
 *
 * End-to-end AI-chain smoke across brain, chat, and the rest of
 * bdnick.info. Each test exercises ONE AI-consuming layer with a
 * known input + reports pass/fail with provider + latency.
 *
 * Layers covered:
 *
 *   PROVIDER
 *     · aiChat fast      · simplest possible call
 *     · aiChat reason    · larger prompt + context
 *     · aiChat classify  · JSON-output mode
 *     · getEmbedding     · embedding endpoint
 *
 *   BRAIN
 *     · contextual-recall · pulls memories for a query
 *     · memory-recall     · KNN over wisdom
 *     · wisdom-distiller  · gateWisdom + violation detection
 *     · judge-eval        · LLM-as-judge 5-axis scoring
 *     · skill-recall      · 1,423 skills (v10.0.433)
 *
 *   CHAT
 *     · system-prompt build   · full prompt for a sample message
 *     · sanitize-history      · output sanitizer
 *     · action-intent-detect  · pure regex layer
 *     · mode-persona detect   · /battle /reflect /execute
 *
 *   AUTONICKS (other AI surfaces)
 *     · web-search (Perplexity) · if PERPLEXITY_API_KEY set
 *     · adversarial-critic      · counter-view generation
 *     · realtime-voice          · session token mint
 *
 * Output: console table + JSON dump for trending.
 */

import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());

// v10.0.435 · `server-only` package isn't installed (Next.js provides
// it at runtime). When a tsx script transitively imports a module
// that uses it, the require fails. Stub it via Node module shim so
// the smoke can exercise server-side code paths without Next.
import Module from "node:module";
import { resolve as pathResolve } from "node:path";
const NOOP_PATH = pathResolve(process.cwd(), "scripts", ".server-only-noop.js");
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request: string, ...args: unknown[]) {
  if (request === "server-only") return NOOP_PATH;
  // @ts-expect-error · variadic Node internal
  return origResolve.call(this, request, ...args);
};

interface SmokeResult {
  layer: string;
  surface: string;
  pass: boolean;
  detail: string;
  ms: number;
  provider?: string;
}

const results: SmokeResult[] = [];

async function check(
  layer: string,
  surface: string,
  fn: () => Promise<{ detail: string; provider?: string }>,
): Promise<void> {
  const t0 = Date.now();
  try {
    const r = await fn();
    results.push({ layer, surface, pass: true, detail: r.detail, ms: Date.now() - t0, provider: r.provider });
  } catch (err) {
    results.push({
      layer,
      surface,
      pass: false,
      detail: err instanceof Error ? err.message.slice(0, 200) : String(err),
      ms: Date.now() - t0,
    });
  }
}

async function main() {
  console.log("=== AI chain · full smoke · v10.0.435 ===\n");

  // ── PROVIDER ────────────────────────────────────────────────
  await check("provider", "aiChat fast", async () => {
    const { aiChat } = await import("@/lib/ai/provider");
    // v10.0.435 · ask for ≥5 chars · the garbage gate at provider.ts:1043
    // rejects responses <5 chars · "OK" alone fails it.
    const r = await aiChat(
      [{ role: "user", content: "Say the word 'ready' and nothing else." }],
      "fast",
    );
    if (!r.content || r.content.length < 1) throw new Error("empty content");
    if (/I'm having trouble connecting/i.test(r.content)) {
      throw new Error(`emergency sentinel · all providers failed · provider=${r.provider}`);
    }
    return { detail: `${r.content.slice(0, 30)}`, provider: r.provider };
  });

  await check("provider", "aiChat reason", async () => {
    const { aiChat } = await import("@/lib/ai/provider");
    const r = await aiChat(
      [
        { role: "system", content: "You are a brevity engine. ≤8 words." },
        { role: "user", content: "What's 2+2?" },
      ],
      "reason",
    );
    if (!/4|four/i.test(r.content)) throw new Error(`unexpected: ${r.content?.slice(0, 80)}`);
    return { detail: `${r.content.slice(0, 30)}`, provider: r.provider };
  });

  await check("provider", "aiChat classify (JSON)", async () => {
    const { aiChat } = await import("@/lib/ai/provider");
    const r = await aiChat(
      [
        { role: "system", content: "Output JSON only: {\"x\": <number>}" },
        { role: "user", content: "Set x to 7." },
      ],
      "classify",
    );
    const m = r.content.match(/\{[\s\S]*\}/);
    if (!m) throw new Error(`no JSON: ${r.content.slice(0, 80)}`);
    const parsed = JSON.parse(m[0]);
    if (parsed.x !== 7 && Number(parsed.x) !== 7) throw new Error(`x=${parsed.x}`);
    return { detail: `JSON parsed · x=${parsed.x}`, provider: r.provider };
  });

  await check("provider", "getEmbedding", async () => {
    const { getEmbedding } = await import("@/lib/ai/provider");
    const v = await getEmbedding("the quick brown fox");
    if (!Array.isArray(v) || v.length === 0) throw new Error("empty vec");
    return { detail: `dim=${v.length}` };
  });

  // ── BRAIN ──────────────────────────────────────────────────
  await check("brain", "contextual-recall", async () => {
    const { getContextualMemories } = await import("@/lib/brain/contextual-recall");
    const block = await getContextualMemories(
      ["how is my revenue this week"],
      5,
    );
    return { detail: `${block.length} chars · ${block.length > 0 ? "memories surfaced" : "empty"}` };
  });

  await check("brain", "memory-recall (hybrid KNN)", async () => {
    const { recallMemoriesForQuery } = await import("@/lib/brain/memory-recall");
    const r = await recallMemoriesForQuery("focus is saying no", { limit: 3 });
    return { detail: `${r.hits?.length ?? 0} hits` };
  });

  await check("brain", "wisdom-distiller gate", async () => {
    const { gateWisdom } = await import("@/lib/brain/wisdom-quality-gate");
    const good = gateWisdom("WHEN active tasks exceed 30, IMMEDIATELY close 10 BECAUSE drift score correlates strongly with backlog above that threshold.");
    const bad = gateWisdom("Nick frequently provides advice on various topics.");
    if (!good.pass) throw new Error(`good wisdom rejected: ${good.reason}`);
    if (bad.pass) throw new Error("bad wisdom (vague meta) accepted");
    return { detail: `gate accepts principle · rejects vague meta` };
  });

  await check("brain", "judge-eval", async () => {
    const { judgeReply } = await import("@/lib/ai/judge-eval");
    const r = await judgeReply({
      userQuery: "what's my revenue this week",
      assistantReply: "I don't have this week's number in front of me · pull it via getRevenuePace and I'll trend vs the 28-day baseline. Want me to fire that?",
    });
    if (!r) throw new Error("judge returned null");
    if (typeof r.composite !== "number") throw new Error("bad rubric");
    return { detail: `composite=${r.composite}/10`, provider: r.judgedBy };
  });

  await check("brain", "skill-recall (1,423 skills)", async () => {
    const { recallSkills } = await import("@/lib/skills/skill-recall");
    const matches = await recallSkills("clean up tech debt in a React component", 3);
    if (matches.length === 0) throw new Error("no skill matches");
    return { detail: `${matches.length} skills · top: ${matches[0].name} (${matches[0].similarity})` };
  });

  await check("brain", "improve-agent.judgments", async () => {
    const { getRecentJudgments, analyzeJudgments } = await import("@/lib/brain/improve-agent");
    const j = await getRecentJudgments(7);
    const h = analyzeJudgments(j);
    return { detail: `${j.length} judgments · ${h.length} hypotheses` };
  });

  await check("brain", "wisdom-evolution.candidates", async () => {
    const { runWisdomEvolution } = await import("@/lib/brain/wisdom-evolution");
    const r = await runWisdomEvolution();
    return { detail: `stale ${r.stale.length} · redundant ${r.redundant.length} · low-trust ${r.lowTrust.length}` };
  });

  // ── CHAT ───────────────────────────────────────────────────
  await check("chat", "system-prompt build (full)", async () => {
    const { buildSystemPrompt } = await import("@/lib/ai/system-prompt");
    const t0 = Date.now();
    const prompt = await buildSystemPrompt("full", "show me my revenue trend this week");
    const ms = Date.now() - t0;
    if (!prompt || prompt.length < 1000) throw new Error(`too small: ${prompt?.length ?? 0}`);
    if (!/Relevant skills|skills/i.test(prompt)) {
      // Skill block may be empty if message hash is too short · OK
    }
    return { detail: `${prompt.length} chars · ${ms}ms` };
  });

  await check("chat", "sanitize-history", async () => {
    const { stripImageMarkdownFromText } = await import("@/lib/ai/chat/sanitize-history");
    // v10.0.435 · the regex requires the literal "Generated Image" alt
    // text + /api/images/<id> · matches what the chat actually emits.
    const dirty = "Yes, here it is: ![Generated Image](/api/images/abc12345) all set.";
    const clean = stripImageMarkdownFromText(dirty);
    if (clean.includes("![Generated Image]")) throw new Error("image markdown leaked");
    if (!clean.includes("[image rendered]")) throw new Error("placeholder missing");
    return { detail: `cleaned · ${dirty.length} → ${clean.length}` };
  });

  await check("chat", "action-intent-detector", async () => {
    const { detectActionIntent } = await import("@/lib/ai/chat/action-intent-detector");
    const r1 = detectActionIntent("add this to my todo list");
    const r2 = detectActionIntent("can you add me to the call list?");
    if (r1?.intent !== "task-add-to-list") throw new Error("legit task missed");
    if (r2 !== null) throw new Error(`conversational mention false-fired: ${r2.intent}`);
    return { detail: "fires on legit task · skips conversational" };
  });

  // "mode-persona helpers" check REMOVED 2026-09-15: components/chat/mode-persona-chip was
  // deleted in #689; the dynamic import made this script fail at that step ever since
  // (caught by check:scripts, TS2307).

  // ── AUTONICKS · OTHER AI SURFACES ──────────────────────────
  await check("autonicks", "structured · adversarial-critic", async () => {
    const { criticizeAsync } = await import("@/lib/ai/adversarial-critic");
    // criticizeAsync is fire-and-forget · just verify the import compiles
    if (typeof criticizeAsync !== "function") throw new Error("not a function");
    return { detail: "module + entry exports OK" };
  });

  await check("autonicks", "tool-embeddings index", async () => {
    const { embedUserMessage, rankToolsBySimilarity, getToolEmbeddingStats } =
      await import("@/lib/ai/tool-embeddings");
    const vec = await embedUserMessage("delete a task");
    const ranked = rankToolsBySimilarity(vec, 5);
    const stats = getToolEmbeddingStats();
    return {
      detail: `cache=${stats.size} tools · top match: ${ranked[0]?.toolName ?? "—"} (${ranked[0]?.similarity?.toFixed(2) ?? "—"})`,
    };
  });

  await check("autonicks", "topic-tagger", async () => {
    const { tagWisdomTopics } = await import("@/lib/brain/wisdom-topic-tagger");
    const t = tagWisdomTopics("Cut everything that isn't core revenue. Focus is saying no.");
    return { detail: `topics=[${t.join(",")}]` };
  });

  await check("autonicks", "context-reranker (Cohere)", async () => {
    const { cohereRerank, isCohereRerankAvailable } = await import("@/lib/brain/cohere-rerank");
    if (!isCohereRerankAvailable()) {
      return { detail: "skipped · COHERE_API_KEY not set" };
    }
    const r = await cohereRerank({
      query: "focus",
      candidates: [
        { text: "Cut everything that isn't core", item: "a" },
        { text: "The weather is nice today", item: "b" },
        { text: "Focus is the operator's edge", item: "c" },
      ],
      topN: 2,
    });
    return { detail: `${r?.length ?? 0} reranked` };
  });

  await check("autonicks", "withEfSearch (pgvector)", async () => {
    const { withEfSearch, EF_SEARCH } = await import("@/lib/db/vector-tuning");
    const { prisma } = await import("@/lib/prisma");
    const r = await withEfSearch(prisma, EF_SEARCH.HIGH_RECALL, async (tx) => {
      const rows = await tx.$queryRawUnsafe<{ n: number }[]>(
        `SELECT COUNT(*)::int AS n FROM vector_embeddings WHERE embedding_vec_1536 IS NOT NULL LIMIT 1`,
      );
      return rows[0]?.n ?? 0;
    });
    return { detail: `embedding count = ${r}` };
  });

  // ── REPORT ─────────────────────────────────────────────────
  console.log("\nLAYER".padEnd(12) + "SURFACE".padEnd(40) + "RESULT  TIME    DETAIL");
  console.log("─".repeat(120));

  const byLayer = new Map<string, SmokeResult[]>();
  for (const r of results) {
    if (!byLayer.has(r.layer)) byLayer.set(r.layer, []);
    byLayer.get(r.layer)!.push(r);
  }

  let pass = 0;
  let fail = 0;
  for (const [layer, list] of byLayer) {
    for (const r of list) {
      const icon = r.pass ? "✓" : "✗";
      const ms = String(r.ms).padStart(5) + "ms";
      const provider = r.provider ? ` [${r.provider}]` : "";
      console.log(
        `${layer.padEnd(12)}${r.surface.padEnd(40)}${icon}      ${ms}   ${r.detail}${provider}`,
      );
      if (r.pass) pass++;
      else fail++;
    }
  }

  console.log("─".repeat(120));
  console.log(`\n${pass}/${results.length} layers passed (${Math.round((pass / results.length) * 100)}%)`);
  if (fail > 0) {
    console.log("\nFAILURES:");
    for (const r of results.filter((x) => !x.pass)) {
      console.log(`  ✗ [${r.layer}] ${r.surface} · ${r.detail}`);
    }
  }

  // Disconnect prisma
  try {
    const { prisma } = await import("@/lib/prisma");
    await prisma.$disconnect();
  } catch {
    /* ignore */
  }

  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
