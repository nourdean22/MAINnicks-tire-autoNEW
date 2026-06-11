/**
 * lib/ai/system-prompt.ts · Wave 84 split · 2026-05-17
 *
 * Orchestrator for the v1 system prompt. The DB fan-out + section
 * composition still lives here; the inline `p.push(...)` runs for
 * each section were extracted to lib/ai/prompt/sections/* as pure
 * formatters (preloaded data → string[]).
 *
 * Public API unchanged:
 *   · buildSystemPrompt(tier?, userMessage?)  → string  (cache-aware
 *     entry · routes v1/v2 via NICK_PRIME_PROMPT)
 *   · buildSystemPromptUncached(tier?, userMessage?) → string  (the
 *     real v1 builder · still default in production)
 *   · withPromptTelemetry(tier, fn)           → { result, telemetry }
 *   · detectTopicTier(message)                → TopicTier
 *   · type TopicTier
 *
 * v9.1.3 three-mode routing (NICK_PRIME_PROMPT unset/off → v1 only,
 * "shadow" → v1 returned + v2 built in parallel + delta logged, "1"
 * / "on" → v2 only) stays intact. v2 lives in lib/ai/prompt/v2/.
 *
 * The audit (Wave 84 brief) suggested deleting buildSystemPromptUncached
 * but it's still the production default — keeping it until the
 * shadow-mode parity window completes and v2 is the primary.
 */

import { prisma } from "@/lib/prisma";
import { getBehaviorDirective, resolveIntensity } from "./knowledge/behavior-directive";
import { DOMAINS } from "@/lib/mastery/config";
import { computeCharacterSheet, statLine } from "@/lib/mastery/character-sheet";
import { cached } from "@/lib/utils/cache";
import { getKnowledgeDigest } from "./knowledge-compiler";
import { STRATEGIC_MIND } from "./knowledge/strategic-mind";
import { getLearnedKnowledge } from "./memory";
import { getRecentReflections } from "@/lib/brain/reflection-engine";
import { getActivePredictions } from "@/lib/brain/predictive-engine";
import { getGraphSummary } from "@/lib/brain/relational-graph";
import { getThinkingLayersContext } from "@/lib/brain/thinking-engine";
import { getRegistryStats, getPendingTools } from "@/lib/integrations/registry";
import { computeIsoWeekKey } from "@/lib/ai/context/command-center-state";
import { getRecentConversationContext } from "@/lib/brain/conversation-memory";
import { getPageVisitIntelligence } from "@/lib/brain/page-intelligence";
import { getBrainContinuitySummary } from "@/lib/brain/cloud-memory";
import { getMarketIntelligence } from "@/lib/brain/search-grounding";
import { getCameraIntelligence } from "@/lib/brain/camera-intelligence";
import { getPeopleIntelligence } from "@/lib/brain/people-intelligence";
import { getDecisionPatternContext } from "@/lib/brain/decision-patterns";
import { getTimeIntelligenceContext } from "@/lib/brain/time-intelligence";
import { getEmotionalArcContext } from "@/lib/brain/emotional-arc";
import { getLearningVelocityContext } from "@/lib/brain/learning-velocity";
import { getStrategicPlanContext } from "@/lib/brain/strategic-plans";
import { getAccuracyContext } from "@/lib/brain/outcome-tracker";
import { getBlindSpotContext } from "@/lib/brain/blind-spot-detector";
import { getCounterIntuitiveContext } from "@/lib/brain/counter-intuitive";
import { getWisdomContext } from "@/lib/brain/wisdom-distiller";
import { getViolationContext } from "@/lib/brain/violation-context";
import { getWeeklyReviewContext } from "@/lib/brain/weekly-review-context";
import { getRelevantSkillsBlock } from "@/lib/skills/skill-context";
import { getLearningJournalContext } from "@/lib/brain/learning-journal";
import { getAttentionContext } from "@/lib/brain/attention-tracker";
import { getCorrelationContext } from "@/lib/brain/correlation-finder";
import { getBrainMaturityContext } from "@/lib/brain/brain-maturity";
import { getTeachingMomentsContext } from "@/lib/brain/teaching-moments";
import { getChatGPTContext } from "@/lib/brain/chatgpt-processor";
import { getChatGPTKnowledge } from "@/lib/brain/chatgpt-knowledge";
import { today, daysAgo } from "@/lib/utils/datetime";

import {
  renderIdentityAndBehavior,
  renderToolsCatalog,
  renderBuilderMode,
  renderCodingAndArchitectureMemories,
  renderLifeOps,
  renderLiveState,
  renderCameraIntel,
  renderLiveMetrics,
  renderLiveShopStatus,
  renderPinnedMemories,
  renderHotRules,
  renderChatPatternAdaptations,
  renderRecentChatsFallback,
  renderSmartDevicesSummary,
  renderAutomationRules,
  renderIntegrationSyncs,
  renderAiToolsHealth,
  renderRecentBrainDumps,
} from "@/lib/ai/prompt/sections";

/**
 * Pull Nour's per-effort-band real pace from BrainMemory `effort_band_avg`.
 * Writeback is live in /api/tasks/[id]/check so these stay accurate to
 * the last 30 days. Returns a short table the chat model can quote when
 * Nour asks "how long will X take?" instead of guessing.
 *
 * Empty string when no completions have fed the writeback yet.
 */
async function getRealityGapContext(): Promise<string> {
  try {
    const rows = await prisma.brainMemory.findMany({
      where: { category: BRAIN_CATEGORIES.EFFORT_BAND_AVG, deletedAt: null }, // v7.9
      select: { key: true, content: true },
    });
    if (rows.length === 0) return "";

    const BAND_LABEL: Record<string, string> = {
      M5: "5-min",
      M15: "15-min",
      M30: "30-min",
      H1: "1-hour",
      H2PLUS: "2h+",
    };

    const lines: string[] = [];
    for (const r of rows) {
      try {
        const parsed = JSON.parse(r.content) as {
          avgMinutes?: number;
          sampleSize?: number;
        };
        if (typeof parsed.avgMinutes !== "number") continue;
        const label = BAND_LABEL[r.key] ?? r.key;
        const target =
          r.key === "M5" ? 5 :
          r.key === "M15" ? 15 :
          r.key === "M30" ? 30 :
          r.key === "H1" ? 60 :
          r.key === "H2PLUS" ? 120 :
          0;
        const gap = target > 0 ? Math.round(((parsed.avgMinutes - target) / target) * 100) : 0;
        const gapNote =
          Math.abs(gap) < 15
            ? "on pace"
            : gap > 0
              ? `runs ${gap}% long`
              : `runs ${Math.abs(gap)}% fast`;
        lines.push(`  ${label}: avg ${parsed.avgMinutes}m (${gapNote}, n=${parsed.sampleSize ?? "?"})`);
      } catch {
        // malformed — skip
      }
    }
    if (lines.length === 0) return "";
    return `\n## Reality-gap: Nour's real pace (last 30d)\n${lines.join("\n")}\nUse these when estimating task duration — don't default to the target label.`;
  } catch {
    return "";
  }
}

/**
 * Hard cap on any variable-length section pulled from a brain engine.
 * Engines occasionally return multi-KB blocks that blow the 50K Venice
 * context ceiling. Capping at the section level means the PROMPT STAYS
 * PREDICTABLE — no single engine can starve the rest of the budget.
 *
 * Budget guideline:
 *   1500 — top-tier engines (Strategic Plans, Decision Patterns)
 *   1200 — standard engines (Correlations, Wisdom, Blind Spots)
 *   1000 — supporting intelligence (Page Intel, Market Intel)
 *    800 — reference data (Seasonal, Customer LTV)
 */
