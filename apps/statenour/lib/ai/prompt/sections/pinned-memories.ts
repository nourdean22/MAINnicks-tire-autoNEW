/**
 * lib/ai/prompt/sections/pinned-memories.ts · Wave 84 · 2026-05-17
 *
 * Pure formatter for v1's "Pinned by Nour" + "Nick Brain — Hot Rules"
 * blocks (system-prompt.ts:1714-1839 pre-split).
 *
 * Pinned-memory ranking (unchanged from v1):
 *   label_weight:    2.0 if metadata.label is set, else 1.0
 *   recency_score:   exp(-age_days / 30) clamped [0.1, 1.0]
 *   reinforce_score: min(1 + log(seenCount), 3)
 *   source_weight:   1.2 for pin:manual · 1.1 for pin:chat · 1.0 else
 * Final = label × recency × reinforce × source_weight. Greedy fill
 * to a 1200-char budget · max 5 pins · always include the top-scoring
 * one even if alone it blows the budget.
 *
 * v10.0.529.93 · Wave 37 stale-pin cutoff: drop pins older than 45d
 * with seenCount < 3, so dead context never reaches the prompt-budget
 * ranker.
 *
 * Caller pre-fetches both arrays; this file does no I/O.
 */

import { sanitizeForPrompt } from "@/lib/ai/prompt/sanitize";

interface PinnedMemoriesInput {
  pinnedMemories: {
    key: string;
    content: string;
    metadata: unknown;
    seenCount: number;
    updatedAt: Date | null;
    source: string | null;
  }[];
}

interface TopMemoriesInput {
  topMemories: {
    category: string;
    key: string;
    content: string;
    confidence: number;
  }[];
}

const STALE_AGE_DAYS = 45;
const STALE_SEEN_FLOOR = 3;
const PIN_CHAR_BUDGET = 1200;
const PIN_LIMIT = 260;
const MAX_PINS = 5;

export function renderPinnedMemories(input: PinnedMemoriesInput): string[] {
  const { pinnedMemories } = input;
  if (pinnedMemories.length === 0) return [];

  const now = Date.now();
  type RankablePin = (typeof pinnedMemories)[number];

  // v10.0.529.93 · Wave 37 · hard stale-pin cutoff. Pre-Wave-37 a
  // 90-day labeled high-seenCount pin could still outscore a fresh
  // unlabeled one because labelWeight * reinforce multiplied recency
  // back up. Wave 33 surfaced this; Wave 37 cuts dead context from the
  // ranker. Cutoff at 45d AND seenCount < 3 (labeled + reinforced pins
  // survive).
  const freshPins = pinnedMemories.filter((pin: RankablePin) => {
    const ageDays = pin.updatedAt
      ? (now - new Date(pin.updatedAt).getTime()) / 86400_000
      : 999;
    if (ageDays <= STALE_AGE_DAYS) return true;
    return (pin.seenCount || 0) >= STALE_SEEN_FLOOR;
  });

  const scored = freshPins.map((pin: RankablePin) => {
    const meta = (pin.metadata as { label?: string } | null) || null;
    const hasLabel = !!meta?.label;
    const labelWeight = hasLabel ? 2.0 : 1.0;

    const ageDays = pin.updatedAt
      ? (now - new Date(pin.updatedAt).getTime()) / 86400_000
      : 999;
    const recencyScore = Math.max(0.1, Math.min(1.0, Math.exp(-ageDays / 30)));

    const reinforce = Math.min(1 + Math.log(Math.max(1, pin.seenCount || 1)), 3);

    let sourceWeight = 1.0;
    if (pin.source === "pin:manual") sourceWeight = 1.2;
    else if (pin.source === "pin:chat") sourceWeight = 1.1;

    const score = labelWeight * recencyScore * reinforce * sourceWeight;
    // 2026-06-01 · sanitizeForPrompt (was a bare .slice) — pinned content is
    // operator-supplied + chat-derived; without this, `\n## OVERRIDE` etc.
    // land as structural prompt content every turn. The sanitizer exists for
    // exactly this but was unused here. Also keeps multiline pins on one bullet.
    const body = sanitizeForPrompt(pin.content, PIN_LIMIT);
    const label = hasLabel ? ` (${meta?.label})` : "";
    const line = `- ${body}${label}`;
    return { pin, score, line, body };
  });

  scored.sort((a, b) => b.score - a.score);

  // Greedy fill until budget exhausted. Always take the first one
  // even if it alone blows the budget — at least Nour's top pin
  // makes it in.
  const selected: typeof scored = [];
  let totalChars = 0;
  for (const entry of scored) {
    if (!entry.body) continue;
    const incoming = entry.line.length;
    if (selected.length === 0 || totalChars + incoming <= PIN_CHAR_BUDGET) {
      selected.push(entry);
      totalChars += incoming;
    }
    if (selected.length >= MAX_PINS) break;
  }

  const droppedCount = pinnedMemories.length - selected.length;
  const p: string[] = [];

  p.push(`## Pinned by Nour (permanent context — never drop)`);
  p.push(
    `Nour pinned these himself. They override guesses and stay in the prompt every turn until he unpins them. If one feels stale, ask — don't assume.` +
      (droppedCount > 0
        ? ` (${selected.length} of ${pinnedMemories.length} shown — others trimmed for prompt budget)`
        : "")
  );
  for (const entry of selected) {
    p.push(entry.line);
  }
  p.push(``);

  return p;
}

export function renderHotRules(input: TopMemoriesInput): string[] {
  const { topMemories } = input;
  if (topMemories.length === 0) return [];

  // HOT PROMPT MEMORY · Apr 28 · trimmed to 8 memories × 140 chars.
  // Already filtered at the query level to priority categories.
  const MAX_TOTAL = 8;
  const CONTENT_LIMIT = 140;

  const selected = [...topMemories]
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, MAX_TOTAL);

  const p: string[] = [];
  p.push(
    `## Nick Brain — Hot Rules (${selected.length} hard-rule memories loaded)`
  );
  p.push(
    `Full corpus has ${topMemories.length}+ priority memories + thousands more archived. For anything not listed here — old notes, Drive documents, historical patterns, archived brain dumps — CALL \`searchColdMemory(query)\` instead of guessing.`
  );
  for (const m of selected) {
    p.push(
      `[${m.category}] (${(m.confidence * 100).toFixed(0)}%) ${sanitizeForPrompt(m.content, CONTENT_LIMIT)}`
    );
  }
  p.push(``);
  // Apr 28 · Cold memory section trimmed from 600ch to 200ch.
  p.push(`## Cold memory: \`searchColdMemory({ query, scope, limit })\` — scopes: drive | ingest | all. Cite driveViewUrl. Use \`syncDriveMemory()\` for manual refresh.`);
  p.push(``);

  return p;
}
