/**
 * Shared state + helpers for the /api/ai/chat/suggestions endpoint.
 *
 * Pulled into its own module because Next.js route files can ONLY
 * export valid HTTP method handlers — exporting helpers directly
 * from the route trips TypeScript's route-type-gen at build time.
 *
 * Consumers:
 *   • app/api/ai/chat/suggestions/route.ts      — POST handler
 *   • app/api/ai/chat/suggestions/stats/route.ts — GET reads metrics
 *   • app/api/ai/chat/route.ts                   — onFinish warms cache
 */

import { recordError } from "@/lib/errors/record-error";
import { logError } from "@/lib/utils/error-log";

// ─── Cache ─────────────────────────────────────────────────

const CACHE = new Map<string, { t: number; out: string[] }>();
const CACHE_TTL = 60_000;

export function cacheGet(key: string): string[] | null {
  const cached = CACHE.get(key);
  if (!cached) return null;
  if (Date.now() - cached.t >= CACHE_TTL) return null;
  return cached.out;
}

export function cacheSet(key: string, out: string[]) {
  CACHE.set(key, { t: Date.now(), out: out.slice(0, 3) });
  if (CACHE.size > 40) {
    const oldest = [...CACHE.entries()].sort((a, b) => a[1].t - b[1].t)[0];
    if (oldest) CACHE.delete(oldest[0]);
  }
}

export function warmSuggestionCache(
  userMsg: string,
  assistantMsg: string,
  out: string[]
) {
  if (!out || out.length === 0) return;
  const key = suggestionHashKey(userMsg, assistantMsg);
  cacheSet(key, out);
}

// ─── Hash + heuristic ──────────────────────────────────────

export function suggestionHashKey(user: string, assistant: string): string {
  const raw = `${user.slice(-400)}||${assistant.slice(-400)}`;
  let h = 0;
  for (let i = 0; i < raw.length; i++) {
    h = (h * 31 + raw.charCodeAt(i)) | 0;
  }
  return String(h);
}

/**
 * Extract proper-noun entities from the assistant message (project
 * names, people, brands). Used to ground heuristic replies in the
 * actual conversation rather than emitting generic boilerplate.
 *
 * Heuristic: Capitalized phrases of 1-4 words, excluding sentence-
 * starts. Filters common stop-capitalized words ("I", "Nick", "Nour"
 * — the latter two are conversational subjects we don't suggest
 * about; they're WHO is talking, not what's being discussed).
 *
 * v10.0.160 · added because the Bay 5 Revive turn got the canned
 * "Top 3 for right now" reply set instead of "Show me Bay 5 Revive
 * tasks" — the project name was right there in Nick's reply but the
 * suggester had no entity awareness.
 */
function extractEntities(text: string): string[] {
  // Match 1-4 capitalized words, optionally separated by single
  // spaces. Numbers allowed in middle ("Bay 5 Revive"). Allow either
  // start-of-string OR preceding whitespace/punctuation — the stop
  // set below filters out conversational sentence-starts so a real
  // entity at position 0 ("Acme Corp invoices…") still surfaces.
  const pattern = /(?:^|(?<=[.!?,:;\s]))(?:[A-Z][\w&]*(?:\s+\d+)?(?:\s+[A-Z][\w&]*){0,3})/g;
  const stop = new Set([
    "I", "Nick", "Nour", "The", "A", "An", "This", "That", "These", "Those",
    "If", "When", "While", "Once", "Today", "Yesterday", "Tomorrow",
    "Yes", "No", "Sure", "Done", "Total", "Next", "Hey", "Hi", "Hello", "Okay", "Ok",
    // v10.0.175 · past-participle action verbs that the model emits
    // at the start of fabricated responses ("Added 'X' to today's
    // task list..."). Without these in the stop set, the entity
    // extractor pulled "Added" as the topic and smart replies
    // suggested "Show Added tasks". They're verbs, not entities.
    "Added", "Created", "Made", "Sent", "Scheduled", "Saved", "Pinned",
    "Linked", "Moved", "Marked", "Completed", "Removed", "Deleted",
    "Started", "Stopped", "Updated", "Posted", "Published", "Closed",
    "Opened", "Contacted", "Drafted", "Resolved",
    // v-truth · generic business nouns Nick uses about the operator's OWN
    // shop/metrics — NOT lead/person entities. Pre-fix "Shop status: slow"
    // made the extractor treat "Shop" as a lead -> nonsensical
    // "lead score for Shop" / "Open Shop in /leads" chips. Same for the
    // other metric words that head a sentence in a business reply.
    "Shop", "Revenue", "Week", "Weekly", "Month", "Projection", "Pipeline",
    "Status", "Booked", "Invoice", "Invoices", "Estimate", "Estimates",
    "Lead", "Leads", "Job", "Jobs", "Board", "Avg", "Ticket", "Slow",
    "Week", "Quarter", "Day", "Daily", "Morning", "Evening", "Night",
    // v-truth · identity-AXIS + drift/strategy sentence-heads. "Velocity is
    // falling" must not become "Why is Velocity drifting?" — axes are not
    // draggable entities (same failure mode as "lead score for Shop").
    "Velocity", "Patience", "Discipline", "Risk", "Reflection", "Drift",
    "Identity", "Momentum", "Plan", "Vision", "Goal", "Goals", "Mission",
    "Direction", "Focus", "Energy", "Mind", "Brain", "Maturity",
  ]);
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(text)) !== null) {
    const phrase = m[0].trim();
    if (!phrase || phrase.length < 3) continue;
    // Skip when the phrase head is a conversational stop word —
    // applies to any length so "Yes Nick agreed" doesn't extract
    // "Yes Nick" as an entity. Real entities don't start with "I",
    // "Yes", "Nick", "Nour", etc.
    const head = phrase.split(/\s+/)[0];
    if (stop.has(head)) continue;
    if (/^\d+$/.test(phrase)) continue;
    if (out.includes(phrase)) continue;
    out.push(phrase);
    if (out.length >= 3) break;
  }
  return out;
}