function cap(text: string | undefined | null, n: number): string {
  if (!text) return "";
  if (text.length <= n) return text;
  return text.slice(0, n - 3) + "...";
}

/**
 * v8.1 · per-engine tier gating · 2026-04-29.
 *
 * Helper that returns an empty stand-in when the current tier doesn't
 * need a given query. Lets the existing `Promise.all` destructuring
 * stay shape-stable (caller still gets [] / null at index N) while
 * cutting 40-60% of DB ops on casual chat turns.
 *
 * Usage:
 *   tierGate(tier, ["full", "business"], () => prisma.lead.findMany(...))
 *   // → on tier=core / personal / strategy returns the empty default
 *   //   without touching the DB.
 *
 * Defaults are typed [] / null — callers pass `<T extends never[]>` or
 * `<T extends null>` if they need a specific empty.
 */
function tierGate<T>(
  current: TopicTier,
  allowedTiers: TopicTier[],
  run: () => Promise<T>,
  empty: T,
): Promise<T> {
  if (current === "full" || allowedTiers.includes(current)) {
    return run();
  }
  return Promise.resolve(empty);
}

/**
 * Telemetry: which tier ran which engines this request? Surfaced from
 * /system/prompt diagnostics so we can verify the gating is working.
 * AsyncLocalStorage avoids threading through every helper signature.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";

interface PromptTelemetry {
  tier: TopicTier;
  engineRuns: number;
  engineSkips: number;
}

const telemetryStore = new AsyncLocalStorage<PromptTelemetry>();

export function withPromptTelemetry<T>(tier: TopicTier, fn: () => Promise<T>): Promise<{
  result: T;
  telemetry: PromptTelemetry;
}> {
  const tel: PromptTelemetry = { tier, engineRuns: 0, engineSkips: 0 };
  return telemetryStore.run(tel, async () => {
    const result = await fn();
    return { result, telemetry: tel };
  });
}

function recordEngineRun() {
  const tel = telemetryStore.getStore();
  if (tel) tel.engineRuns += 1;
}
function recordEngineSkip() {
  const tel = telemetryStore.getStore();
  if (tel) tel.engineSkips += 1;
}

/** Wrapped tierGate that also bumps the engine-run/skip counters. */
function gated<T>(
  current: TopicTier,
  allowed: TopicTier[],
  run: () => Promise<T>,
  empty: T,
): Promise<T> {
  if (current === "full" || allowed.includes(current)) {
    recordEngineRun();
    return run();
  }
  recordEngineSkip();
  return Promise.resolve(empty);
}

/**
 * Topic tier for query-adaptive engine loading.
 * Instead of loading all 29 engines on every message (25K chars of
 * context), we detect the topic and only load the engines relevant
 * to that conversation. Reduces context by ~60% on casual messages.
 *
 *   core     — always loaded (reflections, decisions, wisdom, synthesis, blind spots, weekly review)
 *   business — revenue, pipeline, customers, staff, forecasts
 *   personal — mood, habits, health, learning, attention
 *   strategy — strategic plans, correlations, thinking layers, counter-intuitive
 *   full     — everything (deep mode or unclassified complex queries)
 */
export type TopicTier = "core" | "business" | "personal" | "strategy" | "full";

const BUSINESS_SIGNALS = /\b(revenue|lead|estimate|invoice|customer|callback|job|auto labor|shop|tire|price|profit|deal|quote|sale|appointment|booking|gbp|google|ads|marketing|fleet)\b/i;
const PERSONAL_SIGNALS = /\b(workout|energy|sleep|weight|habit|body|dania|health|mood|discipline|focus|adderall|boxing|gym|meditation|prayer|water|walk)\b/i;
const STRATEGY_SIGNALS = /\b(analy[zs]e|plan|strategy|goal|decision|long.term|think about|should i|what if|opportunity|pattern|trend|forecast|risk|leverage|power)\b/i;

export function detectTopicTier(message: string): TopicTier {
  if (!message || message.length < 5) return "core";
  const hasBiz = BUSINESS_SIGNALS.test(message);
  const hasPersonal = PERSONAL_SIGNALS.test(message);
  const hasStrategy = STRATEGY_SIGNALS.test(message);
  // Multiple domains → full load
  if ((hasBiz && hasPersonal) || (hasBiz && hasStrategy) || (hasPersonal && hasStrategy)) return "full";
  if (hasBiz) return "business";
  if (hasPersonal) return "personal";
  if (hasStrategy) return "strategy";
  // Short casual message → core only
  // No domain signal matched → casual/general message → core only (of ANY
  // length). `full` stays reserved for multi-domain messages (above) +
  // explicit deep mode (forced upstream). The old `length < 30 ? core : full`
  // sent every longer keyword-less message to the all-29-engines `full` tier,
  // silently defeating the ~60% context-savings this tiering exists for.
  return "core";
}

/**
 * Builds the system prompt with live DB data + knowledge files + brain dumps.
 * Accepts an optional topicTier to load only relevant engines.
 *
 * Apr 28 · userMessage param threads the current user message through to
 * the business-knowledge loader, which uses it to detect content-creation
 * intent (post / caption / ad / instagram / etc.). Only when content
 * mode fires does the heavy Master Content Engine v5.0 (~40kc) get
 * injected — keeps Venice's 65k system-prompt budget from blowing up
 * on every business query.
 *
 * Cache key includes a content-mode flag so business-with-content and
 * business-without-content don't collide.
 */
/**
 * v9.1.3 · Three-mode flag for prompt-v2 routing:
 *   · NICK_PRIME_PROMPT unset / "0" / "off" → v1 only (default, zero risk)
 *   · NICK_PRIME_PROMPT === "shadow"        → v1 returned, v2 built in
 *     parallel and logged to console (parity-data collection without
 *     affecting production responses)
 *   · NICK_PRIME_PROMPT === "1" / "on"     → v2 only (production cutover)
 */
type PromptMode = "off" | "shadow" | "on";
function resolvePromptMode(): PromptMode {
  const v = (process.env.NICK_PRIME_PROMPT ?? "").toLowerCase();
  if (v === "1" || v === "on") return "on";
  if (v === "shadow") return "shadow";
  return "off";
}

