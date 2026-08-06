/**
 * Qualitative Identity — the other half of the self-model. Apr 19.
 *
 * The 8-axis snapshot is quantitative. This one is qualitative:
 * the VALUES, FEARS, and OPERATING STYLE Nour has actually expressed
 * across his reflections + chat_importance + belief library. The bet
 * is that Nick reads much sharper when he can anchor replies in
 * "Nour values speed over politeness" vs. a blank persona.
 *
 * Buckets (3-7 short phrases each):
 *   values           — what he cares about (power, ownership, clever work)
 *   fears            — what he avoids or fights against (being blind, drift)
 *   operating_style  — how he works (direct, terse, aggressive tempo)
 *   rhythms          — when/how (morning lock-in, evening reflection)
 *   red_lines        — hard nos (no agents, no drama)
 *
 * Storage: BrainMemory category="qualitative_identity" key="current"
 * + key="history:YYYY-MM-DD". Computed nightly alongside the numeric
 * snapshot.
 *
 * Detection method: scan the text fields of reflections +
 * chat_importance (preference + decision categories) from the last
 * 60d, bucket sentences by lead phrase heuristics. Deliberately
 * heuristic-first — a later AI pass can re-rank. Nour can override
 * any bucket entry manually.
 */

import { prisma } from "@/lib/prisma";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";
import { cached, invalidate } from "@/lib/utils/cache";

// 2026-08-06 · buildQualitativeContextBlock fires on every /chat turn
// (1417 of 1417 sampled turns over 30d) and reads one slowly-changing
// row, so the round-trip was pure time-to-first-token cost. The row only
// moves when computeQualitativeIdentity / addManualEntry / removeEntry
// write it — each of those invalidates below, so the TTL is a backstop,
// not the freshness mechanism.
const CACHE_KEY = "qualitative_identity_current";
const CACHE_TTL_S = 900; // 15 min

export type IdentityBucket = "values" | "fears" | "operating_style" | "rhythms" | "red_lines";

export interface QualitativeEntry {
  text: string;
  manual: boolean;                // true = Nour-added or Nour-edited
  evidence_ids: string[];
  confidence: number;             // 0-1
  updated_at: string;
}

export interface QualitativeIdentity {
  values: QualitativeEntry[];
  fears: QualitativeEntry[];
  operating_style: QualitativeEntry[];
  rhythms: QualitativeEntry[];
  red_lines: QualitativeEntry[];
  computed_at: string;
}

// ── Heuristic detectors ──────────────────────────────────────────────

// Apr 19 · Broadened detection. Each bucket now covers more natural
// phrasings and more domain vocabulary Nour actually uses.

