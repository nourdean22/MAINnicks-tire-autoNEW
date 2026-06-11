/**
 * auto-learn · Wave 22 (v10.0.529.77) · the "do tasks → grow" loop · v2.
 *
 * Fires after a Task transitions to DONE. Cross-engine propagation
 * across 3 engines (Mastery · Knowledge · Learn) + wisdom citation.
 *
 * v22 upgrade over v21:
 *   1. ADAPTIVE SCORING · MasteryScore bump is no longer flat 0.5 ·
 *      formula uses task.roiScore × effortBand × goalLinkage × streak.
 *      Range: 0.1 (low-ROI low-effort orphan) → 2.4 (high-ROI long
 *      effort + goal-linked + 14-day streak). Rewards intentional,
 *      high-leverage work.
 *   2. WISDOM CITATION · keyword-Jaccard match against
 *      BrainMemory(category="wisdom") with persona boost (mirrors
 *      decision-replay-coach.ts pattern). Toast carries the wisdom
 *      principle that fits the task. Compounds the 991+ wisdom
 *      corpus into the daily flow.
 *   3. KNOWLEDGE HEURISTIC kept narrow · regex stays for low-cost
 *      filter. Future v23 could route to a Nick call for richer
 *      classification · v22 is "smart math + smart recall, dumb
 *      classification" by design (keeps Wave 22 server-side, no LLM
 *      call per complete).
 *
 * Skills applied:
 *   · data-engineer · adaptive scoring formula uses fields the task
 *     model already captures (roiScore · effort · streakCount · goalId)
 *   · satori · pgvector-free wisdom matching with persona boost
 *   · vector-database-engineer · token Jaccard is the cheap-first-pass;
 *     pgvector embedding can be a future v23 upgrade
 *   · database-architect · zero schema changes · all writes use
 *     existing tables · idempotent per (date, domain) for mastery
 *   · ux-flow · the toast becomes a meaningful operator-grade signal
 *     ("+1.4 → business 64/100 · Buffett: invest in yourself")
 *   · error-handling-patterns · per-engine graceful failure · task
 *     completion never blocks on auto-learn or wisdom failures
 */

import { prisma } from "@/lib/prisma";
import { today } from "@/lib/utils/datetime";
import { logger } from "@/lib/logger";
import { enrichInsightAsync } from "@/lib/services/auto-learn-llm";
import { recordGhostOutcome } from "@/lib/brain/ghost-nick";
import { semanticSearch, storeMemoryEmbedding } from "@/lib/brain/embedding-utils";
import {
  matchWisdom,
  extractKeywords,
  isPreferredPersonaKey,
  personaFromKey,
} from "@/lib/brain/wisdom-match";
// 2026-06-01 · adaptive-bump constants centralized in scoring-config so the
// 0-100 domain bump (here) and the character-sheet stat XP (creditTaskStats)
// share one tunable source. Values are identical to the prior local copies.
import {
  BASE_BUMP,
  MIN_BUMP,
  MAX_BUMP,
  EFFORT_MULTIPLIER,
  GOAL_LINKED_MULTIPLIER,
  streakMultiplier,
} from "@/lib/mastery/scoring-config";

const log = logger.withSurface("auto-learn");

// ─── KNOWLEDGE / LEARN PATTERNS (unchanged from v21) ──────────────

const LEARNING_VERB_PATTERN =
  /\b(learn(ed|ing)?|research(ed|ing)?|read|watched|stud(y|ied|ying)|discovered|figured out|understood|grokked|practiced)\b/i;

const TUTORIAL_PREFIX_PATTERN = /^(tutorial|lesson|learn|study|course)\s*[:\-—]\s*/i;

// ─── WISDOM-MATCH ─────────────────────────────────────────────────
// Jaccard matching loop + helpers (extractKeywords/isPreferredPersonaKey/
// personaFromKey) now live in lib/brain/wisdom-match.ts, shared with
// decision-replay-coach.ts. These constants are auto-learn's OWN tuned
// values, passed into the shared matchWisdom(). STOPWORDS = the shared
// DEFAULT_WISDOM_STOPWORDS (identical set), so it's omitted here.

const WISDOM_SCAN_LIMIT = 1500;
const WISDOM_SIM_FLOOR = 0.25;
const PREFERRED_PERSONAS = ["munger", "naval", "buffett", "greene", "jobs", "satori"];

// ─── TYPES ──────────────────────────────────────────────────────

