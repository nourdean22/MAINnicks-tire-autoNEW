/**
 * salvage-tool-input · 2026-09-18
 *
 * WHAT THIS FIXES, MEASURED. `scripts/tool-input-failure-census.ts` split every
 * recorded tool failure in `tool_telemetry.lastErrors` into name-failures and
 * ARGUMENT failures, then split each of those by whether the tool has been
 * called in the last 14 days. Live evidence: **argument 11, name 1** — and all
 * 11 are a single shape, `searchMemories` receiving two or three JSON objects
 * glued into one arguments string:
 *
 *   {"query":"master prompt identity patterns","limit":5}{}{"limit":5,"scope":"all"}
 *   {"query":"master prompt identity ...","limit":10}{"query":"operator system ...","limit":10}
 *
 * The model emitted several tool calls; they arrived concatenated. `JSON.parse`
 * rejects the whole string, the SDK raises `InvalidToolInputError`, and
 * `repair-tool-call.ts` declined that class by design ("a different failure mode
 * we deliberately leave to the SDK"). That design note predates the measurement
 * and had it backwards: the class it declines is the only one still happening.
 *
 * WHY THE FIRST OBJECT AND NOT A MERGE. Each concatenated object is a SEPARATE
 * call the model intended. Taking the first preserves its first intent. Merging
 * them would fabricate an argument set the model never emitted — given
 * {"query":"A"} and {"query":"B"} there is no honest merge, only a mongrel. The
 * 2nd+ calls are genuinely lost, which is a real cost; the alternative today is
 * losing all of them, so this is strictly better and never equal-or-worse.
 *
 * WHY THIS CANNOT REGRESS ANYTHING. Three independent guards:
 *   1. It only runs on input the SDK has ALREADY rejected. There is no path
 *      where a working call is rerouted through here.
 *   2. A clean single JSON value returns null — `parts[0] === text` means
 *      nothing was concatenated, so the failure is a genuine type error and
 *      belongs to the SDK, untouched.
 *   3. When a validator is supplied, a candidate that fails it is skipped, and
 *      if none validate the whole salvage returns null. The caller passes the
 *      tool's own zod schema, so a repair is only ever returned when it will
 *      actually parse.
 * Even without guard 3 the SDK re-validates whatever a repair returns, so the
 * worst case is the identical tool-error the operator sees today.
 */

/** Returns true when `value` is an acceptable input object for the tool. */
export type InputValidator = (value: unknown) => boolean;

export interface SalvagedInput {
  /** The chosen object, re-serialised. */
  input: string;
  /** Which candidate won (0-based) — 0 unless earlier ones failed validation. */
  index: number;
  /** How many top-level JSON values the raw string actually contained. */
  candidates: number;
}

/**
 * Split a string into its top-level JSON values by brace/bracket balance.
 *
 * Quote-aware and escape-aware, because a brace inside a string literal
 * ({"query":"a {b} c"}) would otherwise close the object early and produce two
 * unparseable fragments from one valid call — turning a repairable payload into
 * a declined one.
 *
 * Deliberately does NOT track bracket TYPE, so `{"a":1]` scans as one candidate
 * rather than none. That is safe because every candidate is handed to
 * `JSON.parse` afterwards, which rejects the mismatch. A lenient scanner plus a
 * strict parser beats a strict scanner that silently drops recoverable input.
 */
export function splitTopLevelJson(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];

    if (inString) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inString = false;
      continue;
    }

    if (c === '"') {
      inString = true;
      continue;
    }
    if (c === "{" || c === "[") {
      if (depth === 0) start = i;
      depth += 1;
      continue;
    }
    if (c === "}" || c === "]") {
      // A closer at depth 0 is stray punctuation, not the end of a value.
      if (depth === 0) continue;
      depth -= 1;
      if (depth === 0 && start >= 0) {
        out.push(text.slice(start, i + 1));
        start = -1;
      }
    }
  }

  return out;
}

/**
 * Recover a usable tool-input object from a malformed arguments string.
 *
 * Returns null — meaning "decline, let the SDK do what it does today" — when
 * the input is empty, contains no complete JSON value, is a single clean value
 * (a genuine type error, not this defect), or when a validator was supplied and
 * no candidate satisfies it.
 */
export function salvageToolInput(
  raw: string | undefined,
  isValid?: InputValidator,
): SalvagedInput | null {
  const text = (raw ?? "").trim();
  if (text.length === 0) return null;

  const parts = splitTopLevelJson(text);
  if (parts.length === 0) return null;

  // Nothing was concatenated or truncated: the string IS one JSON value and it
  // still failed validation, so the problem is the value's shape, not its
  // framing. Repairing it here would mean guessing at the operator's intent.
  if (parts.length === 1 && parts[0] === text) return null;

  for (let i = 0; i < parts.length; i += 1) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(parts[i]) as unknown;
    } catch {
      continue;
    }
    // Tool inputs are objects. An array or scalar that happens to sit at the
    // top level is not a call, and passing one on would only re-fail.
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) continue;
    if (isValid && !isValid(parsed)) continue;
    return { input: JSON.stringify(parsed), index: i, candidates: parts.length };
  }

  return null;
}
