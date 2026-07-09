/**
 * buildBrainContext · May 02 · chat-route extract chunk 3
 *
 * Lifted verbatim from app/api/ai/chat/route.ts (the brain context-
 * blocks try/catch + reranking + deeper-context telemetry, lines
 * 510-701). Owns the per-turn brain-context assembly:
 *
 *   1. Parallel-import 7 brain modules (chat-recall, skills, identity,
 *      ghost, qualitative-identity, beliefs, cross-system-nudge) +
 *      task-context, all with 3s timeout fallback so a single slow DB
 *      trip can't tank the chat stream.
 *   2. Rerank blocks by semantic similarity to the user turn (drops
 *      blocks below 0.12 similarity threshold to save context window).
 *      Falls back to raw order when embedding is empty or rerank
 *      throws.
 *   3. Track which blocks fired (drives X-Context-Blocks header +
 *      onFinish telemetry).
 *   4. Extract deeper-context telemetry from the contextMemories
 *      string (count + type list — Strategic Laws, Reflections, Brain
 *      Dumps, Past Replies).
 *   5. Append predictive-prefetch blocks if any landed.
 *
 * Returns the addendum string + telemetry. Caller appends the addendum
 * to systemPrompt and surfaces the fired-flags + counts on the response
 * headers.
 *
 * Pure orchestration over already-extracted brain modules — no inline
 * DB calls, no closures, fully testable by mocking the dynamic imports.
 */

import { rerankContextBlocks, formatRerankSummary } from "@/lib/ai/context-reranker";
import { formatPrefetchContext } from "@/lib/ai/predictive-prefetch";
import type { PrefetchResult } from "@/lib/ai/predictive-prefetch";
import type { ChatMode } from "@/lib/ai/chat-mode";

interface ChatLogger {
  info(event: string, ctx?: Record<string, unknown>): void;
  warn(event: string, ctx?: Record<string, unknown>): void;
}

export interface ContextBlocksFired {
  recall: boolean;
  skills: boolean;
  identity: boolean;
  ghost: boolean;
  qualitative: boolean;
  beliefs: boolean;
  nudges: boolean;
  contradictions: boolean;
  /** v10.0.529.106 · Wave 62 · cross-session "open threads" carry-over */
  concerns: boolean;
  /** 2026-06-10 · anticipated-question cosine match (precomputed nightly take) */
  anticipated: boolean;
  physical: boolean;
  // Index signature so Prisma's InputJsonValue accepts this type when
  // it gets persisted into ChatMessage.tokenUsage.contextBlocks. Pure
  // type accommodation — no runtime keys beyond the named flags.
  [key: string]: boolean;
}

export interface BuildBrainContextInput {
  userContent: string;
  mode: ChatMode;
  /** Pre-computed user embedding from the prefetch step. Empty array = skip rerank. */
  userEmbedding: number[];
  forceRecall: boolean;
  messages: Array<{ role: string; content: string }>;
  convId: string;
  log: ChatLogger;
}

export interface BuildBrainContextOutput {
  /**
   * Concatenated additions for the system prompt, ready to append.
   * Leads with `\n\n` separators between blocks. Empty string when no
   * blocks fired.
   */
  systemPromptAddendum: string;
  contextBlocksFired: ContextBlocksFired;
  deeperContextCount: number;
  deeperContextTypes: string[];
  recalledHits?: any[];
  detectedContradictions?: any[];
}

const EMPTY_FIRED: ContextBlocksFired = {
  recall: false, skills: false, identity: false, ghost: false,
  qualitative: false, beliefs: false, nudges: false, contradictions: false,
  concerns: false, anticipated: false, physical: false,
};

