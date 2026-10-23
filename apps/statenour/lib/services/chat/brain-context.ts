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

import { getFlag } from "@/lib/feature-flags";
import { planQuery, type QueryPlan } from "@/lib/brain/query-plan";
import { buildEvidencePackAsync, extractRecallAddendum, RECALL_MODE_LIMITS, type RerankBackend, type RerankReason } from "@/lib/brain/evidence-pack";
import { computeLaneOverlap, type LaneOverlap } from "@/lib/brain/lane-overlap";
import { rerankContextBlocks, formatRerankSummary } from "@/lib/ai/context-reranker";
import { buildContextReceipt, DEFAULT_CONTEXT_TOKEN_BUDGET, type ContextReceipt } from "@/lib/ai/context-budget";
import { fenceContent, truncateFenced } from "@/lib/ai/tool-result-fencing";
import { formatPrefetchContext } from "@/lib/ai/predictive-prefetch";
import type { PrefetchResult } from "@/lib/ai/predictive-prefetch";
import type { ChatMode } from "@/lib/ai/chat-mode";
import { detectExecuteFinalized } from "@/lib/ai/response-contract";
import { buildRecallFailureNotice } from "@/lib/ai/chat/recall-failure-notice";
import { extractText, type ChatHistoryMessage } from "@/lib/ai/chat/extract-text";
import { TRUTH_GROUNDING_UNAVAILABLE } from "@/lib/ai/chat/truth-grounding";
import { TASK_QUEUE_UNAVAILABLE } from "@/lib/brain/task-context";
import { today } from "@/lib/utils/datetime";
import { randomUUID } from "node:crypto";
import { readMutationLock } from "@/lib/ai/mutation-lock";

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
  /** 2026-10-22 · claim vs record (thinking-engine contradictions table) reached the prompt */
  claimGap: boolean;
  /** 2026-10-23 · the day's one open contradiction question reached the prompt (NICK_DAILY_CONTRADICTION) */
  dailyContradiction: boolean;
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
  /** v6 UIMessages (`parts`) from the route, or legacy `{ role, content }`. */
  messages: ReadonlyArray<ChatHistoryMessage>;
  /** Undefined on a Private Lab turn (see privateMode). */
  convId?: string;
  /**
   * 2026-10-10 (audit 05-M1, 04-F10) · Private Lab: assemble context with
   * ZERO writes. Recall runs read-only (sideEffects:false); lanes that write
   * on read and have no read-only mode (the
   * skill / Greene / dark-psychology fire rows, the lens-fire metric, the
   * contradiction / objection dedupe rows) are skipped; no console line
   * carries the query. convId is ignored.
   */
  privateMode?: boolean;
  /** 2026-10-23 · ephemeral Home command turn (no transcript, placeholder conversation id). */
  ephemeral?: boolean;
  /** 2026-10-23 · the turn's action permission; "read" refuses mutating tools (lib/ai/tools.ts). */
  actionPermission?: "read" | "draft" | "execute" | null;
  /** 2026-10-23 · ai_config.disabledTools: a disabled resolveContradiction turns the contradiction lanes off. */
  disabledTools?: string[];
  /** 2026-07-22 · authority posture ("execute" suppresses the objection
   *  injector + resolves open objections; other values no-op here). */
  posture?: string;
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
  recallProvenance?: "OK" | "ZERO" | "ERROR" | "UNMEASURED";
  recallProvenanceReason?: string;
  /** Wave 0 (2026-09-08) · per-turn overlap between the two recall lanes (lib/brain/lane-overlap.ts). */
  laneOverlap?: LaneOverlap;
  /** Wave 3 (2026-09-08) · the deterministic query plan this turn ran under (lib/brain/query-plan.ts). */
  queryPlan?: QueryPlan;
  /** Wave 2 · when NICK_RECALL_ARBITER is on: how many candidates the two lanes offered and how many survived; W1 adds the rerank backend and the validity drops. */
  evidencePack?: { candidates: number; items: number; reranked: RerankBackend; rerankReason: RerankReason; droppedValidity: number | null };
  /**
   * Wave 3 (2026-09-17) · what the block-assembly stage kept/dropped and why
   * (lib/ai/context-budget.ts). OBSERVABILITY ONLY — does not change
   * `systemPromptAddendum`; see that module's file header.
   */
  contextReceipt?: ContextReceipt;
  /** 2026-10-23 · this turn's day RESERVATION (claim gap or daily question); the persist path promotes it to "asked". */
  contradictionClaim?: import("@/lib/brain/contradiction-injector").ContradictionClaim;
  /** 2026-10-23 · a contradiction question is open (asked this turn, or the follow-up block fired): the pruner keeps resolveContradiction attached. */
  contradictionAskPending?: boolean;
}

const EMPTY_FIRED: ContextBlocksFired = {
  recall: false, skills: false, identity: false, ghost: false,
  qualitative: false, beliefs: false, nudges: false, contradictions: false, claimGap: false, dailyContradiction: false,
  concerns: false, anticipated: false, physical: false,
};

/**
 * Which messages the contextual lane derives its TOPICS from.
 *
 * ONLY the anaphoric referent is ever prepended. A turn with no referent
 * recalls on its own text, full stop.
 *
 * 2026-09-18 · this used to ALSO prepend the last turn whenever the current
 * one derived zero topics. That heuristic was correct when it was written
 * (#2422) and is not any more, so it is deleted rather than special-cased.
 *
 * Its whole justification was that zero topics meant `getFallbackMemories()` —
 * top-N by CONFIDENCE with the query discarded — so borrowing the prior turn's
 * topics beat recalling nothing relevant. #2425 removed that: zero topics plus
 * a query embedding now routes to the semantic and KNN lanes on the user's own
 * message, which is strictly better than borrowing a neighbouring subject.
 *
 * With the justification gone the heuristic was actively harmful, and review
 * (#2433) caught it: "is everything done" is NOT classified anaphoric, yet it
 * derives zero topics, so it was handed the previous turn's topics and those
 * drove the lexical lane, cross-source search and the reranker toward an
 * unrelated subject. Measured: prior turn "what is my rent on the euclid
 * apartment" made that turn search `apartment, euclid, rent`.
 *
 * The bias is the same one every classifier in this path uses: a MISS costs
 * one turn that recalls on its own embedding; a FALSE prepend steers three
 * lanes at the wrong subject. Prefer the miss.
 */