export interface WisdomCitation {
  persona: string | null;
  key: string;
  content: string;
  score: number;
}

export interface GhostOutcome {
  /** True if this task was on the current prediction bundle. */
  predicted: boolean;
  /** Rolling accuracy snapshot · % integer (0-100) for toast display. */
  accuracyPct: number;
  hits: number;
  surprises: number;
}

export interface AutoLearnReport {
  mastery: { domain: string; score: number; delta: number; date: string } | null;
  knowledge: { key: string; content: string } | null;
  learn: { slug: string; missionTitle: string | null } | null;
  /** v22 · wisdom principle that matched this task best · null if no
   *  citation cleared the sim floor. */
  wisdom: WisdomCitation | null;
  /** v23 · Ghost Nick prediction outcome · null when no current
   *  prediction bundle exists or the task fell outside its horizon. */
  ghost: GhostOutcome | null;
}

interface AutoLearnTaskShape {
  title: string;
  finishCondition: string | null;
  mission: { title: string | null; domain: string | null } | null;
  goal: { domain: string | null } | null;
  /** v22 · adaptive-scoring inputs · all optional with sensible defaults
   *  so callers from older paths don't break. */
  roiScore?: number | null;
  effort?: string | null;
  loopKind?: string | null;
  streakCount?: number | null;
  hasGoalId?: boolean | null;
  outcomeScore?: number | null;
  completionNote?: string | null;
}

interface AutoLearnArgs {
  taskId: string;
  task: AutoLearnTaskShape;
}

const EMPTY: AutoLearnReport = {
  mastery: null,
  knowledge: null,
  learn: null,
  wisdom: null,
  ghost: null,
};

// ─── PUBLIC ENTRY ────────────────────────────────────────────────

