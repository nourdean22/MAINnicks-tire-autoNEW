/**
 * auto-learn LLM classifier · Wave 22.1 (v10.0.529.78) · A from the
 * A+B+C combo. Fire-and-forget enrichment of BrainMemory(task_insight)
 * rows that the regex-based pass creates.
 *
 * Design decisions (the 5 questions answered):
 *
 *   1. SYNC vs ASYNC — async fire-and-forget. The toast stays fast;
 *      the AI call runs in the background and updates the same
 *      BrainMemory row with a sharper one-liner + structured metadata.
 *      Next time /brain or /chat surfaces that memory, it carries the
 *      AI's read.
 *
 *   2. WHICH MODEL — Venice (primary) via the existing
 *      createStructuredAiResponse helper, which itself routes through
 *      Venice → OpenAI → Anthropic fallback. Matches the codebase's
 *      Venice + Ollama co-1st routing called out in CLAUDE.md.
 *
 *   3. BUDGET GATE — 100 calls/hour, 500/day. Tracked in a BrainMemory
 *      ledger (category="auto_learn_budget", key="hourly" / "daily").
 *      Skip the LLM call when cap is hit · log a warning so operator
 *      sees it.
 *
 *   4. DEDUP — 5-min in-memory LRU keyed by task title slug. 5 rapid
 *      completes of similar tasks = 1 LLM call. Survives across calls
 *      within the same Node process.
 *
 *   5. SCHEMA — reuse BrainMemory.metadata: Json? · zero migration.
 *      Shape: { axis, lesson, wisdom_query, confidence, model, ms }.
 *
 * Result shape:
 *   {
 *     axis:        "velocity" | "patience_horizon" | … | null
 *     lesson:      "1-sentence what to remember" (becomes new content)
 *     wisdomQuery: "short search string for next wisdom match"
 *     confidence:  0-1
 *   }
 */

import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { createStructuredAiResponse, AiUnavailableError } from "@/lib/ai/structured";
import { getActiveProviderInfo } from "@/lib/ai/provider";
import { today } from "@/lib/utils/datetime";
import { storeMemoryEmbedding } from "@/lib/brain/embedding-utils";

const log = logger.withSurface("auto-learn-llm");

// ─── BUDGET CAPS ────────────────────────────────────────────────

const HOURLY_CAP = 100;
const DAILY_CAP = 500;

// ─── DEDUP LRU ──────────────────────────────────────────────────

const DEDUP_TTL_MS = 5 * 60 * 1000;

/**
 * v10.0.529.84 · Wave 28 · A4/C1 · DB-backed dedup.
 *
 * The original in-process LRU Map was broken on Vercel · serverless
 * functions get a fresh module scope per cold start so the 5-min
 * window never actually held entries between invocations. Per the
 * audit, dedup-via-DB matches the same pattern the budget ledger
 * already uses (BrainMemory rows with expiresAt). Adds 1 DB query
 * per enrichment call · acceptable for async fire-and-forget path.
 *
 * Returns true when the slug fired within the last DEDUP_TTL_MS ·
 * meaning the LLM call should be skipped. Returns false otherwise
 * AND records the slug for the next 5 min.
 */
async function dedupCheckAndMark(slug: string): Promise<boolean> {
  const key = `dedup:${slug}`;
  const now = new Date();

  const existing = await prisma.brainMemory
    .findUnique({
      where: { category_key: { category: "auto_learn_dedup", key } },
      select: { expiresAt: true, deletedAt: true },
    })
    .catch(() => null);

  if (existing && existing.deletedAt === null && existing.expiresAt && existing.expiresAt > now) {
    return true; // still in window · skip
  }

  // Either no row, expired row, or soft-deleted row · mark fresh.
  await prisma.brainMemory
    .upsert({
      where: { category_key: { category: "auto_learn_dedup", key } },
      create: {
        category: "auto_learn_dedup",
        key,
        content: slug,
        confidence: 1.0,
        source: "auto-learn-llm:dedup",
        createdBy: "system:auto-learn-llm",
        expiresAt: new Date(now.getTime() + DEDUP_TTL_MS),
      },
      update: {
        expiresAt: new Date(now.getTime() + DEDUP_TTL_MS),
        deletedAt: null,
        lastSeen: now,
      },
    })
    .catch(() => null);

  return false;
}

// ─── BUDGET LEDGER (BrainMemory-backed) ─────────────────────────

interface BudgetRow {
  count: number;
  windowKey: string; // e.g. "2026-05-15-14" for hour, "2026-05-15" for day
}

/**
 * Read + increment a BrainMemory budget row. Returns false if cap
 * would be exceeded · true if increment succeeded. Idempotent-ish ·
 * tracks a single counter per window so concurrent calls may race
 * by 1-2 over the cap · acceptable for a soft guard.
 */
