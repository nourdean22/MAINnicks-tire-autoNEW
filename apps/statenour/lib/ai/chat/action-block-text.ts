/**
 * Does this reply text carry an action block? The agent layer parses
 * ```action fences and [ACTION: {...}] markers out of the model's text and
 * runs them AFTER the stream (parseActions in lib/ai/nick-agent.ts), with no
 * tool part and no receipt. Deliberately broader than that parser: any
 * fence-or-marker lookalike counts, valid JSON or not, because a replay of a
 * reply that might have run an action is the failure this exists to stop.
 * tests/ai/nick-agent-actions.test.ts pins that it never misses what the
 * parser extracts. Pure, so the client-side Retry gate can import it.
 */
const ACTION_BLOCK_LOOKALIKE = /```\s*action|\[\s*action\s*:/i;

export function hasActionBlock(text: string): boolean {
  return ACTION_BLOCK_LOOKALIKE.test(text);
}
