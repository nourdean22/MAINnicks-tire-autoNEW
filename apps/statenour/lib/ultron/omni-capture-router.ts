/**
 * OMNI-CAPTURE ROUTER
 *
 * Decides what to do with a line of user input on the Ultron ask box.
 * Prefixes:
 *   /ask    — stream a Nick answer inline (default if no prefix)
 *   /decide — decision log entry (stakes / chosen / reasoning)
 *   /dump   — brain dump, Nick parses + sorts
 *   /park   — store in parking lot for Sunday review
 *   /search — memory/knowledge search (routes to /chat?q=)
 *   /plan   — AI compiles 3-6 executable steps from free-text intent
 *   /reflect— opens the structured reflection composer on /journal
 *
 * No prefix: Ultron auto-classifies.
 *   - Ends with "?" → ask
 *   - Starts with a strong verb → task-like → dump
 *   - Contains "should i" / "or" (as disjunction) → decide
 *   - Otherwise → dump
 *
 * This module is pure — no I/O. Callers route based on the returned intent.
 */

export type CaptureIntent =
  | { kind: "ask"; text: string }
  | { kind: "task"; text: string }    // Apr 18 — action-verb + target, concrete single todo
  | { kind: "decide"; text: string }
  | { kind: "dump"; text: string }
  | { kind: "park"; text: string }
  | { kind: "search"; text: string }
  | { kind: "plan"; text: string }
  | { kind: "reflect"; text: string };

/** Visible intent kinds the IntentChip cycles through (in order).
 *  `park` / `plan` / `reflect` remain reachable via slash prefix but
 *  don't show in the chip carousel — keeps the cycle tight. */
export const CYCLEABLE_KINDS = ["ask", "task", "decide", "dump", "search"] as const;
export type CycleableKind = typeof CYCLEABLE_KINDS[number];

const QUESTION_WORDS = ["what", "how", "why", "when", "where", "who", "should", "can", "is", "are", "do", "does"];
const DECIDE_TOKENS = [/\bshould i\b/i, /\bworth it\b/i, /\bpick between\b/i, /\b(vs|versus)\b/i, /\bwhich\b/i];
const ACTION_VERBS = [
  "call", "text", "email", "write", "send", "book", "schedule", "pay", "buy",
  "finish", "ship", "draft", "review", "close", "log", "pick", "clean", "prep",
  "order", "ask", "follow up", "meet", "confirm", "fix", "update", "post",
];
/** Words that, when present, suggest reflective/emotional dump rather than a task. */
const DUMP_HINTS = [
  /\bfeel(ing)?\b/i, /\bstruggle\b/i, /\bfrustrat/i, /\boverwhelm/i,
  /\bi think\b/i, /\bi want\b/i, /\bi've been\b/i, /\bnotice\b/i, /\brealized\b/i,
];
const SEARCH_HINTS = [
  /\bwhere did\b/i, /\bwhat did i\b/i, /\bremind me\b/i, /\bfind\b/i, /\blook up\b/i,
];

function stripPrefix(raw: string, prefix: string): string {
  return raw.slice(prefix.length).trim();
}

export function routeCapture(raw: string): CaptureIntent {
  const trimmed = raw.trim();
  if (!trimmed) return { kind: "dump", text: "" };

  // Explicit prefixes (power-user fallback — no longer advertised in
  // placeholder as of Apr 18, but still work for muscle memory)
  const lower = trimmed.toLowerCase();
  if (lower.startsWith("/ask "))    return { kind: "ask",    text: stripPrefix(trimmed, "/ask") };
  if (lower === "/ask")              return { kind: "ask",    text: "" };
  if (lower.startsWith("/task "))   return { kind: "task",   text: stripPrefix(trimmed, "/task") };
  if (lower === "/task")             return { kind: "task",   text: "" };
  if (lower.startsWith("/decide "))  return { kind: "decide", text: stripPrefix(trimmed, "/decide") };
  if (lower === "/decide")           return { kind: "decide", text: "" };
  if (lower.startsWith("/dump "))    return { kind: "dump",   text: stripPrefix(trimmed, "/dump") };
  if (lower === "/dump")             return { kind: "dump",   text: "" };
  if (lower.startsWith("/park "))    return { kind: "park",   text: stripPrefix(trimmed, "/park") };
  if (lower === "/park")             return { kind: "park",   text: "" };
  if (lower.startsWith("/search "))  return { kind: "search", text: stripPrefix(trimmed, "/search") };
  if (lower === "/search")           return { kind: "search", text: "" };
  if (lower.startsWith("/plan "))    return { kind: "plan",   text: stripPrefix(trimmed, "/plan") };
  if (lower === "/plan")             return { kind: "plan",   text: "" };
  if (lower.startsWith("/reflect ")) return { kind: "reflect", text: stripPrefix(trimmed, "/reflect") };
  if (lower === "/reflect")          return { kind: "reflect", text: "" };

  // ── Auto-classify ──────────────────────────────────────────
  // Order matters: most specific shapes first.

  // Search — explicit phrasing ("where did I see…", "remind me…")
  for (const rx of SEARCH_HINTS) {
    if (rx.test(lower)) return { kind: "search", text: trimmed };
  }

  // Decide FIRST — "should I ship" is semantically a decision, not
  // a question. Checking DECIDE_TOKENS before QUESTION_WORDS makes
  // "should I X" land as decide rather than getting eaten by the
  // "should" QUESTION_WORD. The trailing "?" short-circuit above
  // still wins when Nour writes an actual question.
  for (const rx of DECIDE_TOKENS) {
    if (rx.test(lower)) return { kind: "decide", text: trimmed };
  }

  // Ask — question shape (endswith ? or starts with question word)
  if (trimmed.endsWith("?")) return { kind: "ask", text: trimmed };
  const firstWord = lower.split(/\s+/)[0] ?? "";
  if (QUESTION_WORDS.includes(firstWord)) return { kind: "ask", text: trimmed };

  // Task — action verb + short form (<100 char). The threshold keeps
  // long reflective paragraphs that happen to start with "send"
  // (e.g. "send the Dania text, but I've been thinking…") routed to
  // dump instead of chopped into a task.
  const isShort = trimmed.length < 100;
  const startsWithAction = ACTION_VERBS.some((v) => lower.startsWith(v + " ") || lower === v);
  if (isShort && startsWithAction) return { kind: "task", text: trimmed };

  // Dump — long-form OR has emotional/reflective hints
  for (const rx of DUMP_HINTS) {
    if (rx.test(lower)) return { kind: "dump", text: trimmed };
  }

  // Default: long-form thought → brain dump
  return { kind: "dump", text: trimmed };
}

/** Next kind in the visible chip cycle after `current`. */
export function cycleIntentKind(current: CaptureIntent["kind"]): CycleableKind {
  // If current isn't cycleable (park/plan/reflect), cycle starts at ask.
  const i = (CYCLEABLE_KINDS as readonly string[]).indexOf(current);
  if (i === -1) return CYCLEABLE_KINDS[0];
  return CYCLEABLE_KINDS[(i + 1) % CYCLEABLE_KINDS.length];
}