export async function buildSystemPrompt(
  tier?: TopicTier,
  userMessage?: string | null,
): Promise<string> {
  const effectiveTier = tier || "full";
  // Content-mode key: changes the cache slot when the user's message
  // contains content-creation signals (post, caption, instagram, etc.).
  // Without this, the first cached prompt of the tier would persist for
  // 5 minutes regardless of subsequent user message intent.
  const { detectContentIntent, detectContentDeepIntent } = await import("./business-knowledge");
  const contentMode = detectContentIntent(userMessage);
  const deepMode = contentMode && detectContentDeepIntent(userMessage);
  // Three slots per tier: default · content-basic · content-deep.
  // Without deepMode in the key, "give me a content plan" would re-use
  // a "give me a post" cache and miss the strategic sections.
  const slot = deepMode ? "deep" : contentMode ? "content" : "default";
  const mode = resolvePromptMode();

  // v9.1.3 · "on" mode skips v1 entirely. Caches under a separate key
  // so v1 + v2 cache slots don't collide if Nour flips the flag mid-
  // session.
  if (mode === "on") {
    const cacheKey = `system_prompt_v2_${effectiveTier}_${slot}`;
    return cached(cacheKey, 300, async () => {
      const { buildSystemPromptV2 } = await import("./prompt/v2");
      const out = await buildSystemPromptV2();
      return out.prompt;
    });
  }

  // v10.0.529.93 · Wave 37 · cache-key now includes today() + 4-hour
  // time-bucket. Pre-Wave-37 the prompt baked in `today()` and a
  // morning/afternoon/evening label · cached for 300s · so a turn
  // crossing the morning→afternoon boundary delivered a stale
  // "morning" label up to 5 minutes after noon. Including the date
  // + 4h bucket in the key invalidates correctly without slowing
  // the hot path · same 300s TTL but partitioned by time-of-day
  // so stale-window collapses to zero.
  const _now = new Date();
  const _dayKey = _now.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const _hour = parseInt(
    _now.toLocaleString("en-US", { timeZone: "America/New_York", hour: "numeric", hour12: false }),
    10,
  );
  const _bucket = _hour < 12 ? "am" : _hour < 17 ? "pm" : "eve";
  const cacheKey = `system_prompt_${effectiveTier}_${slot}_${_dayKey}_${_bucket}`;
  const v1Prompt = await cached(cacheKey, 300, () =>
    buildSystemPromptUncached(effectiveTier, userMessage ?? null),
  );

  // v9.1.3 · "shadow" mode builds v2 in parallel and logs the delta.
  // v9.1.6 · also persists three SystemMetric rows so the operator
  //          dashboard can trend the delta over the 7-day parity
  //          window. Fire-and-forget so the chat path never blocks
  //          on either the v2 build or the metric write.
  // v9.1.13 · also persist a `prompt.shadow.build_failures` counter
  //           when the v2 build or metric write throws, so the
  //           parity dashboard can show the failure rate alongside
  //           the success-side trend lines. Without this, silent
  //           failures would shrink the parity sample and the
  //           cutover decision gets made on incomplete data.
  if (mode === "shadow") {
    void (async () => {
      try {
        const { buildSystemPromptV2 } = await import("./prompt/v2");
        const { computeShadowDelta, recordShadowDelta, enqueueShadowJudgePair } = await import(
          "./prompt/v2/shadow-metrics"
        );
        const out = await buildSystemPromptV2();
        const delta = computeShadowDelta(
          v1Prompt,
          out.prompt,
          out.meta.builderVersion,
          effectiveTier,
          slot,
        );
        console.log(
          `[prompt-shadow] v1=${delta.charsV1} v2=${delta.charsV2} delta=${delta.charsDelta} (${delta.charsDeltaPct}%) tier=${effectiveTier} slot=${slot} only-in-v1=${delta.sectionsOnlyInV1}`,
        );
        await recordShadowDelta(delta);
        // 2026-05-23 · Wave C+ · Q2 · ~10% sample-rate queue for the
        // judge-eval replay cron. Closes the V1→V2 cutover quality
        // signal gap · the shadow path was recording structural drift
        // only · now a small sample gets a real LLM-judged score delta
        // written back via the cron (out-of-band · no chat latency hit).
        if (userMessage && Math.random() < 0.1) {
          await enqueueShadowJudgePair({
            userMessage,
            v1Prompt,
            v2Prompt: out.prompt,
            tier: effectiveTier,
            slot,
          });
        }
      } catch (err) {
        console.warn("[prompt-shadow] v2 build failed:", err);
        try {
          const { prisma } = await import("@/lib/prisma");
          await prisma.systemMetric.create({
            data: {
              metric: "prompt.shadow.build_failures",
              value: 1,
              unit: "count",
              tags: {
                tier: effectiveTier,
                slot,
                error:
                  err instanceof Error
                    ? err.message.slice(0, 200)
                    : String(err).slice(0, 200),
              },
              source: "prompt-shadow",
            },
          });
        } catch {
          // Last-ditch swallow — telemetry must never block prompt delivery.
        }
      }
    })();
  }

  return v1Prompt;
}

