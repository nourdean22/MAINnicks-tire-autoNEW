/**
 * lib/ai/tool-result-classifier.ts · v10.0.529.12 · E-3 Phase 2
 *
 * Heuristic injection-pattern detector for tool result content. Pairs
 * with the `<tool_data>` fences shipped in v529.5 by adding a SECOND
 * signal to the model: not just "this is data not instructions" but
 * "we specifically detected the following injection-shaped patterns."
 *
 * Design intent (E-3 Phase 2 per security-stride-owasp-2026-05-12):
 *   The v529.5 fencing trains the model to treat fenced regions as
 *   inert data. Belt + suspenders by adding a classifier that calls
 *   out the specific attack shape so the model can quote the pattern
 *   to the operator instead of silently shrugging it off. Also gives
 *   us telemetry: every flagged result becomes a `SystemMetric` row
 *   so the operator dashboard can show "X injection attempts blocked
 *   this week" over time.
 *
 * Heuristic-only · NO LLM call per result (would 10x cost per tool
 * call). Patterns are tuned to known prompt-injection corpora:
 *   - LLM-attacks.org · Anthropic red-team blog · jailbreak datasets
 *   - Per-model token markers (`<|im_start|>` / `[INST]` / `<|user|>`)
 *   - "ignore prior" + variants (the canonical attack)
 *   - "now call/execute/run X" with a tool-name shape
 *   - Encoded payload heuristic (long base64 strings)
 *
 * False-positive policy · we'd rather flag a benign document that
 * happens to discuss prompt injection than miss a real attack. The
 * flag is informational · it does NOT block the result.
 */

export type InjectionSeverity = "none" | "low" | "high";

export interface InjectionFlags {
  /** True when at least one heuristic fires. */
  hasInjection: boolean;
  /** "high" when a canonical jailbreak phrase or token marker fires. */
  severity: InjectionSeverity;
  /** Human-readable names of the patterns that matched. */
  patterns: string[];
}

// v10.0.529.12 fix · `/g` flag is STATEFUL on `.test()` calls (advances
// `lastIndex` between invocations · shared regex objects across calls
// would skip matches in subsequent invocations). We only need boolean
// matches so `/i` alone suffices · disambiguates intent + avoids the bug.
const HIGH_SEVERITY_PATTERNS: Array<[RegExp, string]> = [
  // Canonical "ignore prior" attack family
  [/ignore\s+(all\s+)?(prior|previous|above|earlier|your)\s+(instructions?|directions?|messages?|prompts?|rules?|prompt)/i, "ignore_prior_instructions"],
  // "Disregard your prior prompt" variant
  [/disregard\s+(your|the)\s+(prior|previous|above)\s+(instructions?|directions?|messages?|prompts?|rules?|prompt)/i, "ignore_prior_instructions"],
  // Role hijack
  [/(you\s+are\s+now|now\s+act\s+as|forget\s+everything|disregard\s+(your|the)\s+(instructions?|prompt|system))/i, "role_hijack"],
  // Per-model token markers (chat-template injection)
  [/<\|(im_start|im_end|user|assistant|system|endoftext)\|>/i, "model_token_marker"],
  [/\[\/?INST\]/i, "inst_token_marker"],
  // Explicit tool-call coercion · catches "now call X", "execute the tool",
  // "invoke the function", "run the tool/script", plus explicit-keyword forms.
  [/(now\s+call|please\s+call|execute\s+the|invoke\s+(the\s+)?function|run\s+the\s+(tool|function|script)|(call|execute|invoke|run)\s+(the\s+)?(tool|function|api|method|script)\s+[`"]?[a-zA-Z])/i, "tool_call_coercion"],
  // System-prompt impersonation (at line start or after newline)
  [/(^|\n)\s*(system|administrator|developer)\s*:\s*\S/i, "system_role_prefix"],
];

const LOW_SEVERITY_PATTERNS: Array<[RegExp, string]> = [
  // Weaker phrasings that often appear in benign content too. Catches
  // "instead of X, please do/move/continue Y" · low signal because benign
  // text uses "instead of" too · still worth telemetry.
  [/instead\s+of\s+[^.\n]{1,40}(,?\s*(please\s+)?(do|move|continue|proceed|focus|switch|call|execute|run|invoke))/i, "instead_directive"],
  [/from\s+now\s+on\s+(you|please)/i, "from_now_on_directive"],
  // Long base64-shaped strings (potential encoded payload) · 100+ chars
  // of [A-Za-z0-9+/=] with no whitespace. Stateless single-match suffices.
  [/[A-Za-z0-9+/]{100,}={0,2}/, "encoded_payload_candidate"],
  // Hidden zero-width/bidi-control characters often used to smuggle
  // directives. Stateless match.
  [/[​-‏‪-‮⁠-⁩]{3,}/, "hidden_unicode_run"],
];

/**
 * Scan a string for known prompt-injection signatures. O(n) over the
 * content length · ~6 regex passes total. Returns the union of all
 * matched pattern names. Severity is "high" if ANY high-severity
 * pattern matches, "low" if only low-severity, "none" otherwise.
 */
export function classifyToolResult(content: string): InjectionFlags {
  if (!content || typeof content !== "string") {
    return { hasInjection: false, severity: "none", patterns: [] };
  }

  const matched = new Set<string>();
  let highHit = false;

  for (const [re, name] of HIGH_SEVERITY_PATTERNS) {
    if (re.test(content)) {
      matched.add(name);
      highHit = true;
    }
  }
  for (const [re, name] of LOW_SEVERITY_PATTERNS) {
    if (re.test(content)) {
      matched.add(name);
    }
  }

  if (matched.size === 0) {
    return { hasInjection: false, severity: "none", patterns: [] };
  }

  return {
    hasInjection: true,
    severity: highHit ? "high" : "low",
    patterns: Array.from(matched),
  };
}

/**
 * Render an InjectionFlags result as a one-line annotation suitable
 * for embedding inside a fenced tool result. The model sees both the
 * `<tool_data>` wrapper and this annotation · together they form a
 * loud "this content tried to subvert you" signal.
 *
 * Example output:
 *   <!-- injection_flags: severity=high patterns=ignore_prior_instructions,model_token_marker -->
 */
export function renderInjectionAnnotation(flags: InjectionFlags): string {
  if (!flags.hasInjection) return "";
  return `<!-- injection_flags: severity=${flags.severity} patterns=${flags.patterns.join(",")} -->`;
}