export function heuristicSuggestions(assistant: string): string[] {
  const a = assistant.toLowerCase();
  const entities = extractEntities(assistant);
  // v10.0.160 · entity-grounded suggestions when we can identify a
  // specific project / topic / person mentioned in the reply. Falls
  // back to category templates only when no entity is identifiable.
  if (entities.length > 0) {
    const e = entities[0];
    // Tailor by category but anchor on the entity name.
    if (/task|todo|open loop|commitment|deadline|critical|priority/.test(a)) {
      return [
        `Show ${e} tasks`,
        `Resolve loop ${e}`,
        `Schedule ${e} for later`,
      ];
    }
    if (/lead|customer|estimate|declined|follow[- ]?up|contact|call/.test(a)) {
      return [
        `Draft follow-up for ${e}`,
        `Open lead queue`,
        `Who needs a call today?`,
      ];
    }
    if (/revenue|\$\d|booked|pipeline|invoice|quote|aging/.test(a)) {
      return [
        `Break ${e} down by source`,
        `Compare ${e} to last week`,
        `What's the pipeline on ${e}?`,
      ];
    }
    if (/drift|score|energy|mood|identity|pattern|habit/.test(a)) {
      return [
        `Why is ${e} drifting?`,
        `One move to fix ${e}?`,
        `What pulled ${e} off track?`,
      ];
    }
    if (/strategy|plan|week|month|goal|launch|vision|direction/.test(a)) {
      return [
        `What's the highest-leverage move on ${e}?`,
        `Risks I'm missing on ${e}?`,
        `Stress test the ${e} plan`,
      ];
    }
    // Generic entity-grounded fallback — beats the canned templates
    // because at least it references the actual subject.
    return [
      `Go deeper on ${e}`,
      `One action to move ${e} forward?`,
      `What's blocking ${e}?`,
    ];
  }

  // ── No identifiable entity — fall back to category templates ──
  if (/revenue|\$\d|booked|pipeline|invoice|quote|aging/.test(a)) {
    return ["Break it down by source", "Compare to last week", "What's in the pipeline?"];
  }
  if (/task|todo|open loop|commitment|deadline|critical|priority/.test(a)) {
    return ["Top 3 for right now", "What's blocking me?", "Mark the top one done"];
  }
  if (/drift|score|energy|mood|identity|pattern|habit/.test(a)) {
    return ["Why is it drifting?", "What pulled me off?", "Snap back — what's one move?"];
  }
  if (/lead|customer|estimate|declined|follow[- ]?up|contact|call/.test(a)) {
    return ["Pull the freshest leads", "Who needs a call today?", "Draft the follow-up"];
  }
  if (/strategy|plan|week|month|goal|launch|vision|direction/.test(a)) {
    return ["What's the highest-leverage move?", "Risks I'm missing?", "Stress test that plan"];
  }
  return ["Go deeper", "What would Nick do?", "Give me one action"];
}

// ─── Metrics ──────────────────────────────────────────────

type MetricWindow = {
  cacheHits: number;
  aiOk: number;
  aiFail: number;
  heuristic: number;
  errorFallback: number;
  totalLatencyMs: number;
  requests: number;
  latencySamples: number[];
};
const METRICS: MetricWindow = {
  cacheHits: 0,
  aiOk: 0,
  aiFail: 0,
  heuristic: 0,
  errorFallback: 0,
  totalLatencyMs: 0,
  requests: 0,
  latencySamples: [],
};

