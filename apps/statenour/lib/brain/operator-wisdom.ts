/**
 * Brain-derived operator wisdom (Nick audit A8, 2026-11-06).
 *
 * Nour: "Extract insights from the brain about my personality and blind spots ... and add them to
 * Nick's accumulated wisdom for use in future conversations." The brain already holds derived rows
 * (qualitative_identity, blind_spot, pattern, preference, belief, goal) and journal dumps, but none of
 * them reach Nick's forced wisdom slots: selectWisdomSlots admits only category=wisdom rows with a
 * curated author. This module is the pure half: the prompt, the grounding validator and the row
 * shape. scripts/derive-operator-wisdom.ts does the reads, the one model call and the write.
 *
 * Rows use source "pack:nour-brain-derived", which memory-consolidation's CURATED_GUARD keeps away
 * from the merge and prune passes, and origin "nour-brain-derived" (lib/brain/wisdom-origins.ts),
 * which curatedWisdomAuthor labels "Nour (derived)". Insight text lives only in the database: the repo is
 * public, so no committed file carries it.
 */
import { createHash } from "node:crypto";

export const OPERATOR_WISDOM_ORIGIN = "nour-brain-derived";
export const OPERATOR_WISDOM_SOURCE = `pack:${OPERATOR_WISDOM_ORIGIN}`;
export const OPERATOR_WISDOM_AUTHOR = "Nour (brain-derived)";
export const OPERATOR_INSIGHT_KINDS = ["trait", "blind_spot", "pattern", "what_helps", "what_derails"] as const;
export type OperatorInsightKind = (typeof OPERATOR_INSIGHT_KINDS)[number];

const PER_KIND_CAP = 10;
/** What the prompt asks for: a thinking model on the 8,000-token reason lane spends ~3,000-3,600 before its first visible word (chat-output-budget.ts). */
const ASK_PER_KIND = 5;
const MIN_TEXT = 20;
const MAX_TEXT = 400;

export interface OperatorInsight {
  kind: OperatorInsightKind;
  text: string;
  sourceIds: string[];
}

/** One brain row the model may cite, by id. */
export interface PoolItem {
  id: string;
  category: string;
  content: string;
}

export function buildOperatorWisdomPrompt(pool: PoolItem[]): { system: string; user: string } {
  const system = `You read Nour's own brain notes (he owns a tire and auto shop and builds his own operating system) and write the few insights about HIM that would make his assistant Nick more useful in future conversations.

Return ONLY JSON: {"insights":[{"kind":"<trait|blind_spot|pattern|what_helps|what_derails>","text":"<one or two plain sentences>","sourceIds":["<id>", "..."]}]}

Rules:
- Every insight cites the ids of the notes it rests on. Cite only ids from the list. No id, no insight.
- An insight is about how Nour thinks, decides, works, communicates or gets derailed. It is not a fact about another person, and not a medical, family, religious or money detail.
- Write it so Nick can act on it ("When X, Nour tends to Y; Nick should Z" is a good shape). No flattery, no diagnosis.
- At most ${ASK_PER_KIND} per kind. Fewer good ones beat many weak ones. Skip a kind with no evidence.`;
  // 300 chars a row: at 600 the 177-row prod pool came back empty from the reason lane (2026-11-06 dry run).
  const user = pool.map((p) => `[${p.id}] (${p.category}) ${p.content.replace(/\s+/g, " ").slice(0, 300)}`).join("\n");
  return { system, user };
}

/** The JSON object in a model reply, with or without a code fence; null when there is none. */
function extractJson(raw: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(raw);
  const body = (fenced ? fenced[1] : raw).trim();
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(body.slice(start, end + 1));
  } catch {
    return null;
  }
}

/**
 * Keep an insight only when its kind is known, its text is a usable length and EVERY id it cites is
 * a brain row the model was shown. An unparseable reply is reported (parseError), never read as
 * "the brain has nothing to say".
 */
export function parseOperatorInsights(
  raw: string,
  poolIds: ReadonlySet<string>,
): { kept: OperatorInsight[]; dropped: number; parseError: boolean } {
  const parsed = extractJson(raw) as { insights?: unknown } | null;
  if (!parsed || !Array.isArray(parsed.insights)) return { kept: [], dropped: 0, parseError: true };
  const kept: OperatorInsight[] = [];
  const perKind = new Map<string, number>();
  let dropped = 0;
  for (const item of parsed.insights as Array<Record<string, unknown>>) {
    const kind = item?.kind;
    const text = typeof item?.text === "string" ? item.text.trim() : "";
    const ids = Array.isArray(item?.sourceIds) ? item.sourceIds.filter((x): x is string => typeof x === "string") : [];
    const ok =
      (OPERATOR_INSIGHT_KINDS as readonly unknown[]).includes(kind) &&
      text.length >= MIN_TEXT &&
      text.length <= MAX_TEXT &&
      ids.length > 0 &&
      ids.every((id) => poolIds.has(id)) &&
      (perKind.get(kind as string) ?? 0) < PER_KIND_CAP;
    if (!ok) {
      dropped += 1;
      continue;
    }
    perKind.set(kind as string, (perKind.get(kind as string) ?? 0) + 1);
    kept.push({ kind: kind as OperatorInsightKind, text, sourceIds: [...new Set(ids)] });
  }
  return { kept, dropped, parseError: false };
}

/** The BrainMemory(category="wisdom") rows for a set of insights. Keys hash the text, so a re-run of the same insight updates it. */
export function operatorWisdomRows(insights: OperatorInsight[], derivedAt: string = new Date().toISOString()) {
  return insights.map((i) => {
    const hash = createHash("sha256").update(i.text).digest("hex").slice(0, 8);
    return {
      key: `wisdom_${OPERATOR_WISDOM_ORIGIN}_${i.kind}_${hash}`,
      content: i.text,
      confidence: 0.7,
      source: OPERATOR_WISDOM_SOURCE,
      metadata: {
        origin: OPERATOR_WISDOM_ORIGIN,
        kind: i.kind,
        topic: i.kind,
        sourceIds: i.sourceIds,
        author: OPERATOR_WISDOM_AUTHOR,
        derivedAt,
      },
    };
  });
}