async function consumeBudget(scope: "hourly" | "daily", cap: number): Promise<boolean> {
  const now = new Date();
  const windowKey =
    scope === "hourly"
      ? `${today()}-${String(now.getHours()).padStart(2, "0")}`
      : today();
  const key = `${scope}:${windowKey}`;

  const existing = await prisma.brainMemory.findUnique({
    where: { category_key: { category: "auto_learn_budget", key } },
    select: { content: true },
  });

  let count = 0;
  if (existing) {
    try {
      const row = JSON.parse(existing.content) as BudgetRow;
      count = row.count ?? 0;
    } catch {
      count = 0;
    }
  }

  if (count >= cap) return false;

  await prisma.brainMemory.upsert({
    where: { category_key: { category: "auto_learn_budget", key } },
    create: {
      category: "auto_learn_budget",
      key,
      content: JSON.stringify({ count: 1, windowKey }),
      confidence: 1.0,
      source: "auto-learn-llm:budget",
      createdBy: "system:auto-learn-llm",
      // 36h TTL · auto-cleans without a cron.
      expiresAt: new Date(now.getTime() + 36 * 60 * 60 * 1000),
    },
    update: {
      content: JSON.stringify({ count: count + 1, windowKey }),
      lastSeen: now,
      seenCount: { increment: 1 },
    },
  });

  return true;
}

// ─── LLM CALL ──────────────────────────────────────────────────

interface ClassifierResult {
  axis: string | null;
  lesson: string | null;
  wisdomQuery: string | null;
  confidence: number;
}

const CLASSIFIER_SCHEMA = {
  type: "object",
  properties: {
    axis: {
      type: ["string", "null"],
      enum: [
        "velocity",
        "patience_horizon",
        "promise_integrity",
        "dopamine_discipline",
        "business_vs_personal",
        "risk_appetite",
        "social_battery",
        "reflection_cadence",
        null,
      ],
      description:
        "Which 8-axis identity dimension this task most plausibly lifted, or null if none.",
    },
    lesson: {
      type: ["string", "null"],
      description:
        "1-sentence operator-grade takeaway from this task. Plain English, ≤ 140 chars. Null if nothing notable was learned.",
    },
    wisdom_query: {
      type: ["string", "null"],
      description:
        "Short search query (3-6 words) for finding matching wisdom principles next time. Null if not applicable.",
    },
    confidence: {
      type: "number",
      minimum: 0,
      maximum: 1,
      description: "Overall confidence in this classification, 0-1.",
    },
  },
  required: ["axis", "lesson", "wisdom_query", "confidence"],
};

interface ClassifierInput {
  taskTitle: string;
  finishCondition: string | null;
  missionTitle: string | null;
  missionDomain: string | null;
  outcomeScore?: number | null;
  completionNote?: string | null;
}

async function classifyWithLLM(input: ClassifierInput): Promise<ClassifierResult | null> {
  const systemPrompt = `You read a completed task along with its completion outcome (score and note) and extract one operator-grade insight from it.

You write for Nour Dean · he runs a tire shop + builds his own personal OS. He's a high-velocity operator who values brevity and signal over noise. Match his tone: lowercase · plain English · no jargon · no AI clichés.

If an outcome score and/or completion note are provided, pay close attention to the execution quality:
  - An outcome score close to 100 or positive note indicates a successful, high-leverage execution.
  - A low outcome score (e.g. < 60) or a note detailing friction (e.g. distraction, delays, complications) indicates friction. Reflect this friction in the lesson to help the operator learn from the mistake or prevent it next time.

Output strict JSON. Be conservative with confidence — only ≥0.7 when the task content really does carry a learning.

The 8 identity axes:
  · velocity — speed of execution
  · patience_horizon — long-term vs short-term thinking
  · promise_integrity — keeps what they commit to
  · dopamine_discipline — resists quick hits
  · business_vs_personal — context-switching cost
  · risk_appetite — willingness to bet
  · social_battery — energy for people
  · reflection_cadence — frequency of looking back`;

  const userPrompt = `Task title: ${input.taskTitle}
Finish condition: ${input.finishCondition ?? "(none)"}
Mission: ${input.missionTitle ?? "(none)"}
Domain: ${input.missionDomain ?? "(none)"}
Outcome score: ${input.outcomeScore != null ? input.outcomeScore : "(none)"}
Completion note: ${input.completionNote != null ? input.completionNote : "(none)"}`;

  try {
    const result = await createStructuredAiResponse<{
      axis: string | null;
      lesson: string | null;
      wisdom_query: string | null;
      confidence: number;
    }>({
      systemPrompt,
      userPrompt,
      schemaName: "task_insight_classification",
      schema: CLASSIFIER_SCHEMA,
    });
    return {
      axis: result.axis,
      lesson: result.lesson,
      wisdomQuery: result.wisdom_query,
      confidence: typeof result.confidence === "number" ? result.confidence : 0,
    };
  } catch (err) {
    if (err instanceof AiUnavailableError) {
      // Expected · provider chain failed. Don't log full stack.
      log.warn("llm_unavailable", { code: err.code });
    } else {
      log.warn("llm_call_failed", {
        error: err instanceof Error ? err.message.slice(0, 200) : String(err),
      });
    }
    return null;
  }
}