export function buildRecallMessages(
  referent: string | undefined,
  userContent: string,
): string[] {
  return referent ? [referent, userContent] : [userContent];
}

export async function buildBrainContext(
  input: BuildBrainContextInput,
): Promise<BuildBrainContextOutput> {
  const { userContent, mode, userEmbedding, forceRecall, messages, posture, log } = input;
  // PR #3088 CX-2 · one table for the lane and pack sizes; scripts/recall-eval.ts mirrors it.
  const recallLimits = RECALL_MODE_LIMITS[mode === "deep" ? "deep" : "standard"];
  const privateMode = input.privateMode === true;
  // A private turn has no conversation: with an id, the contradiction and
  // objection injectors write per-conversation dedupe rows.
  const convId = privateMode ? undefined : input.convId;
  // The contradiction lanes (claim gap, daily question, follow-up) write a day claim and
  // ask Nour to answer through resolveContradiction. They need a real conversation to
  // answer in (ephemeral Home commands and the route's "private"/"temp" placeholders
  // have none) and a turn that may run that mutating tool (Read refuses it).
  const contradictionConvId = convId && convId !== "private" && convId !== "temp" ? convId : undefined;
  // ...and the resolve tool itself must be offerable: prepare-tools strips an operator-disabled
  // tool, and pruneTools drops a circuit-tripped one (same synchronous breaker read).
  const { isToolBlocked } = await import("@/lib/ai/tool-telemetry").catch(() => ({ isToolBlocked: (_n: string) => false }));
  // The mutation lock too, read exactly as the tool gate reads it (lib/ai/tools.ts authorityGate
  // refuses writes when it is on, or unreadable).
  const resolverAvailable =
    !(input.disabledTools ?? []).includes("resolveContradiction") &&
    !isToolBlocked("resolveContradiction") &&
    readMutationLock() === "off";
  const contradictionLanesOk =
    !privateMode && input.ephemeral !== true && input.actionPermission !== "read" && !!contradictionConvId && resolverAvailable;
  let contradictionClaim: import("@/lib/brain/contradiction-injector").ContradictionClaim | undefined;
  let contradictionAskPending = false;
  // Authority posture (self-review #8): explicit "execute" pill suppresses the
  // objection injector this turn — same as the phrase detector. Explicit "spar"
  // / "counsel" mean the user WANTS engagement, so they override a phrase-
  // detected finality (only "auto"/absent falls back to the phrase).
  const isAutoPosture = !posture || posture === "auto";
  const executePosture =
    posture === "execute" || (isAutoPosture && detectExecuteFinalized(userContent));

  // Apr 19 · Task context injection — fires in parallel with the
  // brain blocks below. Surfaces the live DOING/READY queue so Nick
  // always knows what Nour is carrying without being told. See
  // lib/brain/task-context.ts for the shape.
  // The module failing to load is the same failure as the query failing:
  // no queue reached the prompt, and silence here reads as "nothing in
  // progress". Declared, not swallowed.
  const taskContextPromise = import("@/lib/brain/task-context")
    .then((m) => m.buildTaskContextBlock())
    .catch(() => TASK_QUEUE_UNAVAILABLE);

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

  // Brain W3 · Socratic decision mode (lib/brain/decision-forecast.ts): ask for
  // the decision, alternatives, probability and review date, then store the
  // answer. Started now so its DB read overlaps the blocks below; a Private Lab
  // turn has no convId, so it neither asks nor writes.
  const decisionTurnPromise = withTimeout<Awaited<ReturnType<typeof import("@/lib/brain/decision-forecast").runDecisionTurn>> | null | "timeout">(
    import("@/lib/brain/decision-forecast")
      .then((m) => m.runDecisionTurn({ convId, userContent, messages }))
      .catch(() => null),
    3000,
    "timeout",
  );

  let addendum = "";
  let contextBlocksFired: ContextBlocksFired = { ...EMPTY_FIRED };
  let finalContextMemories: string | null = null;
  let recalledHits: any[] = [];
  // Provenance for recalledHits. "ZERO" is a measured empty; "ERROR" and
  // "UNMEASURED" mean the count is not a fact about memory at all.
  let recallProvenance: "OK" | "ZERO" | "ERROR" | "UNMEASURED" = "UNMEASURED";
  let recallProvenanceReason: string | undefined;
  let contextualRankedIds: string[] = [];
  let contextualRankedRows: import("@/lib/brain/contextual-recall").RankedRecallRow[] = [];
  let laneOverlap: LaneOverlap | undefined;
  let evidencePack: { candidates: number; items: number; reranked: RerankBackend; rerankReason: RerankReason; droppedValidity: number | null } | undefined;
  let contextReceipt: ContextReceipt | undefined;
  const arbiterOn = getFlag("NICK_RECALL_ARBITER")?.isOn ?? false;
  const claimGapOn = getFlag("NICK_CLAIM_GAP")?.isOn ?? false;
  const dailyContradictionOn = getFlag("NICK_DAILY_CONTRADICTION")?.isOn ?? false;
  // Wave 3 · deterministic query plan: no LLM, the original query is always a lane; asOf below.
  //
  // 2026-09-17 · `recentTurns` must be the turns BEFORE this one. query-plan.ts
  // sets `referent = recentTurns[last]` and its own test feeds the PRIOR turn
  // ("We discussed moving the shop's Instagram cadence...") while the message
  // under test is the follow-up. But `messages` is the AI-SDK history, which
  // ENDS with the current user turn — so the last element was `userContent`
  // itself and every anaphoric referent resolved to the question instead of
  // what the pronoun points at. Harmless while referent had no consumer; it
  // gained one in this commit, so the feed is corrected first. Defensive by
  // design: the pop only fires when the tail really is the current turn, so a
  // caller that already passes prior-only history is unaffected.
  // slice FIRST, deliberately: the original bounded how far back a referent
  // could come from, and that bound is correct -- a pronoun refers to the
  // turn just spoken, not to turn 50. Taking 5 leaves up to 4 once the
  // current turn is dropped, preserving the original window.
  const __priorTurns = messages
    .slice(-5)
    .map((m) => extractText(m))
    .filter(Boolean);
  if (__priorTurns[__priorTurns.length - 1] === userContent) __priorTurns.pop();
  const queryPlan = planQuery(userContent, { recentTurns: __priorTurns.slice(-4) });

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
      skillRegistryRecallMod,
      objectionInjectorMod,
      tacticianMod,
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
      // AG-17 · registry skill recall (lib/skills/ — the 1.4K-skill
      // semantic index, NOT lib/brain/skill-extractor's learned
      // behavioral skills above). Auto-injection died in the Prompt V2
      // cutover (PR #432) — this restores it and its
      // skill.recall.injected telemetry (ADR-0007 open item).
      import("@/lib/skills/skill-context").catch(() => null),
      // AG-30 · unaddressed adversarial objections re-enter context
      // (mirrors the contradiction injector directly above).
      import("@/lib/brain/objection-injector").catch(() => null),
      // AG-31 · tactician next-move composer (self-gating on tactical
      // intent; /battle prefix relaxes thresholds).
      import("@/lib/ai/tactician/next-move").catch(() => null),
    ]);

    // 2026-07-22 · finality resolution. Fire on the explicit finalizing PHRASE
    // only ("just do it", "stop arguing", …) — NOT the sticky EXECUTE pill,
    // which would soft-delete this conversation's open objections on every turn
    // and lose them permanently if the operator later switches back (self-review
    // #8). Marks OPEN objections resolved so the injector can't re-raise them on
    // a later matching turn. Fire-and-forget; a fresh recommendation earns a new one.
    if (convId && detectExecuteFinalized(userContent)) {
      void objectionInjectorMod?.resolveConversationObjections(convId).catch(() => {});
    }

    const [
      recallBlock, skillsBlock, identityBlock, ghostBlock,
      qBlock, bBlock, nBlock, concernsBlock, anticipatedBlock, physicalBlock,
      threadContext,
      contextMemories,
      prefetchResults,
      hybridRecallReport,
      groundingBlock,
      claimGapHit,
      dailyContradictionHit,
      contradictionFollowUpHit,
      strategicLensBlock,
      greeneBlock,
      darkPsychBlock,
      skillRegistryBlock,
      objectionHit,
      nextMoveBlock,
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
      // 2026-08-27 · retrieval baseline F2+F4: this call ran with NO opts, so
      // (a) the Wave-81 queryEmbedding pass-through was never wired — an extra
      // embedding round-trip inside this 3s race — and (b) the pipeline opened
      // with a blocking LLM topic-extraction measured at p50 4,183ms in prod
      // agent_traces, which lost the whole block to the timeout on the median
      // turn. fastTopics keeps the chat hot path deterministic and in-budget;
      // non-chat callers keep the LLM path.
      // 2026-09-17 · queryPlan.referent (anaphoric_followup: "what about
      // that?", "is it still true?") was computed and never consumed --
      // third dark wire in this file, same shape exactTerms had until
      // 2026-09-15 and the correction class had until this PR. A short
      // pronoun-only follow-up carries near-zero semantic signal alone;
      // deriveFastTopics(recentMessages) walks the array BACKWARDS and lets
      // the LAST element's terms win the 8-topic cap, so the referent goes
      // FIRST -- it adds vocabulary from the turn the pronoun points at
      // without displacing userContent's own priority. The embedding lane is
      // unchanged (queryEmbedding stays userEmbedding): recomputing it would
      // add a round-trip to the 3s hot-path budget for a rare query class.
      // NOTE: this comment sits ABOVE withTimeout( on purpose --
      // tests/ai/brain-context-timeouts.test.ts pins the fetcher within 120
      // chars of its wrapper, and a comment block between them fails it.
      // Private Lab runs this lane read-only (sideEffects:false skips the
      // wisdom lastSeen/recallCount bump, its only write; 2026-10-10).
      (userContent.length > 10 || forceRecall) && contextualRecallMod
        ? withTimeout(
            contextualRecallMod.getContextualMemories(
              buildRecallMessages(queryPlan.referent, userContent),
              recallLimits.contextual,
              {
                queryEmbedding: userEmbedding.length > 0 ? userEmbedding : undefined,
                fastTopics: true,
                asOf: queryPlan.asOf,
                sideEffects: !privateMode,
                onRanked: (rows: import("@/lib/brain/contextual-recall").RankedRecallRow[]) => {
                  contextualRankedIds = rows.map((r) => r.id);
                  contextualRankedRows = rows;
                },
              },
            ),
            3000,
            null,
          )
        : Promise.resolve(null),
      (userContent.length > 10 || forceRecall) && predictivePrefetchMod
        ? withTimeout(predictivePrefetchMod.prefetchIntents(userContent), 3000, [])
        : Promise.resolve([]),
      // 2026-09-10 · EMPTY vs ERROR vs UNMEASURED.
      //
      // This lane feeds the "REMEMBERED -- WHAT NICK BELIEVES (N)"
      // counter in the Memory Inspector, and it had FOUR ways to render
      // "(0)" that the operator could not tell apart:
      //   a) the embedding came back [] (embedUserMessage fail-softs on
      //      a 12s timeout), so the guard below skipped the lane whole;
      //   b) withTimeout's 3s budget expired;
      //   c) recallMemoriesForQuery threw;
      //   d) the search really ran and matched nothing.
      // Only (d) is an empty memory. (a)-(c) are a broken instrument,
      // and the 2026-09-10 audit read one of them as "Nick remembers
      // nothing about me".
      //
      // Note the asymmetry with the three sibling lanes above: they all
      // accept `|| forceRecall`, this one does not -- so an embedding
      // blip silently zeroes the ONE lane the panel counts. That is the
      // turn-to-turn inconsistency the audit observed.
      //
      // 2026-09-15 · queryPlan.exactTerms was computed and logged on every
      // turn but consumed by nothing (a dark wire). It now drives the
      // exact-identifier lane inside recallMemoriesForQuery. (The call must
      // stay within 120 chars of withTimeout( for the timeout-contract pin.)
      userContent.length > 10 && memoryRecallMod && userEmbedding.length > 0
        ? withTimeout(
            memoryRecallMod.recallMemoriesForQuery(userContent, { embedding: userEmbedding, limit: recallLimits.memoryRecall, exactTerms: queryPlan.exactTerms, sideEffects: !privateMode }),
            3000,
            // withTimeout cannot distinguish a rejection from an expiry;
            // both are a FAILED read, so both must say so.
            { hits: [], provenance: "ERROR", provenanceReason: "hybrid recall timed out or threw (3s budget)" } as never,
          )
        : Promise.resolve(
            ({
              hits: [],
              provenance: userEmbedding.length === 0 && userContent.length > 10 ? "ERROR" : "UNMEASURED",
              provenanceReason:
                !memoryRecallMod
                  ? "memory-recall module unavailable -- lane not attempted"
                  : userEmbedding.length === 0 && userContent.length > 10
                    ? "query embedding unavailable -- hybrid recall lane skipped entirely"
                    : "query under 10 chars -- hybrid recall lane not attempted",
            } as never),
          ),
      // 2026-09-10 · the TIMEOUT is the fourth way grounding can vanish.
      // buildTruthGroundingBlock now distinguishes "nothing to ground"
      // from "the lookup threw", but a 3s timeout bypasses that entirely
      // and used to fall back to null -- no block, no explanation, and
      // L4's protection silently gone on exactly the slow-database turns
      // where a task count is most likely to be stale in the model's
      // head. Fall back to the same declaration the module makes for
      // itself rather than to silence.
      truthGroundingMod
        ? withTimeout(
            truthGroundingMod.buildTruthGroundingBlock(messages as never),
            3000,
            TRUTH_GROUNDING_UNAVAILABLE,
          )
        : Promise.resolve(null),
      // 2026-10-22 · claim vs record: the thinking engine's open contradictions TABLE rows,
      // which nothing read. Read-only here; the day is claimed below, only for a hit this turn uses.
      // A private turn skips it (the claim is a write).
      userContent.length > 10 && contradictionInjectorMod && claimGapOn && contradictionLanesOk
        ? withTimeout(contradictionInjectorMod.findRelevantClaimGap({ userMessage: userContent }), 3000, null)
        : Promise.resolve(null),
      // 2026-10-23 · the day's one open contradiction (read-only; claimed below only when no
      // claim gap is shown this turn). A private turn skips it (the claim is a write).
      contradictionInjectorMod && dailyContradictionOn && contradictionLanesOk
        ? withTimeout(contradictionInjectorMod.findDailyContradiction(), 1500, null)
        : Promise.resolve(null),
      // The row asked earlier today in this conversation stays answerable (its key and the
      // resolve instructions) until it is resolved or the day ends. Read-only.
      contradictionInjectorMod && (claimGapOn || dailyContradictionOn) && contradictionLanesOk
        ? withTimeout(contradictionInjectorMod.findClaimedContradictionFollowUp(contradictionConvId), 1500, null)
        : Promise.resolve(null),
      strategicFrameworksMod
        ? Promise.resolve(strategicFrameworksMod.composeStrategicLensBlock(userContent))
        : Promise.resolve(null),
      // AG-14 · both matchers self-gate (minScore 2 → "" on casual turns)
      // and their blocks stay NON-critical so the reranker can drop them
      // on low similarity — prompt-budget guard per the plan.
      // AG-31 · the precomputed userEmbedding rides along so the matcher's
      // vector fallback can catch paraphrases when triggers miss.
      // Private Lab: the Greene / dark-psychology / skill-registry lanes each
      // record a fire row on read, so a private turn skips them.
      userContent.length > 10 && greeneMatcherMod && !privateMode
        ? withTimeout(
            greeneMatcherMod
              .pickContextualLawsForMessage(userContent, {
                userEmbedding: userEmbedding.length > 0 ? userEmbedding : undefined,
              })
              .then((picks) => greeneMatcherMod.renderGreeneBlock(picks)),
            3000,
            "",
          )
        : Promise.resolve(""),
      userContent.length > 10 && darkPsychMatcherMod && !privateMode
        ? withTimeout(
            darkPsychMatcherMod
              .pickDarkPsychologyForMessage(userContent)
              .then((picks) => darkPsychMatcherMod.renderDarkPsychologyBlock(picks)),
            3000,
            "",
          )
        : Promise.resolve(""),
      // AG-17 · fails closed ("" on any error) + 60s per-message cache
      // inside skill-context; ~450 tokens/turn worst case (top-3 skills).
      userContent.length > 10 && skillRegistryRecallMod && !privateMode
        ? withTimeout(skillRegistryRecallMod.getRelevantSkillsBlock(userContent), 3000, "")
        : Promise.resolve(""),
      // AG-30 · once-per-conversation, 24h lookback, severity≥2+flaw only.
      // 2026-07-22 · execute/finalized posture ("do it" / "my decision is final" /
      // "stop arguing") suppresses re-surfacing a prior counter-view — don't
      // re-open a decision the operator has explicitly closed.
      objectionInjectorMod && convId && !executePosture
        ? withTimeout(objectionInjectorMod.findRelevantObjections({ conversationId: convId }), 3000, null)
        : Promise.resolve(null),
      // AG-31 · self-gates on TACTICIAN_INTENT; /battle relaxes thresholds.
      userContent.length > 10 && tacticianMod
        ? withTimeout(
            tacticianMod.buildNextMoveBlock(userContent, { relaxed: /^\/battle\b/i.test(userContent) }),
            3000,
            "",
          )
        : Promise.resolve(""),
    ]);

    // 2026-07-04 (audit) · anticipateMemories is an LLM call awaited
    // SERIALLY after the parallel batch — the single biggest unbounded
    // stream-open delay in the module. Bounded to the same 3s.
    const anticipatoryBlock = anticipatoryRecallMod && contextMemories
      ? await withTimeout(anticipatoryRecallMod.anticipateMemories(messages, contextMemories), 3000, null)
      : null;
    
    // The lens block still renders on a private turn; only its metric row is skipped.
    if (strategicLensBlock && strategicFrameworksMod && !privateMode) {
      import("@/lib/ai/strategic-frameworks/record-lens-fire").then(({ recordLensFire }) => {
        const matches = strategicFrameworksMod.pickFrameworks(userContent);
        recordLensFire({ surface: "chat", matches, lensBlockLength: strategicLensBlock.length });
      }).catch(() => {});
    }

    // RESERVE the day's single contradiction slot; a failed or slow reservation shows nothing.
    // It becomes the "asked" receipt only after the reply is persisted (persist-assistant-turn.ts
    // markContradictionAsked); a late or never-promoted reservation frees the day after 10 min.
    // One ET day for the reservation AND the key handed to the persist path, even across midnight.
    const claimDay = today();
    // This turn's reservation id: the persist path promotes only the reservation it made.
    const claimToken = randomUUID();
    const claimGapBlock = claimGapHit && contradictionInjectorMod
      && (await withTimeout(contradictionInjectorMod.claimClaimGapDay(claimGapHit, contradictionConvId, claimDay, claimToken), 1500, false))
      ? contradictionInjectorMod.buildClaimGapBlock(claimGapHit)
      : null;
    // One contradiction question a turn: the daily question only when the claim gap does not
    // already end this reply with a question.
    const dailyContradictionBlock = !claimGapBlock && dailyContradictionHit && contradictionInjectorMod
      && (await withTimeout(contradictionInjectorMod.claimDailyContradiction(dailyContradictionHit, contradictionConvId, claimDay, claimToken), 1500, false))
      ? contradictionInjectorMod.buildDailyContradictionBlock(dailyContradictionHit)
      : null;
    if (contradictionInjectorMod && (claimGapBlock || dailyContradictionBlock)) {
      contradictionClaim = {
        key: contradictionInjectorMod.claimKey(claimDay),
        contradictionId: claimGapBlock ? claimGapHit!.id : dailyContradictionHit!.id,
        kind: claimGapBlock ? "match" : "daily",
        token: claimToken,
      };
    }
    const contradictionFollowUpBlock = contradictionFollowUpHit && contradictionInjectorMod
      ? contradictionInjectorMod.buildContradictionFollowUpBlock(contradictionFollowUpHit)
      : null;
    contradictionAskPending = !!(claimGapBlock || dailyContradictionBlock || contradictionFollowUpBlock);

    const hybridRecallBlock = hybridRecallReport && memoryRecallMod
      ? memoryRecallMod.formatRecallForPrompt(hybridRecallReport.hits)
      : null;

    // Apr 19 · Task queue injection. Runs in the same promise race
    // (started at taskContextPromise above), so it's free time-wise.
    // A timed-out read is the same failure as a thrown one: never an empty queue (08-F6d).
    const taskBlock = await withTimeout(taskContextPromise, 3000, TASK_QUEUE_UNAVAILABLE);

    // Apr 19 · Rerank brain blocks by semantic relevance to the user
    // turn. Sorts similarity DESCENDING and the append loop below keeps
    // that order, so the sharpest block OPENS the addendum. Drops blocks
    // below the similarity threshold to save context window.
    //
    // 2026-08-06 · The descending sort is INTENTIONAL — do NOT "fix" it
    // to ascending. This comment used to claim the rerank puts the
    // sharpest blocks "closest to the conversation (models weight
    // late-prompt heavier)", the exact opposite of what the code does,
    // and an audit nearly flipped the sort to match the prose. Where the
    // addendum actually lands: route.ts appends it to the TAIL of the
    // base system prompt, then finalize-system-prompt and
    // augment-final-prompt append more after it — proximity to the
    // conversation was never this loop's to set. What it does set is the
    // HEAD of the addendum, which is the placement context-reranker.ts is
    // built around. Ascending would invert that with every test green.
    //
    // We pass the already-computed userEmbedding from the parallel
    // prefetch — zero extra embedding calls. Reranker has its own
    // graceful fallback (returns blocks as-is) when embedding fails.
    let evidencePackBlock = "";
    if (arbiterOn) {
      // W1 (2026-10-16) · validity filter + ONE rerank over the fused window
      // (the rerank call is bounded inside; the lanes already ran under their
      // own 3s races, so this is not wrapped in withTimeout again).
      // Same referent-aware text the contextual lane reranks with (round 1 P2-5).
      const packQuery = buildRecallMessages(queryPlan.referent, userContent).join("\n");
      const pack = await buildEvidencePackAsync((hybridRecallReport?.hits ?? []) as never[], contextualRankedRows, {
        limit: recallLimits.pack,
        query: packQuery,
        asOf: queryPlan.asOf,
      });
      evidencePackBlock = pack.block;
      evidencePack = { candidates: pack.candidates, items: pack.items.length, reranked: pack.reranked, rerankReason: pack.rerankReason, droppedValidity: pack.droppedValidity };
      console.info("[brain-context] evidence_pack", JSON.stringify({
        candidates: pack.candidates,
        items: pack.items.length,
        reranked: pack.reranked,
        rerank_reason: pack.rerankReason,
        // null = no candidate carried a validity column: UNMEASURED, never a clean 0.
        dropped_validity: pack.droppedValidity ?? "unmeasured",
      }));
    }
    // The receipt says arbiter only when a pack actually reached the prompt; a flag-on turn whose
    // pack was empty (lane timeouts, no hits) falls through to the two-lane render below (P2-3).
    const arbiterUsed = arbiterOn && evidencePackBlock.length > 0;
    const recallAddendumOnly = arbiterOn && contextMemories ? extractRecallAddendum(contextMemories) : "";
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
      // PR #2060 review (P1) · the recall block is fenced as memory_recall by
      // its builder. Slicing through truncateFenced keeps the closing tag, so
      // a long block cannot leave the rest of this addendum inside an
      // unterminated untrusted region.
      //
      // Hostile review 2026-09-02 · the cross-session thread block was NOT
      // fenced: the cross-session builder (conversation-memory.ts) returns
      // plain LLM-synthesized text
      // digested from prior conversations, which can echo pasted external
      // content or stale instructions. Fence it as cross_session here (the
      // rule already teaches that fence: continuity, never a fresh
      // instruction), THEN slice through truncateFenced. maxChars is lifted on
      // the fence because the slice below is the real budget.
      { name: "Cross-Session Thread", content: threadContext ? `# CROSS-SESSION THREAD\n${truncateFenced(fenceContent("crossSessionThread", "cross_session", threadContext, { maxChars: 20_000 }), 1000)}` : "", critical: true },
      // Wave 2 (2026-09-08) · NICK_RECALL_ARBITER: one evidence pack across both lanes replaces the
      // two overlapping memory LISTS below; off = byte-identical to before (the lanes render separately).
      // W1 (2026-10-16) · the contextual lane's graph / cross-source / related lines live only inside
      // its rendered block, so the pack is ADDED beside a reduced Context Memories block that keeps
      // exactly those sections (extractRecallAddendum) instead of deleting them with the list.
      ...(arbiterOn && evidencePackBlock
        ? [
            { name: "Evidence Pack", content: `# EVIDENCE PACK\n${evidencePackBlock}`, critical: true },
            { name: "Context Memories", content: recallAddendumOnly ? `# CONTEXT MEMORIES\n${truncateFenced(recallAddendumOnly, mode === "deep" ? 2000 : 1000)}` : "", critical: true },
          ]
        : [
            { name: "Context Memories", content: contextMemories ? `# CONTEXT MEMORIES\n${truncateFenced(contextMemories, mode === "deep" ? 2000 : 1000)}` : "", critical: true },
            // 2026-09-10 · marked CRITICAL. This is the one block the
            // Memory Inspector counts ("REMEMBERED -- WHAT NICK BELIEVES
            // (N)"), and while non-critical the 0.12 reranker cutoff
            // (RERANK_DROP below) could drop it from the prompt EVEN WHEN
            // HITS EXIST -- so the panel truthfully reported memories the
            // model never saw. That is a second, quieter failure than the
            // "(0)" the 2026-09-10 audit caught, and it reads to the
            // operator exactly the same way: Nick ignoring what he knows.
            // The other recall-bearing blocks (Evidence Pack, Context
            // Memories, Truth Grounding) were already critical; this one
            // being the odd exception was the defect.
            { name: "Hybrid Recall", content: hybridRecallBlock ? `# ${hybridRecallBlock}` : "", critical: true },
          ]),
      // NOTE · the Recall State notice used to be assembled here. It is
      // now emitted from the FINAL provenance after this try/catch --
      // see the block below `brain_blocks_failed`. Assembling it here
      // covered only the path where assembly succeeded, which is the one
      // path that is NOT a failed read.
      { name: "Anticipated Memories", content: anticipatoryBlock || "" },
      { name: "Truth Grounding", content: groundingBlock || "", critical: true },
      { name: "Claim vs Record", content: claimGapBlock || "", critical: true },
      { name: "One Open Contradiction", content: dailyContradictionBlock || "", critical: true },
      { name: "Contradiction Asked Earlier", content: contradictionFollowUpBlock || "", critical: true },
      { name: "Strategic Lens", content: strategicLensBlock || "", critical: true },
      { name: "Greene Strategy Frame", content: greeneBlock || "" },
      { name: "Dark Psychology Frame", content: darkPsychBlock || "" },
      { name: "Skill Registry Recall", content: skillRegistryBlock || "" },
      { name: "Open Counter-View", content: objectionHit && objectionInjectorMod ? objectionInjectorMod.buildObjectionBlock(objectionHit) : "" },
      { name: "Next Move", content: nextMoveBlock || "" },
      { name: "Predictive Prefetch", content: prefetchResults?.length ? formatPrefetchContext(prefetchResults as PrefetchResult[]) || "" : "", critical: true }
    ].filter((b) => b.content && b.content.trim().length > 0);

    const rawOrder: Awaited<ReturnType<typeof rerankContextBlocks>> = rawBlocks.map((b) => ({
      name: b.name,
      content: b.content,
      similarity: 0,
      kept: true,
      critical: b.critical,
    }));
    let reranked = rawOrder;
    if (userEmbedding.length > 0 && rawBlocks.length > 1) {
      try {
        // 2026-08-09 · Bounded with the SAME withTimeout policy every other
        // block in this module already uses (3s, fall back, keep streaming).
        // This was the one unbounded await here: it failed open on ERROR (the
        // catch below drops to raw order) but NOT on SLOWNESS, and it is the
        // slowest thing in the function — it fans out one getEmbedding per
        // context block, each able to walk the serial provider cascade in
        // lib/ai/provider.ts. Block count grows with message length, because
        // most blocks gate on keyword hits. So on a long message this could
        // hold the whole brain stage with zero bytes on the wire, past the
        // client's 90s stall abort, and the operator saw a turn that never
        // answered. Reranking is an OPTIMIZATION — raw order is a correct
        // answer, just a less well-ordered one. Never worth hanging a turn for.
        reranked = await withTimeout(
          rerankContextBlocks(userEmbedding, rawBlocks, { dropThreshold: 0.12 }),
          3000,
          rawOrder,
        );
        if (reranked === rawOrder) {
          log.warn("rerank_timed_out_using_raw_order", { blocks: rawBlocks.length });
        } else {
          log.info("rerank_applied", { summary: formatRerankSummary(reranked) });
        }
      } catch (rerankErr) {
        log.warn("rerank_failed_using_raw_order", {
          err: rerankErr instanceof Error ? rerankErr.message : String(rerankErr),
        });
      }
    }

    // Append blocks in reranked order (descending similarity), skipping
    // dropped ones — the highest-similarity block lands EARLIEST in the
    // addendum. This loop is what makes the rerank's sort direction load-
    // bearing; keep them consistent.
    for (const block of reranked) {
      if (!block.kept) continue;
      addendum += `\n\n${block.content}`;
    }

    // Wave 3 (2026-09-17) · context receipt. Reuses the SAME `reranked` array
    // the append loop just walked, so it can never disagree with what
    // actually went into `addendum` — this call does not itself change
    // addendum (see lib/ai/context-budget.ts file header: observability
    // only, no similarityFn wired yet, so the MMR pass is a no-op today).
    // asOf rides along so the receipt records WHICH INSTANT recall answered
    // as of. A false asOf silently truncates memory (see ContextReceipt's
    // recallAsOf docstring); the classifier fix removed today's trigger, this
    // removes the silence that let it survive unnoticed.
    // W1 (2026-10-16) · the arbiter state rides the persisted receipt so
    // scripts/arbiter-judge-split.ts can split reply_judgment composites by it.
    contextReceipt = buildContextReceipt(reranked, DEFAULT_CONTEXT_TOKEN_BUDGET, {
      asOf: queryPlan.asOf,
      arbiter: arbiterUsed,
      // CX-6 · the assignment rides beside it, so a flag-on turn with no pack stays in the treated group.
      arbiterAssigned: arbiterOn,
      rerankBackend: arbiterUsed ? (evidencePack?.reranked ?? "none") : undefined,
    });
    // 2026-09-17 (Codex review, PR #2414) · the aggregate counts alone can't
    // answer "why was THIS block dropped" -- the entries array (name, tokens,
    // similarity, reason) is the whole point of a receipt. Log the full
    // object; it's ~13 blocks max, not a size concern. Threading this into
    // the on-finish persistence path (recallReceipts in route.ts) so it
    // survives past the log window stays the documented follow-up.
    console.info("[brain-context] context_receipt", JSON.stringify(contextReceipt));

    // Populate contextBlocksFired for onFinish + headers
    contextBlocksFired = {
      recall: !!recallBlock,
      skills: !!skillsBlock,
      identity: !!identityBlock,
      ghost: !!ghostBlock,
      qualitative: !!qBlock,
      beliefs: !!bBlock,
      nudges: !!nBlock,
      // A claim-vs-record gap is a contradiction too: it lights the chat's existing
      // Contradictions badge (the client knows no claimGap key) and claimGap counts it alone.
      contradictions:
        !!(nBlock && /contradiction/i.test(nBlock)) || !!claimGapBlock || !!dailyContradictionBlock,
      claimGap: !!claimGapBlock,
      dailyContradiction: !!dailyContradictionBlock,
      concerns: !!concernsBlock,
      anticipated: !!anticipatedBlock,
      physical: !!physicalBlock,
      hybridRecall: !!hybridRecallBlock,
    };
    
    finalContextMemories = contextMemories;
    // 2026-07-12 · normalize the recall hit shape to the Memory Inspector's
    // client contract. Raw hits are { memoryId, knnDistance, content, category }
    // but the sidebar reads { id, similarity, content, category } — so hits
    // rendered as "NaN% Match" with a missing React key. Map once here.
    // Wave 0 (2026-09-08) · how much of the contextual lane's evidence the hybrid lane already
    // carried this turn. Logged, not acted on: the arbiter that dedupes across lanes is Wave 2
    // and this is the number it must beat.
    if (contextualRankedIds.length > 0 || (hybridRecallReport?.hits?.length ?? 0) > 0) {
      laneOverlap = computeLaneOverlap(
        contextualRankedIds,
        (hybridRecallReport?.hits ?? []).map((h: any) => String(h.id ?? h.memoryId ?? "")).filter(Boolean),
      );
      console.info("[brain-context] recall_lane_overlap", JSON.stringify(laneOverlap));
      // exactTerms are lifted verbatim from the user's message; a private
      // turn's words stay out of the logs.
      if (!privateMode) console.info("[brain-context] query_plan", JSON.stringify({ classes: queryPlan.classes, asOf: queryPlan.asOf?.toISOString() ?? null, exactTerms: queryPlan.exactTerms, subQueries: queryPlan.subQueries.length }));
    }
    if (hybridRecallReport) {
      recallProvenance =
        (hybridRecallReport as any).provenance ??
        ((hybridRecallReport.hits?.length ?? 0) > 0 ? "OK" : "ZERO");
      recallProvenanceReason = (hybridRecallReport as any).provenanceReason;

      // 2026-09-10 · PROVENANCE IS NOT AUTHORITY -- the producer.
      //
      // If this turn's recall came back with hits but NONE of them are
      // action-authorizing (i.e. every one is a model inference rather
      // than something Nour stated or first-party data established),
      // stamp the turn. tool-policy.ts then sends any memory write on
      // this turn to human review instead of letting NICK's own guess
      // harden into a fact he will later be held to.
      //
      // Set HERE, from the rows' tiers -- never declared by the model.
      // Same discipline as the untrustedInput fence, for the same
      // reason: a declaration the model controls is not a control.
      try {
        const hits = (hybridRecallReport.hits ?? []) as Array<{ trustTier?: string }>;
        const { shouldStampInferredBasis, classifyTrustTier } = await import("@/lib/brain/memory-trust");
        const { updateTurnContext } = await import("@/lib/agent/turn-context");
        if (shouldStampInferredBasis(hits)) {
          updateTurnContext({ inferredBasisOnly: true });
          log.info("turn_inferred_basis_only", { hits: hits.length });
        }
        // 2026-10-10 (audit 07-SN-02) · recalled third-party text (inbound
        // mail, scraped pages) is untrusted input to THIS turn, wherever it
        // renders -- hybrid block, contextual block or the evidence pack. The
        // taint is what makes the sink gate hold an outward side effect. A
        // contextual row with no source re-derives from its category, like
        // the hybrid renderer does, so a missing field does not taint every turn.
        const external =
          hits.some((h) => h.trustTier === "EXTERNAL_CONTENT") ||
          contextualRankedRows.some(
            (r) => classifyTrustTier(r.source || "unclassified", null, r.category) === "EXTERNAL_CONTENT",
          );
        if (external) {
          updateTurnContext({ untrustedInput: true });
          log.info("turn_tainted_by_recall", { hits: hits.length, contextual: contextualRankedRows.length });
        }
      } catch {
        // Never let provenance stamping break a turn. Failing to stamp
        // is fail-OPEN, which is why the flag is one of several controls
        // (external mutations already require owner approval) rather
        // than the only thing standing between an inference and a write.
      }
      recalledHits = (hybridRecallReport.hits ?? []).map((h: any) => ({
        id: h.id ?? h.memoryId,
        content: h.content,
        category: h.category,
        similarity:
          typeof h.similarity === "number"
            ? h.similarity
            : typeof h.knnDistance === "number"
              ? Math.max(0, Math.min(1, 1 - h.knnDistance))
              : 0,
        // 2026-08-19 · memory-loop wave · stop flattening the receipt
        // fields away: key + seenCount ride to the client (Memory
        // Inspector ignores extras) AND into the persisted per-message
        // receipt, which is what lets "why did Nick say this?" answer
        // from what ACTUALLY fired instead of a read-time re-recall.
        key: typeof h.key === "string" ? h.key : undefined,
        seenCount: typeof h.seenCount === "number" ? h.seenCount : undefined,
      }));
    }

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
    // 2026-09-10 · the whole block assembly threw, so recalledHits is
    // still []. Say the read FAILED -- do not let the Memory Inspector
    // render a confident "(0) Nick believes nothing" off a crash.
    recallProvenance = "ERROR";
    recallProvenanceReason = "brain block assembly threw -- recall state unknown";
    log.warn("brain_blocks_failed", { err: err instanceof Error ? err.message : String(err) });
  }

  /**
   * 2026-09-10 (review, P1+P2) · THE NOTICE IS EMITTED HERE, not in
   * rawBlocks, and the reviewer was right about why.
   *
   * The first version computed it during rawBlocks assembly, inside the
   * try. That covered only the path where assembly SUCCEEDED. The two it
   * missed are the two that matter most:
   *
   *   · assembly THREW -- the catch above sets ERROR, but rawBlocks was
   *     already built (or never built), so the notice could never appear
   *     on the one path that is unambiguously a failed read;
   *   · the recall module failed to import -- `hybridRecallReport` is
   *     null, provenance stays at its "UNMEASURED" initial value, and a
   *     substantive turn silently got no recall and no explanation.
   *
   * Emitting from the FINAL provenance, after the try/catch, means one
   * emission point that every path flows through. Appending straight to
   * the addendum is also stronger than the `critical: true` rawBlock it
   * replaces: the reranker never sees it, so it cannot be dropped.
   */
  if (recallProvenance === "UNMEASURED" && userContent.length > 10) {
    // Recall SHOULD have run on a turn this substantive. That it did not
    // is a failed read, not a turn where memory was irrelevant -- the
    // UNMEASURED default is only honest for the short-message case.
    recallProvenance = "ERROR";
    recallProvenanceReason =
      recallProvenanceReason ?? "recall never ran this turn (module unavailable) -- nothing was searched";
  }
  const recallStateNotice = buildRecallFailureNotice({
    provenance: recallProvenance,
    reason: recallProvenanceReason,
    hitCount: recalledHits.length,
  });
  if (recallStateNotice) {
    addendum += (addendum ? "\n\n" : "") + recallStateNotice;
    contextBlocksFired.recallState = true;
  }

  // Appended after the reranker, like the recall notice: a low cosine score
  // must not drop the decision ask. The fired flags persist into
  // ChatMessage.tokenUsage.contextBlocks, which is how the W3 kill criterion
  // (decisionSkip vs decisionAsk) is measured.
  const decisionTurn = await decisionTurnPromise;
  if (decisionTurn === "timeout") {
    contextBlocksFired.decisionTimeout = true;
    log.info("decision_turn_timeout", { ms: 3000 });
  } else if (decisionTurn) {
    if (decisionTurn.block) addendum += (addendum ? "\n\n" : "") + decisionTurn.block;
    Object.assign(contextBlocksFired, decisionTurn.fired);
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
    recallProvenance,
    recallProvenanceReason,
    laneOverlap,
    queryPlan,
    evidencePack,
    contextReceipt,
    contradictionClaim,
    contradictionAskPending,
  };
}
