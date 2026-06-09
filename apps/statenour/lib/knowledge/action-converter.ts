/**
 * Knowledge -> action converter (v1, heuristic, suggestion-only).
 *
 * Answers "what does this change?" for a piece of knowledge (a chat line, a
 * journal entry, a memory, a decision) and proposes ONE next move: create a
 * task, save a rule, start an experiment, log a decision, save a memory, or
 * ignore. It NEVER writes — it returns a suggestion the caller surfaces for
 * explicit confirmation. Sensitive/destructive suggestions are flagged
 * requiresApproval.
 *
 * Pure — no IO, no DB, no LLM. A future version may add an LLM refinement pass
 * behind a flag. See docs/project/NEXT-INTELLIGENCE-WAVE.md (P8).
 */

export type KnowledgeSource =
  | "chat"
  | "journal"
  | "memory"
  | "doc"
  | "link"
  | "decision"
  | "manual";

export type SuggestionKind =
  | "task"
  | "rule"
  | "experiment"
  | "decision"
  | "memory"
  | "ignore";

export interface ConvertInput {
  sourceType: KnowledgeSource;
  text: string;
  context?: string;
  entityId?: string;
  missionId?: string;
  domain?: string;
  mode?: string;
}

export interface ActionSuggestion {
  kind: SuggestionKind;
  title: string;
  explanation: string;
  /** 0..1 heuristic confidence. */
  confidence: number;
  /** For kind === "task": a concrete physical next step. */
  nextPhysicalAction?: string;
  suggestedDomain?: string;
  suggestedMissionId?: string;
  riskLevel: "low" | "medium" | "high";
  /** True for sensitive/destructive intents — surface a confirm step. */
  requiresApproval: boolean;
}

// Sensitive/destructive verbs — any of these means surface a confirm step.
const SENSITIVE = /\b(send|text|sms|email|message|post|publish|tweet|pay|charge|refund|delete|remove|cancel|fire|wire|transfer)\b/i;

const DECISION = /\b(decided|going with|i'?ll go with|we'?ll go with|chose|choosing|decision:)\b/i;
const RULE = /\b(always|never|every time|from now on|whenever|rule:|principle:|policy:|make it a habit)\b/i;
const EXPERIMENT = /\b(try|test|experiment|hypothesis|what if|let'?s see if|a\/b|pilot)\b/i;
const TASK = /\b(need to|needs to|should|have to|must|todo:?|follow up|follow-up|call|email|schedule|book|buy|order|fix|ship|finish|write|set up|reach out|remind)\b/i;

// Vague / non-actionable signals -> ignore.
const VAGUE = /\b(maybe|might|not sure|idk|i don'?t know|someday|whatever|hmm|thinking about)\b/i;

// Interrogative lead — a "?" sentence starting with one of these reads as a
// question to answer, not an action to take.
const INTERROGATIVE = /^(what|when|where|who|why|how|should|shall|can|could|would|will|do|does|did|is|are|am)\b/i;

const lc = (s: string) => s.toLowerCase();
const firstSentence = (s: string) => s.split(/[.!?\n]/)[0].trim();

/** Turn "I need to call the vendor" -> "Call the vendor". */
function toPhysicalAction(text: string): string {
  let s = firstSentence(text)
    .replace(/^\s*(i\s+)?(really\s+)?(need to|needs to|should|have to|must|want to|gotta)\s+/i, "")
    .replace(/^\s*todo:?\s*/i, "")
    .trim();
  if (!s) s = firstSentence(text);
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function clampTitle(text: string): string {
  const s = firstSentence(text) || text.trim();
  return s.length > 80 ? `${s.slice(0, 77)}...` : s;
}

/**
 * Convert knowledge into a single suggested action. Detection precedence:
 * ignore (vague/too-short/question) -> decision -> rule -> experiment ->
 * task -> memory (substantive fallback).
 */
export function convertToAction(input: ConvertInput): ActionSuggestion {
  const raw = (input.text ?? "").trim();
  const text = lc(raw);
  const base = {
    suggestedDomain: input.domain,
    suggestedMissionId: input.missionId,
  };
  const sensitive = SENSITIVE.test(raw);

  // ── ignore: too short ──
  if (raw.length < 12) {
    return {
      kind: "ignore",
      title: clampTitle(raw || "(empty)"),
      explanation: "Too short to act on.",
      confidence: 0.3,
      riskLevel: "low",
      requiresApproval: false,
      ...base,
    };
  }

  // Strong signals win BEFORE the question/vague gates (a hypothesis phrased as
  // "what if …?" is an experiment, not a bare question).

  // ── decision ──
  if (DECISION.test(text)) {
    return {
      kind: "decision",
      title: clampTitle(raw),
      explanation: "States a choice that was made — log it as a decision for replay.",
      confidence: 0.7,
      riskLevel: sensitive ? "medium" : "low",
      requiresApproval: sensitive,
      ...base,
    };
  }

  // ── rule ──
  if (RULE.test(text)) {
    return {
      kind: "rule",
      title: clampTitle(raw),
      explanation: "Reads as a repeatable principle — save it as a rule.",
      confidence: 0.72,
      riskLevel: sensitive ? "medium" : "low",
      requiresApproval: sensitive,
      ...base,
    };
  }

  // ── experiment ──
  if (EXPERIMENT.test(text) && !TASK.test(text)) {
    return {
      kind: "experiment",
      title: clampTitle(raw),
      explanation: "Frames a hypothesis to test — start it as an experiment.",
      confidence: 0.6,
      riskLevel: sensitive ? "medium" : "low",
      requiresApproval: sensitive,
      ...base,
    };
  }

  // ── ignore: tentative, or an interrogative question with no action ──
  const tentative = VAGUE.test(text) && !sensitive && !TASK.test(text);
  const bareQuestion = raw.endsWith("?") && INTERROGATIVE.test(raw) && !sensitive;
  if (tentative || bareQuestion) {
    return {
      kind: "ignore",
      title: clampTitle(raw),
      explanation: bareQuestion
        ? "Reads as a question to answer, not an action to take."
        : "Too tentative to convert — capture as a note if it matters.",
      confidence: 0.3,
      riskLevel: "low",
      requiresApproval: false,
      ...base,
    };
  }

  // ── task (a sensitive verb like send/charge/delete is itself an action) ──
  if (TASK.test(text) || sensitive) {
    return {
      kind: "task",
      title: clampTitle(raw),
      explanation: "Actionable — create a task with a concrete next step.",
      confidence: 0.8,
      nextPhysicalAction: toPhysicalAction(raw),
      riskLevel: sensitive ? "high" : "low",
      requiresApproval: sensitive,
      ...base,
    };
  }

  // ── memory: substantive but not actionable ──
  return {
    kind: "memory",
    title: clampTitle(raw),
    explanation: "Worth remembering but not directly actionable — save as memory.",
    confidence: 0.5,
    riskLevel: "low",
    requiresApproval: false,
    ...base,
  };
}
