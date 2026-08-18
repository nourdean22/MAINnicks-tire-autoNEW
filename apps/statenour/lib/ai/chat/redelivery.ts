/**
 * lib/ai/chat/redelivery.ts · deterministic retry re-delivery (2026-08-18).
 *
 * WHY THIS EXISTS — the persona golden set's most stubborn confirmed
 * regression: the operator reports a glitch and says "Retry", and Nick
 * generates a NEW deliverable instead of re-sending the lost one
 * (persona-obedience-retry-means-retry: flagged in every live run;
 * harvested from a real production turn). The CONFIRMATION_EXECUTES
 * prompt rule was tried first and measurably did NOT fix it — with the
 * rule verified present in the replay prompt, the model still
 * regenerated (1.1/10 post-rule). Root cause is structural: an LLM
 * re-GENERATES; it does not copy its prior turn, even when that turn
 * sits in context and the instruction says "same items, same
 * substance".
 *
 * So re-delivery is deterministic: when the operator's message is a
 * bare re-send request, the chat pipeline re-serves the STORED last
 * assistant text verbatim — no model call, no drift, ~200ms.
 *
 * SCOPE IS DELIBERATELY TIGHT (false positives hijack real asks):
 *   · explicit re-send verbs ("resend", "send it again", "say that
 *     again", "repeat that") fire on their own;
 *   · bare "retry" fires ONLY with loss/glitch context in the same
 *     message ("app was bugging", "it crashed", "I lost that") —
 *     production "retry" can also mean re-attempt an ACTION, which
 *     must go to the model;
 *   · any modifier ("retry but shorter", "resend with the prices
 *     added") goes to the model — the operator asked for a CHANGED
 *     deliverable, not the same one;
 *   · long messages never fire — a real re-send ask is short.
 *
 * Consumed by BOTH the chat interceptors (production) and the eval
 * runner's callNick (tests/eval/run-suite.ts), so the golden set
 * measures the system Nick actually is, not the bare model.
 */

/** Explicit re-send verbs — sufficient on their own. */
const RESEND_VERB =
  /\b(re-?send|send\s+(it|that|this)\s+again|say\s+(it|that)\s+again|repeat\s+that|paste\s+(it|that)\s+again)\b/i;

/** "retry"-family verbs — need loss/glitch context to fire. */
const RETRY_VERB = /\b(retry|re-?run\s+that|try\s+(that|it)\s+again)\b/i;

/** Evidence the prior output was LOST (glitch, crash, didn't arrive). */
const LOSS_CONTEXT =
  /\b(bug(g(ed|ing))?|glitch(ed|ing)?|crash(ed|ing)?|froze|frozen|error(ed)?|didn'?t\s+(come\s+through|load|show|send)|lost\s+(it|that)|disappeared|blank(ed)?|cut\s+off|app\s+(was|is|kept)\s+\w+ing)\b/i;

/**
 * A modifier means the operator wants a CHANGED deliverable — that is
 * generation, not re-delivery. Checked against the whole message.
 */
const MODIFIER =
  /\b(but|with|without|instead|except|shorter|longer|different(ly)?|add|remove|change|update|fix|expand|summar|as\s+a|in\s+\w+\s+format)\b/i;

/** A real re-send ask is short. Above this it's a new instruction. */
const MAX_LEN = 120;

export function isRedeliveryRequest(text: string): boolean {
  const t = (text ?? "").trim();
  if (!t || t.length > MAX_LEN) return false;
  if (MODIFIER.test(t)) return false;
  if (RESEND_VERB.test(t)) return true;
  return RETRY_VERB.test(t) && LOSS_CONTEXT.test(t);
}