// Phase X (2026-05-18 PM) · exported so the judge-eval shadow-execute
// cron (`lib/ai/judge-eval/replay.ts`) can fire V1 explicitly without
// going through the env-flag conditional in `buildSystemPrompt`. The
// cron runs once per day so the uncached path is fine.
export async function buildSystemPromptUncached(
  tier: TopicTier = "full",
  userMessage: string | null = null,
): Promise<string> {
  // ── Live data from DB (parallel queries) ──
  // v8.1 · 2026-04-29 — every query is wrapped in `gated(tier, allowed,
  // ...)` so casual `core` turns skip ~12 of these DB hits entirely.
  // The shape stays stable because gated() returns the empty default
  // ([] / null / 0) when the tier doesn't qualify.
  const [
    recentScores,
    activeAlerts,
    brainAlerts,
    openLoops,
    activeCommitments,
    latestWeight,
    recentBrainDumps,
    recentDecisions,
    activeMissions,
    habitData,
    recentVisionEvents,
    latestFinancial,
    latestEmpire,
    customerCount,
    openLeadCount,
    activeJobCount,
  ] = await Promise.all([
    // v10.0.59 · Wave A part 2 · scores → identity_snapshot history
    // via legacy-shim (DailyScore retired Apr 19).
    (async () => {
      const { recentScoreSnapshots } = await import("@/lib/brain/legacy-shims");
      return recentScoreSnapshots(7);
    })(),
    gated(tier, ["business", "personal", "strategy"], () =>
      prisma.driftAlert.findMany({
        where: { resolved: false }, orderBy: { severity: "asc" }, take: 5,
        select: { ruleName: true, severity: true, message: true },
      }),
      [] as { ruleName: string; severity: string; message: string }[],
    ),
    // v8.22 RAG · the v8.x BrainMemory alert pipeline. Pulling the
    // 3 most recent per category so chat can reference them in its
    // replies — closes the loop between detector cron output and the
    // assistant's awareness.
    gated(tier, ["business", "personal", "strategy"], () =>
      prisma.brainMemory.findMany({
        where: {
          category: {
            in: [
              "correlation_alert",
              "decision_quality_drift",
              "schema_drift_alert",
              "storage_quota_alert",
              "creation_spike_alert",
              "update_spike_alert",
              "brain_bus_alert",
            ],
          },
          createdAt: { gte: new Date(Date.now() - 7 * 86_400_000) },
          deletedAt: null,
        },
        orderBy: { createdAt: "desc" },
        take: 5,
        select: { category: true, content: true, createdAt: true },
      }),
      [] as { category: string; content: string; createdAt: Date }[],
    ),
    // Apr 18: OpenLoop retired → read active Tasks (INBOX/READY/DOING).
    gated(
      tier,
      ["business", "personal", "strategy"],
      () =>
        prisma.task
          .findMany({
            where: { status: { in: ["INBOX", "READY", "DOING"] }, deletedAt: null },
            orderBy: [{ autoPriority: "asc" }, { createdAt: "desc" }],
            take: 10,
            select: {
              title: true,
              autoPriority: true,
              mission: { select: { domain: true } },
            },
          })
          .then((rows) =>
            rows.map((t) => ({
              title: t.title,
              priority:
                (t.autoPriority ?? 50) < 20 ? "critical"
                : (t.autoPriority ?? 50) < 40 ? "high"
                : (t.autoPriority ?? 50) < 60 ? "medium"
                : "low",
              domain: t.mission?.domain ?? "general",
            })),
          ),
      [] as { title: string; priority: string; domain: string }[],
    ),
    // v11.1 · Only commitments touched in last 7d count as "active"
    // for Nick's context.
    gated(
      tier,
      ["personal", "strategy"],
      () =>
        prisma.commitment.findMany({
          where: {
            status: { in: ["active", "in_progress"] },
            updatedAt: { gte: daysAgo(7) },
            deletedAt: null,
          },
          orderBy: { updatedAt: "desc" },
          take: 10,
          select: { description: true, status: true, deadline: true, domain: true, updatedAt: true },
        }),
      [] as { description: string; status: string; deadline: string | null; domain: string | null; updatedAt: Date }[],
    ),
    gated(tier, ["personal"], () =>
      prisma.bodyTracking.findFirst({ orderBy: { date: "desc" }, select: { weight: true, date: true } }),
      null as { weight: number | null; date: string } | null,
    ),
    gated(
      tier,
      ["personal", "strategy"],
      () =>
        prisma.brainDump.findMany({
          where: { deletedAt: null },
          orderBy: { createdAt: "desc" }, take: 5,
          select: {
            date: true,
            summary: true,
            patterns: true,
            entryType: true,
            linkStatus: true,
            goal: { select: { title: true } },
            mission: { select: { title: true } },
          },
        }),
      [] as {
        date: string;
        summary: string | null;
        patterns: unknown;
        entryType: string | null;
        linkStatus: string | null;
        goal: { title: string } | null;
        mission: { title: string } | null;
      }[],
    ),
    gated(
      tier,
      ["business", "personal", "strategy"],
      () =>
        prisma.masteryDecision.findMany({
          where: { deletedAt: null },
          orderBy: { date: "desc" }, take: 5,
          select: { title: true, date: true, stakes: true, chosen: true, grade: true },
        }),
      [] as { title: string; date: string; stakes: string | null; chosen: string | null; grade: string | null }[],
    ),
    gated(
      tier,
      ["business", "personal", "strategy"],
      () =>
        prisma.mission.findMany({
          where: { status: "ACTIVE", deletedAt: null }, orderBy: { priority: "desc" },
          select: { title: true, domain: true, priority: true, successMetric: true },
        }),
      [] as { title: string; domain: string; priority: number; successMetric: string | null }[],
    ),
    // v10.0.59 · habitData → DAILY-task streaks via legacy-shim
    // (HabitLog retired Apr 19).
    (async () => {
      const { recentDailyHabits } = await import("@/lib/brain/legacy-shims");
      return recentDailyHabits(7);
    })(),
    gated(
      tier,
      ["business"],
      () =>
        prisma.visionEvent.findMany({
          orderBy: { timestamp: "desc" },
          take: 10,
          select: { timestamp: true, event: true, camera: true, data: true },
        }).catch((): never[] => []),
      [] as never[],
    ),
    // Business data — tier-gated to business + strategy.
    gated(
      tier,
      ["business", "strategy"],
      () =>
        prisma.financialSnapshot.findFirst({
          orderBy: { date: "desc" },
          select: { date: true, businessRevenue: true, ownerTakeHome: true, totalDebt: true, savingsRatePct: true, netWorthEstimate: true },
        }).catch((): null => null),
      null,
    ),
    gated(
      tier,
      ["business"],
      () =>
        prisma.dailyEmpireSnapshot.findFirst({
          orderBy: { snapshotDate: "desc" },
          select: { snapshotDate: true, moneyScore: true, moneyDetail: true },
        }).catch((): null => null),
      null,
    ),
    Promise.resolve(0).catch((): number => 0),
    Promise.resolve(0).catch((): number => 0),
    Promise.resolve(0).catch((): number => 0),
  ]);

  // recentScores is no longer read by any prompt section (v11.1 ·
  // DailyScore-derived blocks retired) but the snapshot fetch stays
  // for /system/prompt diagnostics + future re-introduction.
  void recentScores;

  // Mastery scores + knowledge digest — parallel (digest compiles 29 files, was sequential)
  // Mastery rendered as LEVELS (leveling engine · 2026-05-30) so Nick
  // speaks in "Lvl 4 Active" not "6.4/10". computeCharacterSheet sums each
  // stat's lifetime XP (its MasteryScore deltas) → level + tier.
  const [characterSheet, knowledgeDigest] = await Promise.all([
    computeCharacterSheet().catch((): never[] => []),
    getKnowledgeDigest().catch((): string => ""),
  ]);

  // 2026-06-10 · the Mastery one-liner was the only UNCAPPED data line
  // in the prompt (~33-45 stats ≈ 1.7kc). computeCharacterSheet sorts
  // strongest-first, so the top 15 are the stats Nick actually cites.
  const masteryScores = characterSheet.slice(0, 15).map(statLine);
  if (characterSheet.length > 15) {
    masteryScores.push(`+${characterSheet.length - 15} more (full sheet on /stats)`);
  }

  // Compute habit rates (kept for legacy parity — habit-rate prompt
  // section retired, but the map is referenced by /system/prompt
  // diagnostics in other code paths).
  const habitMap = new Map<string, { done: number; total: number }>();
  for (const h of habitData) {
    const e = habitMap.get(h.habitKey) || { done: 0, total: 0 };
    e.total++;
    if (h.completed) e.done++;
    habitMap.set(h.habitKey, e);
  }
  void habitMap;

  // ── Compose the prompt ──
  // v11.1 · dedup near-identical commitment descriptions before count
  // so Nick doesn't paraphrase a 4x-inflated "10 commitments" from one
  // chat.
  const _commitSeen = new Set<string>();
  const dedupedCommitments = activeCommitments.filter((c) => {
    const k = c.description.toLowerCase().trim().slice(0, 60);
    if (_commitSeen.has(k)) return false;
    _commitSeen.add(k);
    return true;
  });

  const loopCount = openLoops.length;
  const commitmentCount = dedupedCommitments.length;
  const missionCount = activeMissions.length;
  const todayStr = today();
  const overdueCommitments = dedupedCommitments.filter((c) => c.deadline && c.deadline < todayStr).length;

  // ═══════════════════════════════════════════════════════════════
  // SECTION 1: IDENTITY + BEHAVIOR + TOOLS + BUILDER MODE
  // ═══════════════════════════════════════════════════════════════
  const p: string[] = [];
  p.push(...renderIdentityAndBehavior({ latestWeight }));
  p.push(...renderToolsCatalog());

  // v10.0.488 · ANTICIPATE_AND_ELEVATE behavior directive · injected
  // after rules so the model knows HOW to answer, not just WHAT.
  const intensity = resolveIntensity();
  const directive = getBehaviorDirective(userMessage, intensity);
  // 2026-06-10 · BROADEN_AND_SUGGEST is the directive's documented
  // predecessor (behavior-directive.ts: "Replaces the
  // BROADEN_AND_SUGGEST operator-rule") — v1 pushed BOTH every
  // standard turn. Now exactly one loads: the directive when it
  // fires, the older rule as fallback.
  if (!directive) {
    const { BROADEN_AND_SUGGEST } = await import("@/lib/ai/prompt/policy/operator-rules");
    p.push(BROADEN_AND_SUGGEST);
  }
  if (directive) {
    p.push(`## Behavior directive (intensity: ${intensity.toLowerCase()})`);
    p.push(directive);
    p.push(``);
  }

  p.push(...renderBuilderMode());

  // Pull coding preferences + architecture memories in PARALLEL —
  // previously two sequential findMany calls = 2 round-trips to Neon.
  const [codingPrefs, archMemories] = await Promise.all([
    prisma.brainMemory.findMany({
      where: { category: BRAIN_CATEGORIES.CODING_PREFERENCE, deletedAt: null }, // v7.9
      orderBy: { confidence: "desc" },
      take: 5,
      select: { content: true },
    }).catch((): never[] => []),
    prisma.brainMemory.findMany({
      where: { category: BRAIN_CATEGORIES.ARCHITECTURE, deletedAt: null }, // v7.9
      orderBy: { confidence: "desc" },
      take: 8,
      select: { content: true },
    }).catch((): never[] => []),
  ]);

  p.push(...renderCodingAndArchitectureMemories({ codingPrefs, archMemories }));
  p.push(``);

  // ═══════════════════════════════════════════════════════════════
  // SECTION 2: LIFE OPERATING SYSTEM
  // ═══════════════════════════════════════════════════════════════
  // v9.1.13 · use the shared UTC-stable computeIsoWeekKey instead of
  // the local-time getDay() + getDate() that mixed time contexts.
  const weekKey = computeIsoWeekKey(new Date());
  const weeklyTarget = await prisma.brainMemory.findUnique({
    where: { category_key: { category: BRAIN_CATEGORIES.WEEKLY_TARGET, key: `week_${weekKey}` } },
    select: { content: true, metadata: true },
  }).catch((): null => null);

  p.push(...renderLifeOps({
    loopCount,
    commitmentCount,
    missionCount,
    overdueCommitments,
    customerCount,
    weeklyTarget,
    weekKey,
  }));

  // ═══════════════════════════════════════════════════════════════
  // SECTION 3: LIVE STATE (domain snapshot + drift + missions + ...)
  // ═══════════════════════════════════════════════════════════════
  p.push(...renderLiveState({
    loopCount,
    commitmentCount,
    overdueCommitments,
    openLeadCount,
    activeJobCount,
    masteryScores,
    activeAlerts,
    brainAlerts,
    activeMissions,
    openLoops,
    dedupedCommitments,
    recentDecisions,
    latestWeight,
  }));

  // ═══════════════════════════════════════════════════════════════
  // SECTION 4: CAMERA INTELLIGENCE
  // ═══════════════════════════════════════════════════════════════
  // v10.0.74 · removed dead recentPlates branch — ALPR was a stub.
  const [camIntelResult, recentCamAlerts] = await Promise.all([
    getCameraIntelligence().catch((): null => null),
    prisma.brainMemory
      .findMany({
        where: { category: "camera_alert", deletedAt: null },
        orderBy: { createdAt: "desc" },
        take: 5,
        select: { content: true, createdAt: true },
      })
      .then((rows) =>
        // Project to {severity, alertType, description, createdAt}.
        // Severity/type are inferred from content keywords.
        rows.map((r) => {
          const lower = r.content.toLowerCase();
          const severity = /critical|breach/.test(lower)
            ? "critical"
            : /after-hours|alert|long wait/.test(lower)
              ? "high"
              : "info";
          const alertType = /after-hours/i.test(lower)
            ? "after_hours_motion"
            : /wait/i.test(lower)
              ? "long_customer_wait"
              : "general";
          return {
            severity,
            alertType,
            description: r.content,
            createdAt: r.createdAt,
          };
        }),
      )
      .catch((): Array<{ severity: string; alertType: string; description: string; createdAt: Date }> => []),
  ]);

  p.push(...renderCameraIntel({
    camIntelResult,
    recentCamAlerts,
    recentVisionEvents,
  }));

  // ═══════════════════════════════════════════════════════════════
  // SECTION 5: BUSINESS KNOWLEDGE + CONTENT INTEL
  // ═══════════════════════════════════════════════════════════════
  // Apr 27 v3 · sourced from lib/ai/business-knowledge.ts (Master
  // Content Engine + ops card + brand voice + content pillars + ...).
  // Tier-gated: light chats get OPS_CARD only; business/strategy/full
  // tiers get the full ~5K-token shop intelligence.
  const knowledgeTier =
    tier === "full" || tier === "strategy" || tier === "business"
      ? tier
      : tier === "personal"
        ? "chat"
        : "core";
  const { getBusinessKnowledge } = await import("./business-knowledge");
  p.push(`## Business — Nick's Tire & Auto`);
  p.push(
    getBusinessKnowledge(
      knowledgeTier as "core" | "chat" | "business" | "strategy" | "full",
      userMessage,
    ),
  );

  // v7 · BATCH 5 · Apr 28 — SLEEP-CONTEXT MODE.
  // After 10pm Cleveland, Nick softens. Compounding rest > more output.
  try {
    const { getSleepContext } = await import("@/lib/personal/sleep-context");
    const sleep = getSleepContext();
    if (sleep.isSleepWindow && sleep.modifications.promptHint) {
      p.push(`### SLEEP-CONTEXT MODE`);
      p.push(sleep.modifications.promptHint);
      if (sleep.modifications.suggestSleep) {
        p.push("If Nour is still up past 1am, gently suggest he sleep instead of pushing more action.");
      }
      p.push(``);
    }
  } catch {
    // non-critical
  }

  // v6 · BATCH 8 · Apr 28 — LIVE BRAIN RECALL FOR CONTENT MODE.
  // When the user is generating content, pull recent industry intel
  // + feedback so the model has REAL CURRENT material to riff on
  // instead of generic templates. ~3-5kc additional payload; skipped
  // when content mode isn't on.
  const { detectContentIntent } = await import("./business-knowledge");
  const contentMode = detectContentIntent(userMessage);
  if (contentMode && userMessage) {
    try {
      const [industry, recentFeedback] = await Promise.all([
        (await import("@/lib/automotive/industry-monitor")).recallIndustryIntel({ limit: 5, daysBack: 14 }),
        (await import("@/lib/ai/content-feedback")).recallRecentContentFeedback({ limit: 8, daysBack: 14 }),
      ]);
      if (industry.length > 0) {
        p.push(`### LIVE BRAIN RECALL — CURRENT MATERIAL TO RIFF ON`);
        p.push(`Recent industry intel (use these to ride trends, NOT to invent fake recalls):`);
        for (const item of industry) {
          p.push(`  · [${item.category}] ${item.title.slice(0, 200)}`);
        }
        p.push(`Use these as RAW MATERIAL. Don't fabricate alternates. If none fit the request, say so.`);
        p.push(``);
      }
      // v6 · Apr 28 · #6 — recent in-session content feedback.
      if (recentFeedback.length > 0) {
        const { buildFeedbackPromptBlock } = await import("@/lib/ai/content-feedback");
        const block = buildFeedbackPromptBlock(recentFeedback);
        if (block) {
          p.push(block);
          p.push(``);
        }
      }
      // v6 · Apr 28 · #4 — ambiguity detector.
      const { detectAmbiguity, buildAmbiguityPromptRule } = await import("@/lib/ai/ambiguity-detector");
      const ambiguity = detectAmbiguity(userMessage);
      const rule = buildAmbiguityPromptRule(ambiguity);
      if (rule) {
        p.push(rule);
        p.push(``);
      }

      // v7 · BATCH 1B · outcome-prediction calibration.
      const { getCalibrationStats, buildCalibrationPromptBlock } = await import("@/lib/ai/outcome-calibration");
      const calibration = await getCalibrationStats(30);
      const calibBlock = buildCalibrationPromptBlock(calibration);
      if (calibBlock) {
        p.push(calibBlock);
        p.push(``);
      }
    } catch (err) {
      // Recall failures must never break the chat path.
      console.warn("[system-prompt] live brain recall failed:", err instanceof Error ? err.message : err);
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // SECTION 6: LIVE METRICS + LIVE SHOP STATUS
  // ═══════════════════════════════════════════════════════════════
  p.push(...renderLiveMetrics({
    customerCount,
    openLeadCount,
    activeJobCount,
    latestFinancial,
    latestEmpire,
  }));

  // Seasonal context lives in lib/ai/business-knowledge.ts SEASONAL_PLAYBOOKS
  // and gets injected by getBusinessKnowledge() above. No duplicate here.

  // Live shop data + fallback pulse — caller logic deferred to section
  // so the orchestrator stays readable.
  try {
    const { queryNickBatch } = await import("@/lib/nickstire/query");
    const liveData = await queryNickBatch([
      { query: "revenue_today" },
      { query: "attention_needed" },
      { query: "leads_urgent" },
    ]);
    const rev = (liveData.revenue_today as { data?: { totalDollars?: number; invoiceCount?: number } })?.data;
    // nickstire's attention_needed handler pushes alerts shaped
    // { level, message, count } — the key is `message`, never `msg`.
    // Reading a.msg rendered every live shop alert ("3 leads untouched",
    // "callbacks unanswered") as literal "undefined" in Nick's system
    // prompt — he was told alerts existed but the text was gone.
    const alerts = (liveData.attention_needed as { data?: { alerts?: Array<{ message: string }> } })?.data;
    const urgent = (liveData.leads_urgent as { data?: { count?: number } })?.data;
    if (rev || alerts || urgent) {
      p.push(...renderLiveShopStatus({
        liveSnapshot: {
          revenueDollars: rev?.totalDollars ?? null,
          invoiceCount: rev?.invoiceCount ?? null,
          attentionMessages: alerts?.alerts?.map((a) => a.message) ?? [],
          urgentLeadsCount: urgent?.count ?? 0,
        },
        fallbackPulse: null,
      }));
    }
  } catch {
    // Fallback to stale sync if live query fails
    try {
      const latestSync = await prisma.auditEvent.findFirst({
        where: { eventType: "business_metrics_sync" },
        orderBy: { createdAt: "desc" },
      });
      if (latestSync?.payload) {
        const m = latestSync.payload as Record<string, any>;
        // 2026-05-30 · was `if (rev.todayEstimate)` — the OLD pushed-sync key.
        // v2 business_metrics_sync payloads carry `totalDollars`, so the guard
        // was always false and this stale-shop fallback NEVER fired when the
        // live bridge was down. Route through the canonical readNickRevenue()
        // (tolerates both shapes) so the fallback works again.
        const { readNickRevenue } = await import("@/lib/nickstire/revenue");
        const nickRev = readNickRevenue(m.revenue);
        if (nickRev.hasToday) {
          p.push(...renderLiveShopStatus({
            liveSnapshot: null,
            fallbackPulse: {
              asOf: new Date(latestSync.createdAt).toLocaleString("en-US", { timeZone: "America/New_York" }),
              todayEstimate: nickRev.todayDollars,
              weekRevenue: nickRev.weekDollars || null,
            },
          }));
        }
      }
    } catch {}
  }

  p.push(``);

  // ═══════════════════════════════════════════════════════════════
  // SECTION 7: BRAIN DUMPS + KNOWLEDGE DIGEST + CHATGPT ARCHIVE
  // ═══════════════════════════════════════════════════════════════
  p.push(...renderRecentBrainDumps({ recentBrainDumps }));

  // Knowledge digest — capped to 1000ch (2026-06-10, was 2500: the
  // surviving window was byte-verified as a stale 2026-03-25 dossier
  // copy of identity/business facts the static sections already
  // state; the corpus stays reachable via searchColdMemory). Skip on
  // core tier.
  if (knowledgeDigest && tier !== "core") {
    p.push(`# KNOWLEDGE BASE (compiled — call searchColdMemory for more)`);
    p.push(cap(knowledgeDigest, 1000));
    p.push(``);
  }

  // ChatGPT archive + auto-learned knowledge — both capped 2kc each.
  if (tier !== "core") {
    const cgpt = getChatGPTKnowledge();
    if (cgpt) {
      p.push(cap(cgpt, 2000));
      p.push(``);
    }
  }

  // 2026-06-10 · 20 facts/1500 → 10 facts/800: these are LLM-auto-
  // extracted one-liners (the lowest-provenance memory tier in the
  // prompt) overlapping the curated hot rules; fetching 10 keeps the
  // block ending on a fact boundary instead of cap-truncating.
  const learnedKnowledge = await getLearnedKnowledge(10);
  if (learnedKnowledge) {
    p.push(cap(learnedKnowledge, 800));
    p.push(``);
  }

  // ═══════════════════════════════════════════════════════════════
  // SECTION 8: QUERY-ADAPTIVE INTELLIGENCE ENGINES
  // ═══════════════════════════════════════════════════════════════
  //   core     → 7 engines  (~6K chars)  — always loaded
  //   business → +8 engines (~8K chars)  — revenue, pipeline, customers
  //   personal → +6 engines (~6K chars)  — mood, habits, health
  //   strategy → +5 engines (~6K chars)  — plans, correlations, thinking
  //   full     → all 29     (~25K chars) — deep mode or complex queries
  //
  // ~60% context savings on casual messages.
  const loadCore = true; // always
  const loadBusiness = tier === "business" || tier === "full";
  const loadPersonal = tier === "personal" || tier === "full";
  const loadStrategy = tier === "strategy" || tier === "full";
  const loadReference = tier === "full";

  // CORE engines — always loaded regardless of topic
  const [reflections, decisionPatterns, wisdom, blindSpots, violations, relevantSkills, weeklyReview] = await Promise.all([
    getRecentReflections().catch((): string => ""),
    getDecisionPatternContext().catch((): string => ""),
    getWisdomContext().catch((): string => ""),
    getBlindSpotContext().catch((): string => ""),
    getViolationContext().catch((): string => ""),
    // v10.0.434 · top 3 skills semantically relevant to the current
    // operator message (multi-language).
    getRelevantSkillsBlock(userMessage).catch((): string => ""),
    // 2026-06-10 · cross-week memory — the Sunday weekly review +
    // ReviewWizard commitment were computed but never deterministically
    // injected; core tier so casual Monday turns get it too.
    getWeeklyReviewContext().catch((): string => ""),
  ]);

  // OVERSIGHT — predictions + accuracy (business analytics live in
  // nickstire; autonicks personal OS only loads these on biz/full tier).
  const [predictions, accuracy] = loadBusiness
    ? await Promise.all([
        getActivePredictions().catch((): string => ""),
        getAccuracyContext().catch((): string => ""),
      ])
    : ["", ""];

  // PERSONAL engines — mood, habits, health, learning
  const [emotionalArc, learningVelocity, attention, journal, teachingMoments, maturity] = loadPersonal
    ? await Promise.all([
        getEmotionalArcContext().catch((): string => ""),
        getLearningVelocityContext().catch((): string => ""),
        getAttentionContext().catch((): string => ""),
        getLearningJournalContext().catch((): string => ""),
        getTeachingMomentsContext().catch((): string => ""),
        getBrainMaturityContext().catch((): string => ""),
      ])
    : ["", "", "", "", "", ""];

  // STRATEGY engines — plans, correlations, thinking, counter-intuitive
  const [strategicPlan, counterIntuitive, graphSummary, thinkingContext, correlations, realityGap] = loadStrategy
    ? await Promise.all([
        getStrategicPlanContext().catch((): string => ""),
        getCounterIntuitiveContext().catch((): string => ""),
        getGraphSummary().catch((): string => ""),
        getThinkingLayersContext().catch((): string => ""),
        getCorrelationContext().catch((): string => ""),
        getRealityGapContext().catch((): string => ""),
      ])
    : ["", "", "", "", "", ""];

  // REFERENCE engines — chatgpt history, people, time-of-day
  const [chatgptInsights, peopleIntel, timeIntel] = loadReference
    ? await Promise.all([
        getChatGPTContext().catch((): string => ""),
        getPeopleIntelligence().catch((): string => ""),
        getTimeIntelligenceContext().catch((): string => ""),
      ])
    : ["", "", ""];

  // Tier label for debugging
  p.push(`[Intelligence: ${tier} tier — ${loadCore ? "core" : ""}${loadBusiness ? "+biz" : ""}${loadPersonal ? "+personal" : ""}${loadStrategy ? "+strategy" : ""}${loadReference ? "+ref" : ""}]`);
  p.push(``);

  // Apr 28 · Engine caps cut ~30% across the board. Net savings: ~6kc
  // on full-tier prompts.

  // Core (always) · 2026-06-10 — reflections/decisionPatterns/wisdom
  // caps tightened (800/800/700 → 600/550/550); all three sat AT their
  // caps truncating mid-sentence, so the tail chars carried fragments.
  if (reflections) { p.push(cap(reflections, 600)); p.push(``); }
  if (decisionPatterns) { p.push(cap(decisionPatterns, 550)); p.push(``); }
  if (wisdom) { p.push(cap(wisdom, 550)); p.push(``); }
  // v10.0.414 · violations sit RIGHT AFTER wisdom · positioning matters.
  if (violations) { p.push(cap(violations, 600)); p.push(``); }
  // v10.0.434 · top 3 relevant skills · 700-char cap.
  if (relevantSkills) { p.push(cap(relevantSkills, 700)); p.push(``); }
  if (blindSpots) { p.push(cap(blindSpots, 700)); p.push(``); }
  if (weeklyReview) { p.push(cap(weeklyReview, 800)); p.push(``); }

  // Strategy (when strategic)
  if (strategicPlan) { p.push(cap(strategicPlan, 1000)); p.push(``); }
  if (counterIntuitive) { p.push(cap(counterIntuitive, 700)); p.push(``); }
  if (graphSummary) { p.push(cap(graphSummary, 700)); p.push(``); }
  if (thinkingContext) { p.push(cap(thinkingContext, 800)); p.push(``); }
  if (correlations) { p.push(cap(correlations, 700)); p.push(``); }
  if (realityGap) { p.push(cap(realityGap, 500)); p.push(``); }

  // Personal (when personal)
  if (emotionalArc) { p.push(cap(emotionalArc, 700)); p.push(``); }
  if (learningVelocity) { p.push(cap(learningVelocity, 600)); p.push(``); }
  if (attention) { p.push(cap(attention, 600)); p.push(``); }
  if (journal) { p.push(cap(journal, 700)); p.push(``); }
  if (teachingMoments) { p.push(cap(teachingMoments, 700)); p.push(``); }
  if (maturity) { p.push(cap(maturity, 500)); p.push(``); }

  // Oversight (when business tier)
  if (predictions) { p.push(cap(predictions, 700)); p.push(``); }
  if (accuracy) { p.push(cap(accuracy, 600)); p.push(``); }

  // Reference (full mode only)
  if (chatgptInsights) { p.push(cap(chatgptInsights, 700)); p.push(``); }
  if (peopleIntel) { p.push(cap(peopleIntel, 700)); p.push(``); }
  if (timeIntel) { p.push(cap(timeIntel, 600)); p.push(``); }

  // Strategic philosophy (~10kc Machiavelli/Greene/Mastery framework).
  // Apr 28 · intent-gated — only loads when the user message uses
  // strategic-thinking language. Loading 10kc on every business
  // question was wasting Venice's budget.
  const STRATEGIC_INTENT_RE = /\b(strategy|strategic|plan|planning|decision|long.?term|leverage|philosophy|machiavelli|greene|mastery|principle|framework|long\s+game|compound|second.?order)\b/i;
  if ((tier === "strategy" || tier === "full") && STRATEGIC_INTENT_RE.test(userMessage || "")) {
    p.push(STRATEGIC_MIND);
    p.push(``);
  }

  // ═══════════════════════════════════════════════════════════════
  // SECTION 9: CONVERSATION CONTEXT + DEVICES + PINNED + HOT RULES
  // ═══════════════════════════════════════════════════════════════
  //
  // MEMORY STRATEGY (Apr 15 — cold memory refactor):
  // The top memory dump used to inline 20 memories (~3-5K chars).
  // With the corpus at 2000+ memories and Venice's 50K ceiling, most
  // of the corpus was silently truncated mid-sentence.
  //
  // New approach: only PRIORITY memories inline (identity, feedback,
  // brand_rules, business_context) — the hard rules Nick must never
  // ignore. Everything else is accessible via searchColdMemory tool.
  // Cuts ~30% off the prompt; entire corpus searchable on demand.
  //
  // v11.1 tier-aware loading — shaves ~4 DB hits + 2 remote calls off
  // casual "hey" messages. Tier gates:
  //   · SmartDevice list      → full only
  //   · AutomationRule list   → strategy/full
  //   · Market intelligence   → business/full
  //   · Page-visit intel      → always (cheap)
  //   · Continuity summary    → always (memory-bridge baseline)
  //   · Pinned + top memories → always (hard rules)
  const loadDevices = tier === "full";
  const loadAutomationRules = tier === "strategy" || tier === "full";
  const loadMarketIntel = tier === "business" || tier === "full";

  const [conversationContext, devices, topMemories, automationRulesData, recentSyncsData, pageIntelData, marketIntelData, continuityData, chatPattern, pinnedMemories] = await Promise.all([
    getRecentConversationContext(5).catch((): string => ""),
    loadDevices
      ? prisma.smartDevice.findMany({ where: { status: "ONLINE" }, select: { name: true, deviceType: true, platform: true, location: true, lastSeenAt: true }, take: 15 }).catch((): never[] => [])
      : Promise.resolve([] as never[]),
    prisma.brainMemory.findMany({
      where: {
        confidence: { gte: 0.5 },
        // Only hard-rule categories that MUST stay in the hot prompt.
        category: { in: ["identity", "feedback", "brand_rules", "business_context"] },
        deletedAt: null, // v7.9
      },
      orderBy: { confidence: "desc" },
      select: { category: true, key: true, content: true, confidence: true },
      take: 24,
    }).catch((): never[] => []),
    loadAutomationRules
      ? prisma.automationRule.findMany({ where: { enabled: true }, select: { name: true, trigger: true, lastFired: true }, take: 8 }).catch((): never[] => [])
      : Promise.resolve([] as never[]),
    // v10.0.59 · recentSyncsData → AuditEvent eventType=sync_run rows.
    // Projected to the legacy {integrationId, status, recordsIn,
    // recordsOut} shape so the formatter doesn't need refactor.
    prisma.auditEvent
      .findMany({
        where: { eventType: { in: ["sync_run", "ingest_complete"] } },
        orderBy: { createdAt: "desc" },
        take: 5,
        select: { actor: true, detail: true, createdAt: true, payload: true },
      })
      .then((rows) =>
        rows.map((r) => {
          const p = (r.payload as Record<string, unknown>) ?? {};
          return {
            createdAt: r.createdAt,
            integrationId: r.actor,
            status:
              typeof p.status === "string" ? p.status : (p.actionsCreated ? "ok" : "ok"),
            recordsIn:
              typeof p.itemCount === "number"
                ? p.itemCount
                : typeof p.recordsIn === "number"
                  ? p.recordsIn
                  : 0,
            recordsOut:
              typeof p.recordsOut === "number"
                ? p.recordsOut
                : (typeof p.memoriesCreated === "number" ? p.memoriesCreated : 0) +
                  (typeof p.leadsCreated === "number" ? p.leadsCreated : 0) +
                  (typeof p.actionsCreated === "number" ? p.actionsCreated : 0),
          };
        }),
      )
      .catch((): Array<{
        createdAt: Date;
        integrationId: string;
        status: string;
        recordsIn: number;
        recordsOut: number;
      }> => []),
    getPageVisitIntelligence().catch((): string => ""),
    loadMarketIntel
      ? getMarketIntelligence().catch((): string => "")
      : Promise.resolve(""),
    getBrainContinuitySummary().catch((): string => ""),
    // Chat personality learning — set by the chat route every 10th message.
    prisma.brainMemory.findUnique({
      where: { category_key: { category: BRAIN_CATEGORIES.CHAT_PATTERN, key: "latest_session" } },
      select: { content: true, updatedAt: true },
    }).catch((): null => null),
    // Nour's pinned context slots — user-controlled permanent memory.
    // Up to 15 candidates; ranker picks the best 5 by label × recency
    // × reinforce × source within a 1200-char budget.
    prisma.brainMemory.findMany({
      where: { category: BRAIN_CATEGORIES.PINNED_USER, deletedAt: null }, // v7.9
      orderBy: { updatedAt: "desc" },
      select: {
        key: true,
        content: true,
        metadata: true,
        seenCount: true,
        updatedAt: true,
        source: true,
      },
      take: 15,
    }).catch((): never[] => []),
  ]);

  // Chat personality DNA adaptations.
  p.push(...renderChatPatternAdaptations({ chatPattern }));

  if (conversationContext) {
    p.push(cap(conversationContext, 800));
    p.push(``);
  } else {
    // Apr 28 · Cut from 5 chats × 150ch (~800ch) to 3 × 100ch (~330ch)
    const recentChats = await prisma.chatMessage.findMany({
      where: { role: "user" }, orderBy: { createdAt: "desc" }, select: { content: true, createdAt: true }, take: 3,
    }).catch((): never[] => []);
    p.push(...renderRecentChatsFallback({ recentChats }));
  }

  p.push(...renderSmartDevicesSummary({ devices }));

  // ── Pinned by Nour (ranked + budget-aware) ──
  p.push(...renderPinnedMemories({ pinnedMemories }));

  // ── Hot rules ──
  p.push(...renderHotRules({ topMemories }));

  // ── Automation rules + syncs ──
  p.push(...renderAutomationRules({ automationRulesData }));
  p.push(...renderIntegrationSyncs({ recentSyncsData }));

  // ── AI Tools health (counts only; full list comes via tool schema) ──
  const arsenalStats = getRegistryStats();
  p.push(...renderAiToolsHealth({
    arsenalStats,
    pendingCount: getPendingTools().length,
  }));

  // Page/market/continuity — capped tighter (was 800 each, now 500/600).
  if (pageIntelData) { p.push(cap(pageIntelData, 500)); p.push(``); }
  if (marketIntelData) { p.push(cap(marketIntelData, 500)); p.push(``); }
  if (continuityData) { p.push(cap(continuityData, 600)); p.push(``); }

  // ═══════════════════════════════════════════════════════════════
  // SECTION 10: TAIL ADDENDA (preference inference + persona anchor
  //              + tool-result fencing rule)
  // ═══════════════════════════════════════════════════════════════
  //
  // v10.0.526 · Arc B Feature 1 · Preference Inference Engine
  // Appended last so a strong axis tell takes precedence over the
  // generic voice block above without changing the rest of the
  // prompt's structure. Empty string when the vector is neutral
  // (|v| < 0.15 across every axis) — costs nothing for new users.
  try {
    const { loadPreferenceVector, buildSystemPromptAddendum } = await import(
      "@/lib/brain/preference-inference"
    );
    const vec = await loadPreferenceVector();
    const addendum = buildSystemPromptAddendum(vec);
    if (addendum) {
      p.push(addendum);
      p.push(``);
    }
  } catch {
    // Inference is best-effort · never block the prompt on a failed
    // OperatorPreference read.
  }

  // v10.0.529.36 · Arc B F4 Phase 2 · persona-anchor pre-emptive
  // injection. The 8-axis identity_snapshot gets rendered as a
  // ground-truth block so Nick's reply emerges already aligned to
  // the operator's stated self-model rather than relying on
  // post-process regeneration when drift is detected. The drift
  // detector continues to scan post-hoc (`/api/cron/persona-drift`)
  // to catch alignment failures, but the anchor reduces detected
  // drift over time. Cached 5min in the detector module · cheap.
  try {
    const { getPersonaAnchorPrompt } = await import(
      "@/lib/brain/persona-drift-detector"
    );
    const anchor = await getPersonaAnchorPrompt();
    if (anchor) {
      p.push(anchor);
      p.push(``);
    }
  } catch {
    // Anchor is best-effort · never block the prompt on a failed
    // identity_snapshot read.
  }

  // v10.0.529.5 E-3 · prompt-injection defense · tool-result fencing rule.
  // Cheap (≈170 tokens) · universally applicable · pairs with the
  // fenceContent() wraps shipped in lib/ai/tools.ts for searchDocuments,
  // searchWebVerified, findRelatedConversations. Tells the model to treat
  // <tool_data> regions as data, not instructions. Static import is fine
  // (the constant is a pure string).
  try {
    const { TOOL_DATA_FENCING_RULE } = await import(
      "@/lib/ai/tool-result-fencing"
    );
    p.push(TOOL_DATA_FENCING_RULE);
    p.push(``);
  } catch {
    // Module shouldn't fail to load · this is belt-and-suspenders.
  }

  // Wave AH Phase 1 · 2026-05-28 · contextual Greene corpus injection.
  // Sam audit said the 144-entry Wave Z Greene corpus is one of the most
  // underused assets — sat in BrainMemory powering only the /relationships
  // sidebar. Every chat turn about strategy / power / decisions / leverage
  // / relationships SHOULD have Nick reaching into the corpus.
  //
  // Deterministic keyword match · sub-millisecond once the corpus is
  // module-cached (10min TTL). Self-gates: returns [] when the message
  // doesn't trip enough triggers · zero cost for casual chat. Capped at 3
  // matches · ~600 chars max injection vs the ~30K prompt baseline.
  //
  // Loaded dynamically so a Greene matcher fault never blocks the
  // prompt path (defense-in-depth · the matcher itself returns [] on
  // failure but the import boundary adds another guard).
  if (userMessage && userMessage.trim().length > 0) {
    try {
      const { pickContextualLawsForMessage, renderGreeneBlock } = await import(
        "@/lib/ai/greene-message-matcher"
      );
      const picks = await pickContextualLawsForMessage(userMessage);
      const block = renderGreeneBlock(picks);
      if (block) {
        p.push(block);
        p.push(``);
      }
    } catch {
      // Best-effort · matcher failures must never poison the prompt.
    }
  }

  return p.join("\n");
}