const VALUE_MARKERS = [
  /\bi (really )?(value|care about|love|believe in|prioritize|respect|admire|want)\b/i,
  /\bwhat matters (is|most|to me)\b/i,
  /\b(freedom|ownership|power|control|speed|quality|excellence|clarity|clever|interesting|thorough|depth) (is|matters|comes first|always wins)\b/i,
  /\bi (am|'m) all about\b/i,
  /\bmy (priority|focus|north star|thing) is\b/i,
  /\bi want (power|control|leverage|ownership|speed|clarity)\b/i,
];

const FEAR_MARKERS = [
  /\bi (really )?(hate|can'?t stand|avoid|fear|dread|worry about|refuse|detest|reject)\b/i,
  /\b(scared|afraid|terrified|anxious) (of|that|about)\b/i,
  /\b(stop|kill|prevent|never let|can'?t have) me\b/i,
  /\b(drift|stall|blind spot|idle|stuck|overwhelmed|burned out|wasted)\b/i,
  /\bi don'?t want\b/i,
  /\bthe (thing|stuff) (i|that) avoid\b/i,
];

const STYLE_MARKERS = [
  /\bi (tend to|always|usually|prefer to|default to|naturally) (work|move|operate|think|build|decide|ship|close)\b/i,
  /\b(direct|aggressive|terse|fast|deliberate|methodical|focused|thorough|relentless) (is|matters|first|wins)\b/i,
  /\b(no (fluff|filler|drama|waste)|cut to the chase|get to the point)\b/i,
  /\bi (work|operate|run) (fast|hard|smart|in batches|aggressively)\b/i,
  /\bmy (style|approach|way) is\b/i,
];

const RHYTHM_MARKERS = [
  /\b(morning|evening|nights?|weekends?|tonight|early|late|dawn|afternoon)\b.*\b(work|focus|reflect|close|ship|plan|sit|block)/i,
  /\b(every (day|week|morning|evening|night))\b/i,
  /\b(block|lock in|sit down|dig in|focus) (for|to|at|until)\b/i,
  /\bi (always|usually|tend to) (start|end|finish|wrap|begin) (the )?(day|morning|night|week)\b/i,
  /\b(first thing|last thing|before bed|before work|after dinner|at night)\b/i,
];

const RED_LINE_MARKERS = [
  /\b(i (won'?t|never|refuse to|will not) )\b/i,
  /\bhard no\b/i,
  /\b(rule|line|thing) (is|for me|in (stone|concrete))\b/i,
  /\bnon-negotiable\b/i,
  /\b(not on my watch|over my dead body|not gonna happen)\b/i,
  /\bno (agents|drama|fluff|compromise) (ever|here)?\b/i,
];

function matchesAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((p) => p.test(text));
}

function classifyText(text: string): IdentityBucket | null {
  if (matchesAny(text, RED_LINE_MARKERS)) return "red_lines";
  if (matchesAny(text, VALUE_MARKERS)) return "values";
  if (matchesAny(text, FEAR_MARKERS)) return "fears";
  if (matchesAny(text, RHYTHM_MARKERS)) return "rhythms";
  if (matchesAny(text, STYLE_MARKERS)) return "operating_style";
  return null;
}

// Truncate + tidy a sentence for display
function distill(raw: string, max = 120): string {
  const cleaned = raw.replace(/\s+/g, " ").trim();
  // Take first sentence up to a period or length limit
  const firstSentence = cleaned.split(/[.!?]/)[0].trim();
  const candidate = firstSentence.length > 20 ? firstSentence : cleaned;
  return candidate.slice(0, max);
}

// ── Load previous to preserve manual overrides ─────────────────────

async function loadPreviousOverrides(): Promise<QualitativeIdentity | null> {
  const row = await prisma.brainMemory
    .findUnique({
      where: { category_key: { category: BRAIN_CATEGORIES.QUALITATIVE_IDENTITY, key: "current" } },
      select: { content: true },
    })
    .catch(() => null);
  if (!row) return null;
  try {
    return JSON.parse(row.content) as QualitativeIdentity;
  } catch {
    return null;
  }
}

/**
 * Compute + persist a fresh qualitative identity. Manual entries
 * from the previous snapshot survive unchanged.
 */
export async function computeQualitativeIdentity(): Promise<QualitativeIdentity> {
  const since = new Date(Date.now() - 60 * 86400_000);
  const now = new Date();

  const [reflections, importance, beliefs, previous] = await Promise.all([
    prisma.reflection.findMany({
      where: { createdAt: { gte: since } },
      orderBy: { createdAt: "desc" },
      take: 120,
      select: { id: true, insight: true, category: true, confidence: true, createdAt: true },
    }),
    // v10.0.46 — added `deletedAt: null` to chat_importance + belief
    // reads. Deleted markers were inflating identity scoring inputs.
    prisma.brainMemory.findMany({
      where: { category: BRAIN_CATEGORIES.CHAT_IMPORTANCE, createdAt: { gte: since }, deletedAt: null },
      orderBy: { createdAt: "desc" },
      take: 200,
      select: { id: true, content: true, createdAt: true },
    }),
    prisma.brainMemory.findMany({
      where: { category: BRAIN_CATEGORIES.BELIEF, deletedAt: null },
      take: 30,
      select: { id: true, content: true },
    }),
    loadPreviousOverrides(),
  ]);

  const buckets: Record<IdentityBucket, Map<string, { sources: Set<string>; confidence: number }>> = {
    values: new Map(),
    fears: new Map(),
    operating_style: new Map(),
    rhythms: new Map(),
    red_lines: new Map(),
  };

  const addToBucket = (bucket: IdentityBucket, text: string, sourceId: string, confidence: number) => {
    const phrase = distill(text);
    if (phrase.length < 10) return;
    const key = phrase.toLowerCase();
    if (!buckets[bucket].has(key)) {
      buckets[bucket].set(key, { sources: new Set(), confidence: 0 });
    }
    const entry = buckets[bucket].get(key)!;
    entry.sources.add(sourceId);
    entry.confidence = Math.max(entry.confidence, confidence);
  };

  for (const r of reflections) {
    const bucket = classifyText(r.insight);
    if (!bucket) continue;
    addToBucket(bucket, r.insight, r.id, r.confidence);
  }

  for (const m of importance) {
    try {
      const parsed = JSON.parse(m.content) as { excerpt?: string; primary?: string };
      const text = parsed.excerpt ?? "";
      if (!text) continue;
      const bucket = classifyText(text);
      if (!bucket) continue;
      addToBucket(bucket, text, m.id, 0.55);
    } catch {
      // skip
    }
  }

  for (const b of beliefs) {
    try {
      const parsed = JSON.parse(b.content) as { statement?: string; overridden?: string | null };
      const text = parsed.overridden ?? parsed.statement ?? "";
      if (!text) continue;
      const bucket = classifyText(text);
      if (!bucket) continue;
      addToBucket(bucket, text, b.id, 0.8);
    } catch {
      // skip
    }
  }

  // Merge previous manual entries back in (they always survive)
  const previousManual: Record<IdentityBucket, QualitativeEntry[]> = {
    values: [], fears: [], operating_style: [], rhythms: [], red_lines: [],
  };
  if (previous) {
    for (const bucket of Object.keys(previousManual) as IdentityBucket[]) {
      for (const e of previous[bucket] ?? []) {
        if (e.manual) previousManual[bucket].push(e);
      }
    }
  }

  const build = (bucket: IdentityBucket): QualitativeEntry[] => {
    const computed: QualitativeEntry[] = [];
    for (const [phrase, meta] of buckets[bucket]) {
      computed.push({
        text: phrase,
        manual: false,
        evidence_ids: Array.from(meta.sources).slice(0, 6),
        confidence: meta.confidence,
        updated_at: now.toISOString(),
      });
    }
    // Sort by confidence × evidence, keep top 7
    computed.sort(
      (a, b) =>
        (b.confidence * (b.evidence_ids.length + 1)) - (a.confidence * (a.evidence_ids.length + 1)),
    );
    const merged = [...previousManual[bucket], ...computed.slice(0, 7 - previousManual[bucket].length)];
    return merged.slice(0, 7);
  };

  const identity: QualitativeIdentity = {
    values: build("values"),
    fears: build("fears"),
    operating_style: build("operating_style"),
    rhythms: build("rhythms"),
    red_lines: build("red_lines"),
    computed_at: now.toISOString(),
  };

  const payload = JSON.stringify(identity);
  const historyKey = `history:${now.toISOString().slice(0, 10)}`;
  await Promise.all([
    prisma.brainMemory.upsert({
      where: { category_key: { category: BRAIN_CATEGORIES.QUALITATIVE_IDENTITY, key: "current" } },
      create: {
        category: BRAIN_CATEGORIES.QUALITATIVE_IDENTITY,
        key: "current",
        content: payload,
        confidence: 0.7,
        source: "qualitative_identity",
      },
      update: { content: payload, lastSeen: now },
    }),
    prisma.brainMemory.upsert({
      where: { category_key: { category: BRAIN_CATEGORIES.QUALITATIVE_IDENTITY, key: historyKey } },
      create: {
        category: BRAIN_CATEGORIES.QUALITATIVE_IDENTITY,
        key: historyKey,
        content: payload,
        confidence: 0.7,
        source: "qualitative_identity",
      },
      update: { content: payload, lastSeen: now },
    }),
  ]);

  invalidate(CACHE_KEY);
  return identity;
}

export async function loadQualitativeIdentity(): Promise<QualitativeIdentity> {
  return cached(CACHE_KEY, CACHE_TTL_S, async () => {
    const row = await prisma.brainMemory.findUnique({
      where: { category_key: { category: BRAIN_CATEGORIES.QUALITATIVE_IDENTITY, key: "current" } },
      select: { content: true },
    });
    if (row) {
      try {
        return JSON.parse(row.content) as QualitativeIdentity;
      } catch {
        // fall through
      }
    }
    return computeQualitativeIdentity();
  });
}

/**
 * Add a manual entry to a bucket. Manual entries survive re-computes.
 */
export async function addManualEntry(bucket: IdentityBucket, text: string): Promise<QualitativeIdentity> {
  const current = await loadQualitativeIdentity();
  const entry: QualitativeEntry = {
    text: text.trim().slice(0, 180),
    manual: true,
    evidence_ids: [],
    confidence: 1.0,
    updated_at: new Date().toISOString(),
  };
  // NEVER mutate `current`. loadQualitativeIdentity hands back the CACHED
  // object by reference, so an in-place unshift plants the entry in every
  // subsequent prompt even when the update() below THROWS — a phantom the
  // DB never stored, which then duplicates on retry. Build the next value
  // off to the side, persist it, and only then drop the cache.
  const next: QualitativeIdentity = { ...current };
  next[bucket] = [entry, ...current[bucket]].slice(0, 10);
  const payload = JSON.stringify(next);
  await prisma.brainMemory.update({
    where: { category_key: { category: BRAIN_CATEGORIES.QUALITATIVE_IDENTITY, key: "current" } },
    data: { content: payload, lastSeen: new Date() },
  });
  invalidate(CACHE_KEY);
  return next;
}

export async function removeEntry(bucket: IdentityBucket, text: string): Promise<QualitativeIdentity> {
  const current = await loadQualitativeIdentity();
  // Same rule as addManualEntry: assigning to `current[bucket]` would edit
  // the cached object, so a failed write would drop the entry from the
  // prompt while the row still holds it. Copy, write, then invalidate.
  const next: QualitativeIdentity = { ...current };
  next[bucket] = current[bucket].filter((e) => e.text !== text);
  const payload = JSON.stringify(next);
  await prisma.brainMemory.update({
    where: { category_key: { category: BRAIN_CATEGORIES.QUALITATIVE_IDENTITY, key: "current" } },
    data: { content: payload, lastSeen: new Date() },
  });
  invalidate(CACHE_KEY);
  return next;
}

/**
 * Drop the cached qualitative-identity row.
 *
 * Exported for `resetBrainState` (lib/services/brain-domain.ts), which
 * DELETES this row as one of its 12 wiped categories. Without this the
 * cached object outlives the row for a full 900s TTL: /chat keeps
 * rendering an identity that no longer exists, and the next
 * addManualEntry/removeEntry runs update() against a missing row and
 * throws Prisma P2025.
 *
 * Multi-replica caveat: clears THIS instance's L1 plus the shared L2
 * (Redis) key; sibling replicas age out on the TTL.
 */
export function invalidateQualitativeIdentityCache(): void {
  invalidate(CACHE_KEY);
}

/**
 * System-prompt block for chat route.
 */
export async function buildQualitativeContextBlock(): Promise<string> {
  const q = await loadQualitativeIdentity().catch(() => null);
  if (!q) return "";
  const lines: string[] = ["## Nour's qualitative identity"];
  const BUCKETS: Array<[IdentityBucket, string]> = [
    ["values", "values"],
    ["fears", "fears"],
    ["operating_style", "operating style"],
    ["rhythms", "rhythms"],
    ["red_lines", "red lines"],
  ];
  for (const [key, label] of BUCKETS) {
    const entries = q[key].slice(0, 5);
    if (entries.length === 0) continue;
    lines.push(`### ${label}`);
    for (const e of entries) {
      lines.push(`- ${e.text}${e.manual ? " (pinned)" : ""}`);
    }
  }
  return lines.join("\n");
}