export function recordSuggestionMetric(
  source: "cache" | "ai" | "heuristic" | "error-fallback",
  latencyMs: number,
  aiFailed: boolean
) {
  METRICS.requests++;
  METRICS.totalLatencyMs += latencyMs;
  METRICS.latencySamples.push(latencyMs);
  if (METRICS.latencySamples.length > 200) METRICS.latencySamples.shift();
  if (source === "cache") METRICS.cacheHits++;
  else if (source === "ai") METRICS.aiOk++;
  else if (source === "heuristic") METRICS.heuristic++;
  else if (source === "error-fallback") METRICS.errorFallback++;
  if (aiFailed && source !== "ai") METRICS.aiFail++;

  // Apr 20 · Persist to SystemMetric so history survives lambda
  // cold starts. Fire-and-forget; the in-memory metrics above are
  // the hot path for the panel. DB reads happen in readHistorical-
  // SuggestionMetrics for the 24h view.
  void persistMetric(source, latencyMs, aiFailed).catch((err) =>
    logError("ai.suggestion-cache", err, { fn: "recordSuggestionMetric", source, latencyMs }),
  );
}

async function persistMetric(
  source: "cache" | "ai" | "heuristic" | "error-fallback",
  latencyMs: number,
  aiFailed: boolean
): Promise<void> {
  try {
    const { prisma } = await import("@/lib/prisma");
    await prisma.systemMetric.create({
      data: {
        metric: "suggestion.request",
        value: latencyMs,
        unit: "ms",
        source: "api",
        tags: { source, aiFailed } as any,
      },
    });
  } catch (err) {
    /* intentionally ignored — DB offline / race — the in-memory metric already captured the sample. Don't spam logs. */
    logError("ai.suggestion-cache", err, { fn: "persistMetric", source }, "warn");
  }
}

/**
 * Historical metrics from SystemMetric table (last 24h). Merges with
 * the lambda-local snapshot so the panel shows persistent history.
 */
export async function readHistoricalSuggestionMetrics(
  hours = 24
): Promise<{
  requests: number;
  cacheHits: number;
  aiOk: number;
  aiFail: number;
  heuristic: number;
  errorFallback: number;
  avgLatencyMs: number;
  since: string;
}> {
  try {
    const { prisma } = await import("@/lib/prisma");
    const since = new Date(Date.now() - hours * 3600_000);
    const rows = await prisma.systemMetric.findMany({
      where: {
        metric: "suggestion.request",
        createdAt: { gte: since },
      },
      select: { value: true, tags: true },
      take: 5000,
    });
    let cacheHits = 0;
    let aiOk = 0;
    let aiFail = 0;
    let heuristic = 0;
    let errorFallback = 0;
    let total = 0;
    let totalLatency = 0;
    for (const r of rows) {
      total++;
      totalLatency += r.value;
      const tags = r.tags as { source?: string; veniceFailed?: boolean; aiFailed?: boolean } | null;
      const src = tags?.source;
      if (src === "cache") cacheHits++;
      // Map legacy "venice" tag or new "ai" tag to aiOk for back-compat
      else if (src === "venice" || src === "ai") aiOk++;
      else if (src === "heuristic") heuristic++;
      else if (src === "error-fallback") errorFallback++;
      if (tags?.veniceFailed || tags?.aiFailed) aiFail++;
    }
    return {
      requests: total,
      cacheHits,
      aiOk,
      aiFail,
      heuristic,
      errorFallback,
      avgLatencyMs: total > 0 ? Math.round(totalLatency / total) : 0,
      since: since.toISOString(),
    };
  } catch (err) {
    logError("ai.suggestion-cache", err, { fn: "readHistoricalSuggestionMetrics" });
    return {
      requests: 0,
      cacheHits: 0,
      aiOk: 0,
      aiFail: 0,
      heuristic: 0,
      errorFallback: 0,
      avgLatencyMs: 0,
      since: new Date(Date.now() - hours * 3600_000).toISOString(),
    };
  }
}

export function readSuggestionMetrics(): MetricWindow & {
  cacheHitRate: number;
  avgLatencyMs: number;
  p50Ms: number;
  p95Ms: number;
} {
  const sorted = [...METRICS.latencySamples].sort((a, b) => a - b);
  const p50 = sorted.length > 0 ? sorted[Math.floor(sorted.length * 0.5)] : 0;
  const p95 = sorted.length > 0 ? sorted[Math.floor(sorted.length * 0.95)] : 0;
  return {
    ...METRICS,
    cacheHitRate: METRICS.requests > 0 ? METRICS.cacheHits / METRICS.requests : 0,
    avgLatencyMs: METRICS.requests > 0 ? METRICS.totalLatencyMs / METRICS.requests : 0,
    p50Ms: p50,
    p95Ms: p95,
  };
}