// ─── ENTRY POINT · FIRE-AND-FORGET ─────────────────────────────

interface EnrichArgs {
  brainMemoryKey: string;
  /** v10.0.529.81 · Wave 25 · row id needed so the post-enrich
   *  embedding pipeline can target this specific brain_memory.
   *  Optional for backward compat · embedding skipped if missing. */
  brainMemoryId?: string;
  task: ClassifierInput;
}

/**
 * Async-enrich a BrainMemory(task_insight) row with LLM-generated
 * lesson + axis + wisdom_query + confidence. Caller invokes via
 * `void enrichInsightAsync(...)` · zero blocking on task complete.
 *
 * Returns nothing · failure modes are logged but not surfaced.
 */
export async function enrichInsightAsync(args: EnrichArgs): Promise<void> {
  const slug = args.brainMemoryKey;

  // ─── Dedup gate ───
  if (await dedupCheckAndMark(slug)) {
    return; // recently classified · skip
  }

  // ─── Budget gates ───
  const hourlyOk = await consumeBudget("hourly", HOURLY_CAP).catch((err) => {
    // 2026-05-30 · fail-SAFE, not fail-open. A throwing budget gate (e.g. DB
    // down) must BLOCK enrichment, never wave it through — a broken cap that
    // returns `true` is an uncapped LLM spigot on every task-complete. One
    // skipped background enrichment is cheap; runaway spend is not.
    log.warn("budget_gate_check_failed", {
      window: "hourly",
      cap: HOURLY_CAP,
      slug,
      error: err instanceof Error ? err.message.slice(0, 120) : String(err),
    });
    return false;
  });
  if (!hourlyOk) {
    log.warn("budget_hourly_exceeded", { cap: HOURLY_CAP, slug });
    return;
  }
  const dailyOk = await consumeBudget("daily", DAILY_CAP).catch((err) => {
    // 2026-05-30 · fail-SAFE (see hourly gate above).
    log.warn("budget_gate_check_failed", {
      window: "daily",
      cap: DAILY_CAP,
      slug,
      error: err instanceof Error ? err.message.slice(0, 120) : String(err),
    });
    return false;
  });
  if (!dailyOk) {
    log.warn("budget_daily_exceeded", { cap: DAILY_CAP, slug });
    return;
  }

  // ─── LLM call ───
  const startedAt = Date.now();
  const result = await classifyWithLLM(args.task);
  const elapsedMs = Date.now() - startedAt;
  if (!result) return;

  // ─── Persist ───
  const { provider, modelId } = getActiveProviderInfo();
  const newContent = result.lesson ?? args.task.taskTitle; // fallback to title
  const metadata = {
    axis: result.axis,
    lesson: result.lesson,
    wisdom_query: result.wisdomQuery,
    confidence: result.confidence,
    model: `${provider}:${modelId}`,
    ms: elapsedMs,
    enriched_at: new Date().toISOString(),
    outcomeScore: args.task.outcomeScore ?? null,
    completionNote: args.task.completionNote ?? null,
  };

  try {
    await prisma.brainMemory.update({
      where: { category_key: { category: "task_insight", key: slug } },
      data: {
        content: newContent,
        // Lift confidence to reflect LLM-validated insight (capped at
        // 0.95 · only operator-curated rows hit 1.0).
        confidence: Math.max(0.7, Math.min(0.95, result.confidence)),
        metadata,
        lastSeen: new Date(),
      },
    });
  } catch (err) {
    // Row might have been deleted between create + enrich · acceptable.
    log.warn("brain_memory_update_failed", {
      slug,
      error: err instanceof Error ? err.message.slice(0, 200) : String(err),
    });
  }

  // v10.0.529.81 · Wave 25 · re-embed with the enriched (richer)
  // content so future semanticSearch surfaces match the LLM's read
  // rather than the regex's raw title. Fire-and-forget · failure is
  // non-fatal (auto-learn.ts already embedded the basic content
  // earlier, so semanticSearch still works on the pre-enrichment
  // vector even if this rewrite fails).
  if (args.brainMemoryId) {
    void storeMemoryEmbedding(args.brainMemoryId, newContent).catch(() => {
      /* embedding rewrite is best-effort */
    });
  }
}
