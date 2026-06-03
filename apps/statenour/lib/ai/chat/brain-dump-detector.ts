/**
 * v10.0.231 · True if `text` reads like a brain dump (declarative
 * thought / observation / decision / plan) rather than a question
 * or command directed at Nick. Used to gate journal-ingest so chat
 * questions don't get parsed into phantom INBOX tasks.
 *
 * Pure heuristic · zero AI cost · runs every chat turn so it has to
 * be fast. Bias is "skip when uncertain" — false negatives just mean
 * a real brain dump doesn't extract; false positives mean phantom
 * tasks (which is the bug we're fixing).
 *
 * Looks like a question/command (SKIP ingest):
 *   · ends in `?`
 *   · starts with what / who / when / where / why / how / which
 *   · starts with can / could / would / will / should / does / do
 *   · starts with is / are / was / were / am
 *   · starts with show / find / list / look up / check / search /
 *     give / tell / explain / write / draft / generate / create /
 *     fetch / pull / get / make
 */
export function looksLikeBrainDump(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length === 0) return false;
  // Question by punctuation · scan only the last ~30 chars to avoid
  // a `?` deep in a paragraph counting as the question marker.
  const tail = trimmed.slice(-30);
  if (tail.includes("?")) return false;
  // Question/command by leading word · case-insensitive
  const leadWord = trimmed.toLowerCase().match(/^([a-z']+)/)?.[1] ?? "";
  const QUESTIONS = new Set([
    "what", "whats", "what's", "who", "whos", "who's",
    "when", "where", "why", "how", "which",
    "can", "could", "would", "will", "should",
    "do", "does", "did", "is", "are", "was", "were", "am",
  ]);
  const COMMANDS = new Set([
    "show", "find", "list", "look", "check", "search",
    "give", "tell", "explain", "write", "draft", "generate",
    "create", "fetch", "pull", "get", "make", "run", "open",
    "search", "summarize", "translate", "describe",
  ]);
  if (QUESTIONS.has(leadWord) || COMMANDS.has(leadWord)) return false;
  return true;
}