export async function runAutoLearn(args: AutoLearnArgs): Promise<AutoLearnReport> {
  const report: AutoLearnReport = { ...EMPTY };

  try {
    report.mastery = await tryMasteryLift(args);
  } catch (err) {
    log.warn("mastery_lift_failed", {
      taskId: args.taskId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  try {
    report.knowledge = await tryKnowledgeCapture(args);
  } catch (err) {
    log.warn("knowledge_capture_failed", {
      taskId: args.taskId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  try {
    report.learn = await tryLearnComplete(args);
  } catch (err) {
    log.warn("learn_complete_failed", {
      taskId: args.taskId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // v22 · only run wisdom citation when ANY of the 3 engines fired ·
  // wisdom on a "nothing happened" task is noise.
  if (report.mastery || report.knowledge || report.learn) {
    try {
      report.wisdom = await tryWisdomCitation(args);
    } catch (err) {
      log.warn("wisdom_citation_failed", {
        taskId: args.taskId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // v23 · #5 · Ghost Nick outcome. Always run (independent of the
  // other engines) so we capture surprise predictions (operator did
  // something Ghost didn't see). Returns null when no current
  // prediction bundle exists or the task fell outside its horizon.
  try {
    const ghost = await recordGhostOutcome(args.taskId, args.task.title);
    if (ghost) {
      const total = ghost.accuracy.hits + ghost.accuracy.surprises;
      const accuracyPct =
        total > 0 ? Math.round((ghost.accuracy.hits / total) * 100) : 0;
      report.ghost = {
        predicted: ghost.predicted,
        accuracyPct,
        hits: ghost.accuracy.hits,
        surprises: ghost.accuracy.surprises,
      };
    }
  } catch (err) {
    log.warn("ghost_outcome_failed", {
      taskId: args.taskId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return report;
}

// ─── A · ADAPTIVE SCORING HELPER ────────────────────────────────

/**
 * Compute the adaptive mastery bump for a completed task.
 * Formula: BASE × roiWeight × effortMultiplier × goalLinkage × streak
 *
 * Bounded between MIN_BUMP and MAX_BUMP. Returned as a number rounded
 * to 1 decimal place so the score column doesn't accumulate float noise.
 */
function computeAdaptiveBump(task: AutoLearnTaskShape): number {
  const roiWeight = Math.max(0.3, Math.min(1.0, (task.roiScore ?? 50) / 100));
  const effortMult = EFFORT_MULTIPLIER[task.effort ?? "M30"] ?? 1.0;
  const goalMult = task.hasGoalId ? GOAL_LINKED_MULTIPLIER : 1.0;
  const streakMult = streakMultiplier(task.streakCount ?? 0, task.loopKind ?? "ONCE");
  const raw = BASE_BUMP * roiWeight * effortMult * goalMult * streakMult;
  const bounded = Math.max(MIN_BUMP, Math.min(MAX_BUMP, raw));
  return Math.round(bounded * 10) / 10;
}

// ─── ENGINE 1 · MASTERY ─────────────────────────────────────────

async function tryMasteryLift({
  task,
}: AutoLearnArgs): Promise<AutoLearnReport["mastery"]> {
  const domain = task.mission?.domain || task.goal?.domain;
  if (!domain) return null;

  const date = today();
  const bump = computeAdaptiveBump(task);

  // v22 · still respect the (date, domain) idempotency so repeat
  // check-offs on the same DAILY don't multi-bump the same day.
  const prev = await prisma.masteryScore.findUnique({
    where: { date_domain: { date, domain } },
    select: { score: true },
  });

  const priorScore = prev?.score ?? (await loadLatestScore(domain));
  const nextScore = Math.min(100, Math.round((priorScore + bump) * 10) / 10);
  const delta = Math.round((nextScore - priorScore) * 10) / 10;

  if (delta <= 0) return null;

  await prisma.masteryScore.upsert({
    where: { date_domain: { date, domain } },
    create: {
      date,
      domain,
      score: nextScore,
      evidence: task.title,
      delta,
    },
    update: {
      score: nextScore,
      evidence: appendEvidence(prev ? null : task.title, task.title),
      delta,
    },
  });

  return { domain, score: nextScore, delta, date };
}

async function loadLatestScore(domain: string): Promise<number> {
  const row = await prisma.masteryScore.findFirst({
    where: { domain },
    orderBy: { date: "desc" },
    select: { score: true },
  });
  return row?.score ?? 50;
}

function appendEvidence(existing: string | null, addition: string): string {
  if (!existing) return addition.slice(0, 240);
  const next = `${existing} · ${addition}`;
  return next.length > 240 ? next.slice(-240) : next;
}

// ─── ENGINE 2 · KNOWLEDGE ──────────────────────────────────────

async function tryKnowledgeCapture({
  task,
}: AutoLearnArgs): Promise<AutoLearnReport["knowledge"]> {
  const haystack = `${task.title} ${task.finishCondition ?? ""}`.trim();
  if (!LEARNING_VERB_PATTERN.test(haystack)) return null;

  const key = `task_insight:${slugify(task.title)}`;
  const content = task.title;

  // v10.0.529.81 · Wave 25 · upsert + capture id so we can fire the
  // embedding pipeline after the row exists. embedding lands in
  // vector_embeddings · pgvector index makes wisdom + pattern
  // cosine queries cheap thereafter.
  const row = await prisma.brainMemory.upsert({
    where: { category_key: { category: "task_insight", key } },
    create: {
      category: "task_insight",
      key,
      content,
      confidence: 0.7,
      source: "auto-learn:task-complete",
      createdBy: "system:auto-learn",
    },
    update: {
      content,
      lastSeen: new Date(),
      seenCount: { increment: 1 },
    },
    select: { id: true },
  });

  // v10.0.529.78 · Wave 22.1 · fire-and-forget LLM enrichment.
  // v10.0.529.81 · Wave 25 · enrichment now ALSO writes the row's
  // embedding via storeMemoryEmbedding so pgvector queries surface
  // it. Pre-Wave-25 wisdom-citation + pattern-clusterer used
  // keyword-Jaccard · post-Wave-25 they use cosine on pgvector.
  void enrichInsightAsync({
    brainMemoryKey: key,
    brainMemoryId: row.id,
    task: {
      taskTitle: task.title,
      finishCondition: task.finishCondition,
      missionTitle: task.mission?.title ?? null,
      missionDomain: task.mission?.domain ?? null,
      outcomeScore: task.outcomeScore ?? null,
      completionNote: task.completionNote ?? null,
    },
  });

  // v10.0.529.81 · Wave 25 · embed the basic content now so future
  // semanticSearch calls have something to match against even before
  // the LLM enrichment lands (which can take 1-3s).
  void storeMemoryEmbedding(row.id, content).catch(() => {
    /* embedding failure non-fatal · the enrichInsightAsync path
       also rewrites this embedding once the lesson is sharper */
  });

  return { key, content };
}

// ─── ENGINE 3 · LEARN ──────────────────────────────────────────

async function tryLearnComplete({
  task,
}: AutoLearnArgs): Promise<AutoLearnReport["learn"]> {
  const titleHit = TUTORIAL_PREFIX_PATTERN.test(task.title);
  const missionHit = /(^|\s)(learn|study|course)\s/i.test(task.mission?.title ?? "");
  if (!titleHit && !missionHit) return null;

  const slug = slugify(task.title);
  if (!slug) return null;

  const key = `learn_complete:${slug}`;
  const content = task.title;

  await prisma.brainMemory.upsert({
    where: { category_key: { category: "learn_complete", key } },
    create: {
      category: "learn_complete",
      key,
      content,
      confidence: 1.0,
      source: "auto-learn:task-complete",
      createdBy: "system:auto-learn",
      metadata: {
        missionTitle: task.mission?.title ?? null,
      },
    },
    update: {
      content,
      lastSeen: new Date(),
      seenCount: { increment: 1 },
    },
  });

  return { slug, missionTitle: task.mission?.title ?? null };
}

// ─── C · WISDOM CITATION ──────────────────────────────────────

/**
 * Find the closest wisdom principle for this task.
 *
 * v10.0.529.81 · Wave 25 · upgraded from keyword-Jaccard to pgvector
 * cosine similarity via semanticSearch(). Captures semantic matches
 * that Jaccard missed entirely (e.g. "shipped instead of researching"
 * matches Munger's "do something" even without shared keywords).
 *
 * Falls back to keyword-Jaccard when semanticSearch returns nothing
 * (provider unavailable · or pgvector temporarily off · or no wisdom
 * embeddings yet). Defensive path keeps the citation surface alive
 * during edge cases.
 *
 * Persona boost still applies (Munger · Naval · Buffett · Greene ·
 * Jobs · Satori favored) but rides on top of the cosine score.
 */
async function tryWisdomCitation({ task }: AutoLearnArgs): Promise<WisdomCitation | null> {
  const queryText = [
    task.title,
    task.finishCondition,
    task.mission?.title,
    task.mission?.domain,
  ]
    .filter((s): s is string => !!s)
    .join(" ");
  if (!queryText.trim()) return null;

  // v25 · semantic fast path · returns scored brain_memory rows from
  // pgvector. We then filter to category="wisdom" client-side · the
  // query layer doesn't filter by category so we over-fetch a bit.
  try {
    const hits = await semanticSearch(queryText, 40, ["brain_memory"]);
    const wisdomHits = hits.filter((h) => h.category === "wisdom");
    if (wisdomHits.length > 0) {
      // Apply persona boost on top of pgvector hybrid score.
      let best: WisdomCitation | null = null;
      let bestScore = 0;
      for (const h of wisdomHits) {
        const personaBoost = isPreferredPersonaKey(h.sourceId, PREFERRED_PERSONAS) ? 1.25 : 1.0;
        const score = h.hybridScore * personaBoost;
        if (score > bestScore && h.similarity >= WISDOM_SIM_FLOOR) {
          bestScore = score;
          // sourceId for brain_memory is the BrainMemory row id · we
          // need the `key` for persona detection. Fetch lazily for
          // the winner only.
          const row = await prisma.brainMemory
            .findUnique({
              where: { id: h.sourceId },
              select: { key: true },
            })
            .catch(() => null);
          best = {
            persona: row ? personaFromKey(row.key) : null,
            key: row?.key ?? h.sourceId,
            content: h.content,
            score: Math.round(score * 100) / 100,
          };
        }
      }
      if (best) return best;
    }
  } catch (err) {
    log.warn("wisdom_semantic_failed", {
      error: err instanceof Error ? err.message.slice(0, 200) : String(err),
    });
    // fall through to Jaccard
  }

  // Fallback · keyword-Jaccard · kept so the citation surface stays
  // alive when pgvector / embedding provider is unavailable. Shared
  // matcher (lib/brain/wisdom-match.ts) · auto-learn's own tuned floor
  // / scan-limit / personas passed in · behavior identical to the prior
  // inline loop.
  const match = await matchWisdom(queryText, {
    scanLimit: WISDOM_SCAN_LIMIT,
    preferredPersonas: PREFERRED_PERSONAS,
  });
  // Floor on the raw score (as the prior in-loop guard did), then round.
  if (!match || match.score < WISDOM_SIM_FLOOR) return null;

  return {
    persona: match.persona,
    key: match.key,
    content: match.content,
    score: Math.round(match.score * 100) / 100,
  };
}

// ─── INTERNAL HELPERS ─────────────────────────────────────────

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(TUTORIAL_PREFIX_PATTERN, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

export { EMPTY };