export async function buildBrainContext(
  input: BuildBrainContextInput,
): Promise<BuildBrainContextOutput> {
  const { userContent, mode, userEmbedding, forceRecall, messages, convId, log } = input;

  // Apr 19 · Task context injection — fires in parallel with the
  // brain blocks below. Surfaces the live DOING/READY queue so Nick
  // always knows what Nour is carrying without being told. See
  // lib/brain/task-context.ts for the shape.
  const taskContextPromise = import("@/lib/brain/task-context")
    .then((m) => m.buildTaskContextBlock())
    .catch(() => "");

  // Apr 19 · Brain-learning context blocks — ALL PARALLEL.
  //
  // Previously these 7 blocks ran serially: chat-recall → skills →
  // identity → ghost → (qual + beliefs + nudges in parallel). At ~1-3s
  // per DB trip that's 8-15s of blocking BEFORE the stream opens,
  // which was tripping the mid-stream timeout ("Nick is stuck · tap
  // retry"). Now all 7 load concurrently + each has a 3s timeout so
  // a single slow query can't tank the whole chat.
  //
  // Any block that fails, times out, or returns empty just doesn't
  // append — the chat always streams.
  const withTimeout = <T>(p: Promise<T>, ms = 3000, fallback: T): Promise<T> =>
    Promise.race([
      p,
      new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
    ]).catch(() => fallback);

  let addendum = "";
  let contextBlocksFired: ContextBlocksFired = { ...EMPTY_FIRED };
  let finalContextMemories: string | null = null;
  let recalledHits: any[] = [];
  let detectedContradictions: any[] = [];

  try {
    const [
      recallMod, skillsMod, identityMod, ghostMod,
      qualMod, beliefsMod, nudgeMod, concernsMod, anticipatedMod, physicalMod,
      conversationMemoryMod,
      contextualRecallMod,
      predictivePrefetchMod,
      memoryRecallMod,
      truthGroundingMod,
      contradictionInjectorMod,
      strategicFrameworksMod,
      anticipatoryRecallMod,
      greeneMatcherMod,
      darkPsychMatcherMod,
    ] = await Promise.all([
      import("@/lib/brain/chat-recall").catch(() => null),
      import("@/lib/brain/skill-extractor").catch(() => null),
      import("@/lib/brain/identity-snapshot").catch(() => null),
      import("@/lib/brain/ghost-nick").catch(() => null),
      import("@/lib/brain/qualitative-identity").catch(() => null),
      import("@/lib/brain/belief-harvester").catch(() => null),
      import("@/lib/brain/cross-system-nudge").catch(() => null),
      // v10.0.529.106 · Wave 62 · cross-session concerns aggregate
      // surfaces Nour's open threads from past sessions so Nick
      // opens with full continuity.
      import("@/lib/brain/session-distiller").catch(() => null),
      // 2026-06-10 · anticipated-question match — when the turn cosine-
      // matches a question the nightly cron predicted, the precomputed
      // take rides in as warm context (never short-circuits the reply).
      import("@/lib/brain/anticipated-questions").catch(() => null),
      import("@/lib/brain/physical-business").catch(() => null),
      
      // Newly moved context mods
      import("@/lib/brain/conversation-memory").catch(() => null),
      import("@/lib/brain/contextual-recall").catch(() => null),
      import("@/lib/ai/predictive-prefetch").catch(() => null),
      import("@/lib/brain/memory-recall").catch(() => null),
      import("@/lib/ai/chat/truth-grounding").catch(() => null),
      import("@/lib/brain/contradiction-injector").catch(() => null),
      import("@/lib/ai/strategic-frameworks").catch(() => null),
      import("@/lib/brain/anticipatory-recall").catch(() => null),
      // AG-14 · Greene + dark-psych trigger matchers — deterministic
      // sub-ms keyword matchers over the BrainMemory corpora, previously
      // wired ONLY into the reasoning engine's draft step (normal chat
      // reached Greene via just 2 capped vector hits).
      import("@/lib/ai/greene-message-matcher").catch(() => null),
      import("@/lib/ai/dark-psychology-matcher").catch(() => null),
    ]);

    const [
      recallBlock, skillsBlock, identityBlock, ghostBlock,
      qBlock, bBlock, nBlock, concernsBlock, anticipatedBlock, physicalBlock,
      threadContext,
      contextMemories,
      prefetchResults,
      hybridRecallReport,
      groundingBlock,
      contradictionHit,
      strategicLensBlock,
      greeneBlock,
      darkPsychBlock,
    ] = await Promise.all([
      userContent.length > 10 && recallMod
        ? withTimeout(recallMod.buildChatRecallBlock(userContent, mode === "deep" ? 6 : 4), 3000, "")
        : Promise.resolve(""),
      skillsMod
        ? withTimeout(skillsMod.buildSkillsContextBlock(userContent), 3000, "")
        : Promise.resolve(""),
      identityMod
        ? withTimeout(identityMod.buildIdentityContextBlock(), 3000, "")
        : Promise.resolve(""),
      ghostMod
        ? withTimeout(ghostMod.buildGhostContextBlock(), 3000, "")
        : Promise.resolve(""),
      qualMod
        ? withTimeout(qualMod.buildQualitativeContextBlock(), 3000, "")
        : Promise.resolve(""),
      beliefsMod
        ? withTimeout(beliefsMod.buildBeliefsContextBlock(), 3000, "")
        : Promise.resolve(""),
      nudgeMod
        ? withTimeout(nudgeMod.buildNudgeContextBlock(), 3000, "")
        : Promise.resolve(""),
      concernsMod
        ? withTimeout(concernsMod.buildConcernsContextBlock(), 3000, "")
        : Promise.resolve(""),
      // Reuses the prefetch userEmbedding — zero extra embedding calls
      // on the hot path. Same length gate as recall: short greetings
      // can't meaningfully cosine-match a predicted question.
      userContent.length > 10 && anticipatedMod
        ? withTimeout(
            anticipatedMod.buildAnticipatedContextBlock(userContent, userEmbedding),
            3000,
            "",
          )
        : Promise.resolve(""),
      physicalMod
        ? withTimeout(physicalMod.buildPhysicalBusinessContextBlock(), 3000, "")
        : Promise.resolve(""),
      
      // Newly moved fetchers
      // 2026-07-04 (audit) · these six were awaited with bare .catch()
      // — the module's 3s-timeout contract (header above) didn't cover
      // them, so one slow Neon trip (or the LLM call below) meant
      // unbounded blocking BEFORE the stream opens. Now wrapped like
      // the first ten blocks. Pinned by tests/ai/brain-context-timeouts.
      (userContent.length > 10 || forceRecall) && conversationMemoryMod
        ? withTimeout(conversationMemoryMod.detectCrossSessionThread(userContent), 3000, null)
        : Promise.resolve(null),
      (userContent.length > 10 || forceRecall) && contextualRecallMod
        ? withTimeout(contextualRecallMod.getContextualMemories([userContent], mode === "deep" ? 10 : 5), 3000, null)
        : Promise.resolve(null),
      (userContent.length > 10 || forceRecall) && predictivePrefetchMod
        ? withTimeout(predictivePrefetchMod.prefetchIntents(userContent), 3000, [])
        : Promise.resolve([]),
      userContent.length > 10 && memoryRecallMod && userEmbedding.length > 0
        ? withTimeout(memoryRecallMod.recallMemoriesForQuery(userContent, { embedding: userEmbedding, limit: mode === "deep" ? 8 : 5 }), 3000, null)
        : Promise.resolve(null),
      truthGroundingMod
        ? withTimeout(truthGroundingMod.buildTruthGroundingBlock(messages as never), 3000, null)
        : Promise.resolve(null),
      contradictionInjectorMod
        ? withTimeout(contradictionInjectorMod.findRelevantContradictions({ userMessage: userContent, conversationId: convId }), 3000, null)
        : Promise.resolve(null),
      strategicFrameworksMod
        ? Promise.resolve(strategicFrameworksMod.composeStrategicLensBlock(userContent))
        : Promise.resolve(null),
      // AG-14 · both matchers self-gate (minScore 2 → "" on casual turns)
      // and their blocks stay NON-critical so the reranker can drop them
      // on low similarity — prompt-budget guard per the plan.
      userContent.length > 10 && greeneMatcherMod
        ? withTimeout(
            greeneMatcherMod
              .pickContextualLawsForMessage(userContent)
              .then((picks) => greeneMatcherMod.renderGreeneBlock(picks)),
            3000,
            "",
          )
        : Promise.resolve(""),
      userContent.length > 10 && darkPsychMatcherMod
        ? withTimeout(
            darkPsychMatcherMod
              .pickDarkPsychologyForMessage(userContent)
              .then((picks) => darkPsychMatcherMod.renderDarkPsychologyBlock(picks)),
            3000,
            "",
          )
        : Promise.resolve(""),
    ]);

    // 2026-07-04 (audit) · anticipateMemories is an LLM call awaited
    // SERIALLY after the parallel batch — the single biggest unbounded
    // stream-open delay in the module. Bounded to the same 3s.
    const anticipatoryBlock = anticipatoryRecallMod && contextMemories
      ? await withTimeout(anticipatoryRecallMod.anticipateMemories(messages as never, contextMemories), 3000, null)
      : null;
    
    if (strategicLensBlock && strategicFrameworksMod) {
      import("@/lib/ai/strategic-frameworks/record-lens-fire").then(({ recordLensFire }) => {
        const matches = strategicFrameworksMod.pickFrameworks(userContent);
        recordLensFire({ surface: "chat", matches, lensBlockLength: strategicLensBlock.length });
      }).catch(() => {});
    }

    const contradictionAlertBlock = contradictionHit && contradictionInjectorMod
      ? contradictionInjectorMod.buildContradictionAlertBlock(contradictionHit)
      : null;

    const hybridRecallBlock = hybridRecallReport && memoryRecallMod
      ? memoryRecallMod.formatRecallForPrompt(hybridRecallReport.hits)
      : null;

    // Apr 19 · Task queue injection. Runs in the same promise race
    // (started at taskContextPromise above), so it's free time-wise.
    const taskBlock = await withTimeout(taskContextPromise, 3000, "");

    // Apr 19 · Rerank brain blocks by semantic relevance to the user
    // turn. Reorders so the sharpest blocks sit closest to the
    // conversation (models weight late-prompt heavier). Drops blocks
    // below the similarity threshold to save context window.
    //
    // We pass the already-computed userEmbedding from the parallel
    // prefetch — zero extra embedding calls. Reranker has its own
    // graceful fallback (returns blocks as-is) when embedding fails.
    const rawBlocks = [
      { name: "recall", content: recallBlock },
      { name: "skills", content: skillsBlock },
      { name: "identity", content: identityBlock },
      { name: "ghost", content: ghostBlock },
      { name: "qualitative", content: qBlock },
      { name: "beliefs", content: bBlock },
      { name: "nudges", content: nBlock },
      { name: "concerns", content: concernsBlock },
      { name: "anticipated", content: anticipatedBlock },
      { name: "physical", content: physicalBlock },
      { name: "tasks", content: taskBlock },
      { name: "Cross-Session Thread", content: threadContext ? `# CROSS-SESSION THREAD\n${threadContext.slice(0, 1000)}` : "", critical: true },
      { name: "Context Memories", content: contextMemories ? `# CONTEXT MEMORIES\n${contextMemories.slice(0, mode === "deep" ? 2000 : 1000)}` : "", critical: true },
      { name: "Anticipated Memories", content: anticipatoryBlock || "" },
      { name: "Hybrid Recall", content: hybridRecallBlock ? `# ${hybridRecallBlock}` : "" },
      { name: "Truth Grounding", content: groundingBlock || "", critical: true },
      { name: "Contradiction Alert", content: contradictionAlertBlock || "", critical: true },
      { name: "Strategic Lens", content: strategicLensBlock || "", critical: true },
      { name: "Greene Strategy Frame", content: greeneBlock || "" },
      { name: "Dark Psychology Frame", content: darkPsychBlock || "" },
      { name: "Predictive Prefetch", content: prefetchResults?.length ? formatPrefetchContext(prefetchResults as PrefetchResult[]) || "" : "", critical: true }
    ].filter((b) => b.content && b.content.trim().length > 0);

    let reranked: Awaited<ReturnType<typeof rerankContextBlocks>> = rawBlocks.map((b) => ({
      name: b.name,
      content: b.content,
      similarity: 0,
      kept: true,
      critical: b.critical,
    }));
    if (userEmbedding.length > 0 && rawBlocks.length > 1) {
      try {
        reranked = await rerankContextBlocks(userEmbedding, rawBlocks, {
          dropThreshold: 0.12,
        });
        log.info("rerank_applied", { summary: formatRerankSummary(reranked) });
      } catch (rerankErr) {
        log.warn("rerank_failed_using_raw_order", {
          err: rerankErr instanceof Error ? rerankErr.message : String(rerankErr),
        });
      }
    }

    // Append blocks in reranked order, skipping dropped ones.
    for (const block of reranked) {
      if (!block.kept) continue;
      addendum += `\n\n${block.content}`;
    }

    // Populate contextBlocksFired for onFinish + headers
    contextBlocksFired = {
      recall: !!recallBlock,
      skills: !!skillsBlock,
      identity: !!identityBlock,
      ghost: !!ghostBlock,
      qualitative: !!qBlock,
      beliefs: !!bBlock,
      nudges: !!nBlock,
      contradictions: !!(nBlock && /contradiction/i.test(nBlock)) || !!contradictionAlertBlock,
      concerns: !!concernsBlock,
      anticipated: !!anticipatedBlock,
      physical: !!physicalBlock,
      hybridRecall: !!hybridRecallBlock,
    };
    
    finalContextMemories = contextMemories;
    if (hybridRecallReport) recalledHits = hybridRecallReport.hits;
    if (contradictionHit) detectedContradictions = [contradictionHit];

    log.info("brain_blocks_assembled", {
      recall: !!recallBlock,
      skills: !!skillsBlock,
      identity: !!identityBlock,
      ghost: !!ghostBlock,
      qualitative: !!qBlock,
      beliefs: !!bBlock,
      nudges: !!nBlock,
      hybridRecall: !!hybridRecallBlock,
    });
  } catch (err) {
    log.warn("brain_blocks_failed", { err: err instanceof Error ? err.message : String(err) });
  }

  // ── Deeper Context telemetry ──
  // `getContextualMemories` appends a "### Deeper Context" section when
  // cross-source semantic recall (brain_dump / reflection / strategic_law
  // / chat_message) surfaces hits. Count them so the UI can show a
  // visibility badge and the onFinish handler can write the count into
  // ChatMessage.tokenUsage for history-aware rendering.
  let deeperContextCount = 0;
  const deeperContextTypes: string[] = [];
  if (finalContextMemories) {
    const deeperIdx = finalContextMemories.indexOf("### Deeper Context");
    if (deeperIdx >= 0) {
      const deeperSection = finalContextMemories.slice(deeperIdx);
      const matches = deeperSection.match(/\[(Strategic Laws|Reflections|Brain Dumps|Past Replies)[^\]]*\]/g) ?? [];
      deeperContextCount = matches.length;
      const typeSet = new Set<string>();
      for (const m of matches) {
        const typeMatch = m.match(/\[(Strategic Laws|Reflections|Brain Dumps|Past Replies)/);
        if (typeMatch) typeSet.add(typeMatch[1]);
      }
      deeperContextTypes.push(...typeSet);
      log.info("deeper_context_pulled", {
        hits: deeperContextCount,
        types: deeperContextTypes,
      });
    }
  }
  
  // Note: Predictive prefetch formatting is already handled up in the rawBlocks assembly,
  // so we don't manually append it again here.

  return {
    systemPromptAddendum: addendum,
    contextBlocksFired,
    deeperContextCount,
    deeperContextTypes,
    recalledHits,
    detectedContradictions,
  };
}
