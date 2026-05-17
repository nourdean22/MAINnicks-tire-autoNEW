/**
 * Action-intent detector · v10.0.177 · vocab-driven
 *
 * v10.0.175 introduced this layer with hand-rolled regex patterns.
 * v10.0.176 patched the completion-verb gap. v10.0.177 promotes the
 * verb vocabulary to a SHARED module (`lib/ai/action-vocab.ts`) so
 * input-side and output-side detection can never drift again.
 *
 * Most concepts (verb + object) live in the vocab. This file only
 * holds:
 *   · question-form short-circuits (so "what tasks do I have?" is
 *     not classified as a task action)
 *   · structural edge cases that don't fit verb+object (e.g.
 *     "add: X" with colon, "we're done with X")
 *   · entry orchestration
 *
 * Pure regex on user input. <1ms. Zero IO.
 */

import { intentEntries, type IntentEntry } from "@/lib/ai/action-vocab";

/**
 * Edge-case patterns that don't decompose into verb+object. Kept
 * here intentionally — the vocab handles the 80% case.
 */
const EDGE_INTENT_PATTERNS: IntentEntry[] = [
  // "break/split into tasks" — bulk creation via decomposition verb
  // rather than a creation verb. Specific to project planning.
  {
    regex: /\b(?:break|split)\b.{0,30}\b(?:into|down|out)\b.{0,30}\btasks?\b/i,
    intent: "bulk-task-create",
    expectedTool: "addTasksToProject",
  },
  // "tasks ... to project" — bulk variant where the object leads.
  {
    regex: /\btasks\b.{0,20}\bto\b.{0,30}\bproject\b/i,
    intent: "bulk-task-create",
    expectedTool: "addTasksToProject",
  },
  // "add this to my todo list" — list-form add. v10.0.391 · TIGHTENED.
  // Pre-fix matched "add me to the list", "put him in the inbox" ·
  // operator getting createTask fired on conversational mentions.
  // Now requires explicit todo/to-do/task-list object · 'inbox'
  // alone is too ambiguous (could mean email inbox · service-bay
  // inbox detail · etc) so dropped from the qualifier list.
  {
    regex: /\b(?:add|put|throw)\b.{0,40}\b(?:to|on|in)\b\s+(?:my|the)\s+(?:todo|to-?do|task\s+list)\b/i,
    intent: "task-add-to-list",
    expectedTool: "createTask",
  },
  // "add: X" / "add 'pick up parts'" — colon or quote as structural
  // signal that X is the task content. Less greedy than free-form
  // "add" (which could match "add me to call list").
  {
    regex: /\b(?:add|create)\b\s*[:"'`]/i,
    intent: "task-create",
    expectedTool: "createTask",
  },
  // "we're done with X" / "I'm done with X" — completion claim
  // without verb+object structure (pronoun + state).
  {
    regex: /\b(?:we'?re|i'?m)\s+done\s+with\b/i,
    intent: "task-complete",
    expectedTool: "completeTask",
  },
];

/**
 * Phrases that EXEMPT the message from forcing — operator is asking
 * a question or making an observation, not requesting an action.
 */
const QUESTION_PATTERNS: RegExp[] = [
  /^(?:what|who|when|where|why|how|which|did|do|does|is|are|can|could|should|would)\b/i,
  /\?$/,
  /\b(?:tell me|explain|show me|what are|do you know)\b/i,
  /^list\s+(?:all|the|my|me)\b/i,
];

export interface ActionIntent {
  intent: string;
  expectedTool: string | undefined;
  matchedSnippet: string;
}

/**
 * Cache materialized vocab entries (build once per process). The
 * vocab is static — no need to rebuild per call.
 */
const VOCAB_ENTRIES = intentEntries();

/**
 * Returns null when the user message is NOT an action request, or
 * an ActionIntent describing what tool the model is expected to
 * fire. Caller passes `toolChoice: "required"` to streamText when
 * non-null.
 *
 * Resolution order:
 *   1. Question short-circuit (questions never force tools)
 *   2. Edge patterns (most specific first)
 *   3. Vocab-derived patterns
 */
export function detectActionIntent(userMessage: string): ActionIntent | null {
  const text = userMessage.trim();
  if (!text || text.length < 4) return null;
  if (QUESTION_PATTERNS.some((re) => re.test(text))) return null;

  // Edge first (more specific structural cases).
  const all: IntentEntry[] = [...EDGE_INTENT_PATTERNS, ...VOCAB_ENTRIES];
  for (const { regex, intent, expectedTool } of all) {
    const m = regex.exec(text);
    if (m) {
      const start = Math.max(0, m.index - 20);
      const end = Math.min(text.length, m.index + m[0].length + 20);
      return {
        intent,
        expectedTool,
        matchedSnippet: text.slice(start, end).trim(),
      };
    }
  }
  return null;
}
