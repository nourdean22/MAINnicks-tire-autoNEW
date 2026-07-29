/**
 * lib/brain/skill-from-source.ts — capture a protocol from an EXTERNAL
 * source (a book page, an article, a photographed cover) as a candidate
 * skill (2026-07-29).
 *
 * Reported gap: the operator photographed "What to Say When You Talk to
 * Your Self" in chat and asked Nick to turn it into a skill. Nick had
 * `suggestSkills`, `getSkillProtocol` and `searchSkills` — all READS.
 * There was no way to author one, so nothing could happen.
 *
 * DESIGN CONSTRAINT that shaped this (found before building, not after):
 * the existing skill lane is BEHAVIORAL. `skill-extractor` derives
 * skills from what the operator actually did, and they carry
 * times_fired / times_succeeded / success_rate. A book-derived protocol
 * has none of that history. Writing it into the same lane with zeroed
 * counters would make a brand-new idea look like a skill that had been
 * tried and never worked — a quiet lie in the data.
 *
 * So a captured skill enters as PENDING with explicit source provenance
 * and `manually_reviewed: false`. It earns promotion the same way every
 * other skill does — by being used (`promoteSkill`). A book gets you a
 * candidate, not a credential. That is the same evidence-over-assertion
 * rule the rest of this system runs on.
 *
 * Pure builder — no DB, no LLM. The caller supplies already-distilled
 * content; storage reuses the extractor's own pending lane.
 */
import { buildSkillKey, type Skill } from "./skill-extractor";

export type CaptureTier = Skill["tier"];

export interface SkillSourceInput {
  /** Where this came from — a title, author, URL, or "photo: <caption>". */
  sourceLabel: string;
  /** The situation this protocol applies to. */
  trigger: string;
  /** Ordered steps. Must be concrete enough to follow. */
  steps: string[];
  /** Optional retrieval tokens. */
  keywords?: string[];
}

export interface CapturedSkill {
  key: string;
  skill: Skill;
}

const clean = (s: string) => s.replace(/\s+/g, " ").trim();

/** Deterministic keyword fallback: content words from trigger + steps. */
function deriveKeywords(trigger: string, steps: string[]): string[] {
  const stop = new Set([
    "the", "a", "an", "and", "or", "but", "to", "of", "in", "on", "for",
    "with", "your", "you", "it", "is", "are", "be", "when", "then", "that",
    "this", "at", "by", "as", "from", "into", "out", "up", "do", "does",
  ]);
  const words = `${trigger} ${steps.join(" ")}`
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2 && !stop.has(w));
  return [...new Set(words)].slice(0, 12);
}

/**
 * Build a candidate skill from distilled source material.
 * Throws on empty input rather than storing a hollow skill — a skill
 * with no steps is worse than no skill, because it looks actionable.
 */
export function buildSkillFromSource(
  input: SkillSourceInput,
  opts: { now?: string } = {},
): CapturedSkill {
  const trigger = clean(input.trigger);
  const steps = input.steps.map(clean).filter(Boolean);
  const sourceLabel = clean(input.sourceLabel);

  if (!trigger) throw new Error("A captured skill needs a trigger — when does it apply?");
  if (steps.length === 0) throw new Error("A captured skill needs at least one concrete step.");
  if (!sourceLabel) throw new Error("A captured skill must name its source.");

  const actionVerb = steps[0].split(/\s+/)[0]?.toLowerCase() ?? null;
  const key = buildSkillKey(trigger, actionVerb ?? "capture");

  const skill: Skill = {
    trigger,
    // Source-captured skills have no observed machine signals — the
    // operator has not been seen doing this yet. Empty is the honest value.
    trigger_signals: [],
    action_sequence: steps,
    action_verb: actionVerb,
    keywords: input.keywords?.map(clean).filter(Boolean).slice(0, 12) ?? deriveKeywords(trigger, steps),
    // Tier reflects SIZE, not confidence (tiny | tactical | strategic):
    // a one-step protocol is tiny, a multi-step one is tactical. Newness
    // is carried by `pending` + zero counters, not by a fake tier.
    tier: steps.length <= 2 ? "tiny" : "tactical",
    polarity: "do",
    // Never invent history. A captured protocol has fired zero times and
    // has NO success rate — not a zero success rate, which would read as
    // "tried and failed". Downstream ranking treats 0/0 as unproven.
    times_fired: 0,
    times_succeeded: 0,
    times_failed: 0,
    success_rate: 0,
    last_fired: null,
    graduated: false,
    manually_reviewed: false,
    review_note: null,
    // Provenance as STRUCTURE, not just prose: the evidence for this
    // skill is a document the operator read — never a task they did.
    // Anything ranking on observed evidence can tell the two apart.
    source_evidence: [{ type: "external_source", id: sourceLabel }],
    created_at: opts.now ?? new Date().toISOString(),
    updated_at: opts.now ?? new Date().toISOString(),
  };

  return { key, skill };
}

/** One-line provenance the operator sees on the candidate. */
export function sourceProvenance(input: SkillSourceInput): string {
  return `captured from: ${clean(input.sourceLabel)} · unproven until used`;
}
