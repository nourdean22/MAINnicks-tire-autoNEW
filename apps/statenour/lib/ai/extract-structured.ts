// v10.0.226 · server-only · routes that import this module pass
// brain-memory + provider data through it. Same client-bundle leak
// risk as budget.ts — pinned at compile time.
import "server-only";

import { logError } from "@/lib/utils/error-log";

/**
 * Robust structured-JSON extraction from AI text output · v10.0.226.
 *
 * Why this exists · pre-226 every AI route had its own bespoke
 * parsing logic — strip-fences-then-try-JSON.parse-then-regex-find-
 * a-shape — duplicated ~6 ways with subtle differences. When parsing
 * failed each route silently fell back to `[]` or `{}`, hiding bugs:
 *   · /api/ai/tasks returned 0 suggestions when JSON had a trailing
 *     comma (model artifact common with deepseek + qwen)
 *   · /api/ai/plan-project returned `{}` and the UI rendered an
 *     empty plan with no surface error
 *
 * The helper does three things in order:
 *   1. Strip markdown fences + leading commentary
 *   2. Try JSON.parse on the whole thing
 *   3. If that fails, regex-extract the OUTERMOST `[...]` or `{...}`
 *      and try again, with one repair pass for common AI mistakes:
 *        · trailing commas (`,]` `,}`)
 *        · unescaped newlines inside string literals
 *        · single-quoted keys / values
 *
 * If ALL three fail, returns `{ ok: false, error, raw }` so the
 * caller can decide: ask the model to repair, surface the parse
 * error, or fall back gracefully.
 *
 * Usage:
 *   const parsed = extractStructured<TaskShape[]>(result.text, "array");
 *   if (!parsed.ok) {
 *     log.warn("ai_parse_failed", { error: parsed.error, raw: parsed.raw.slice(0, 200) });
 *     return { tasks: [] };  // or trigger a repair retry
 *   }
 *   const tasks = parsed.value;  // typed
 */

export type ExtractKind = "array" | "object";

export interface ExtractResult<T> {
  ok: true;
  value: T;
  /** Tracks how the value was reached: parse | regex-extract | repaired */
  via: "direct" | "extracted" | "repaired";
}

export interface ExtractError {
  ok: false;
  error: string;
  /** First 500 chars of the raw text · for logging without dumping full prompts */
  raw: string;
}

/** Strip markdown fences, leading commentary like "Here's the JSON:", and
 *  trailing prose that's outside the structured payload. Conservative —
 *  if anything looks ambiguous we leave it for the JSON.parse step. */
function stripWrappers(text: string): string {
  let s = text.trim();

  // Code fences · ``` or ```json or ```javascript
  s = s.replace(/^```(?:json|javascript|js)?\s*\n?/i, "");
  s = s.replace(/\n?```\s*$/i, "");

  // Common preamble · "Here's the JSON:" / "Output:" / "Result:"
  s = s.replace(/^[A-Za-z][A-Za-z\s']{0,40}:\s*\n+/, "");

  return s.trim();
}

/** Repair a JSON-ish blob so JSON.parse accepts it. Returns null when
 *  unrepairable so the caller can fall through to error. */
function repair(text: string): string | null {
  let s = text;

  // Trailing commas before ] or } · `[1,2,]` `{a:1,}`
  s = s.replace(/,(\s*[\]}])/g, "$1");

  // Single-quoted keys → double-quoted
  s = s.replace(/'([A-Za-z_$][\w$]*)'\s*:/g, '"$1":');

  // Unescaped newlines inside strings · find "..." spans and escape
  // raw \n inside them. Conservative — only operates on already-quoted
  // sections. Skip if we don't see any quotes (won't help anyway).
  if (/"/.test(s)) {
    s = s.replace(/"([^"\\]*(\\.[^"\\]*)*)"/gs, (_match, inner: string) => {
      return `"${inner.replace(/\n/g, "\\n").replace(/\r/g, "\\r")}"`;
    });
  }

  // Quick sanity check — if we can't even parse after repairs, give up.
  try {
    JSON.parse(s);
    return s;
  } catch {
    return null;
  }
}

/** Locate the outermost balanced `[...]` (kind=array) or `{...}` (kind=object)
 *  block in `text`. Returns the substring or null. */
function findOutermost(text: string, kind: ExtractKind): string | null {
  const opener = kind === "array" ? "[" : "{";
  const closer = kind === "array" ? "]" : "}";
  const start = text.indexOf(opener);
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escaped) { escaped = false; continue; }
    if (ch === "\\") { escaped = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === opener) depth++;
    else if (ch === closer) {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/**
 * Extract a structured value from AI text. `kind` controls whether
 * we expect a top-level array or object · returns a discriminated
 * union so the caller can branch on `parsed.ok`.
 */
export function extractStructured<T>(
  text: string,
  kind: ExtractKind,
): ExtractResult<T> | ExtractError {
  const raw = (text ?? "").slice(0, 500);
  if (!text || typeof text !== "string") {
    return { ok: false, error: "empty or non-string input", raw };
  }

  const stripped = stripWrappers(text);

  // Pass 1 · try the whole stripped text
  try {
    const value = JSON.parse(stripped) as T;
    return { ok: true, value, via: "direct" };
  } catch { /* fall through */ }

  // Pass 2 · find outermost block + parse
  const block = findOutermost(stripped, kind);
  if (block) {
    try {
      const value = JSON.parse(block) as T;
      return { ok: true, value, via: "extracted" };
    } catch { /* fall through to repair */ }

    // Pass 3 · repair common artifacts
    const repaired = repair(block);
    if (repaired) {
      try {
        const value = JSON.parse(repaired) as T;
        return { ok: true, value, via: "repaired" };
      } catch (err) {
        // Unreachable since repair() validates · if this fires the repair/parse invariant broke.
        logError("ai.extract-structured", err, { fn: "extractStructured", kind, pass: "repaired-block" }, "warn");
      }
    }
  }

  // Last-ditch · try repair on the whole stripped text
  const repairedAll = repair(stripped);
  if (repairedAll) {
    try {
      const value = JSON.parse(repairedAll) as T;
      return { ok: true, value, via: "repaired" };
    } catch (err) {
      // Fall through to error · unreachable since repair() validates.
      logError("ai.extract-structured", err, { fn: "extractStructured", kind, pass: "repaired-all" }, "warn");
    }
  }

  return {
    ok: false,
    error: `failed to extract ${kind} from AI output`,
    raw,
  };
}

/** Convenience for the most common case · array of typed records. */
export function extractJsonArray<T>(text: string): ExtractResult<T[]> | ExtractError {
  return extractStructured<T[]>(text, "array");
}

/** Convenience for an object response. */
export function extractJsonObject<T>(text: string): ExtractResult<T> | ExtractError {
  return extractStructured<T>(text, "object");
}
