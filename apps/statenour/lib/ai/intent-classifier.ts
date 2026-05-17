/**
 * Intent Classifier — silently infers which persona Nick should
 * wear for a given user turn. Apr 19.
 *
 * Nour's ask: "Nick infers persona from tone + intent — no visible
 * toggle." The old Master/Builder/Friend tabs were a constant
 * choice that Nour shouldn't have to make every turn.
 *
 * Approach (heuristic-first, zero AI call, <1ms):
 *
 *   BUILDER — code / deploy / debugging / implementation language.
 *             Wins when the turn mentions files, functions, commits,
 *             lib paths, SQL, errors, stack traces.
 *
 *   FRIEND  — emotional / relational / casual / vent. Wins when the
 *             turn is about feelings, people (first names), tiredness,
 *             hangout, "just talk", venting, weekend.
 *
 *   MASTER  — strategic / commercial / operational. Default when
 *             nothing else fires. The Nour-default.
 *
 * Manual override: if the user has set a persona in the ⋯ menu within
 * the last 30 minutes, that override wins. After 30min it decays and
 * inference takes over again so Nour isn't "stuck" in a mode because
 * of a decision from yesterday.
 *
 * Fail-safe: returns "master" on any exception.
 */

export type Persona = "master" | "builder" | "friend";

// ── Heuristic patterns ──────────────────────────────────────────────

// Builder: explicitly technical signals.
const BUILDER_SIGNALS: RegExp[] = [
  /\b(code|commit|deploy|push|merge|branch|pr|pull request|rebase)\b/i,
  /\b(file|function|class|component|module|import|export)\b/i,
  /\b(lib\/|app\/|components\/|api\/)[\w-]+/i,  // path references
  /\b(typescript|javascript|python|sql|prisma|react|next\.?js)\b/i,
  /\b(error|exception|stack ?trace|failing|broken|bug|crash)\b/i,
  /\b(schema|migration|database|query|endpoint|route)\b/i,
  /\b(env|environment|vercel|neon|render|docker|build)\b/i,
  /\b(refactor|implement|rewrite|patch|fix|test|debug)\b/i,
  /```[\s\S]*?```/,                              // fenced code blocks
  /\$\{[^}]+\}/,                                  // template literals
  /\b\w+\.(ts|tsx|js|jsx|py|sql|md|yaml)\b/i,    // file extensions
];

// Friend: emotional / casual / relational signals.
const FRIEND_SIGNALS: RegExp[] = [
  /\b(feel|feeling|felt|mood|tired|exhausted|burned out|overwhelmed)\b/i,
  /\b(vent|rant|talk to me|chat with me|just talk|need to talk)\b/i,
  /\b(lonely|anxious|scared|nervous|sad|happy|excited|grateful)\b/i,
  /\b(weekend|tonight|hangout|chill|relax|fun|hobby)\b/i,
  /\b(dania|mom|dad|brother|sister|family|friend|wife|gf)\b/i,
  /\bhow('?s| is) it going\b/i,
  /\b(life|living|existence|purpose|meaning)\b/i,
  /\bi('m| am) (just |really |so |)(tired|done|stuck|lost|stressed)\b/i,
  /\b(ugh|dammit|fuck|shit|hell|damn)\b/i,        // venting tones
];

// Master gets nothing — it's the fall-through default. Explicit master
// signals are kept minimal (business / strategy / ops).
const MASTER_REINFORCE: RegExp[] = [
  /\b(revenue|margin|profit|sales|customer|lead|deal|quote|estimate)\b/i,
  /\b(strategy|plan|roadmap|priority|focus|next move|decide|decision)\b/i,
  /\b(leverage|power|control|advantage|edge|moat|leverage)\b/i,
  /\b(shop|garage|nickstire|business|ops|operations|pipeline)\b/i,
  /\b(commit|promise|overdue|kept|broken)\b/i,     // commitment language
];

function countMatches(text: string, patterns: RegExp[]): number {
  let n = 0;
  for (const p of patterns) if (p.test(text)) n++;
  return n;
}

// ── Override window ────────────────────────────────────────────────

const OVERRIDE_KEY = "nour:nick-persona-override";
const OVERRIDE_TTL_MS = 30 * 60_000;  // 30 min

interface OverrideRecord {
  persona: Persona;
  setAt: number;
}

export function setPersonaOverride(persona: Persona) {
  if (typeof window === "undefined") return;
  try {
    const rec: OverrideRecord = { persona, setAt: Date.now() };
    localStorage.setItem(OVERRIDE_KEY, JSON.stringify(rec));
  } catch {
    // swallow
  }
}

export function readPersonaOverride(): OverrideRecord | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(OVERRIDE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as OverrideRecord;
    const age = Date.now() - parsed.setAt;
    if (age > OVERRIDE_TTL_MS) {
      localStorage.removeItem(OVERRIDE_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function clearPersonaOverride() {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(OVERRIDE_KEY);
  } catch {
    // swallow
  }
}

// ── Classifier ────────────────────────────────────────────────────

export interface InferenceResult {
  persona: Persona;
  source: "override" | "inference" | "default";
  signals: { builder: number; friend: number; master: number };
}

/**
 * Infer persona for a single user turn.
 * @param text  the user's raw message
 * @param opts.useOverride whether to honor manual overrides (default true)
 */
export function inferPersona(
  text: string,
  opts: { useOverride?: boolean } = {},
): InferenceResult {
  const { useOverride = true } = opts;

  if (useOverride) {
    const override = readPersonaOverride();
    if (override) {
      return {
        persona: override.persona,
        source: "override",
        signals: { builder: 0, friend: 0, master: 0 },
      };
    }
  }

  const builder = countMatches(text, BUILDER_SIGNALS);
  const friend = countMatches(text, FRIEND_SIGNALS);
  const master = countMatches(text, MASTER_REINFORCE);

  // Builder wins if at least 2 builder signals OR 1 builder + a code block.
  if (builder >= 2 || /```[\s\S]*?```/.test(text)) {
    return { persona: "builder", source: "inference", signals: { builder, friend, master } };
  }
  // Friend wins on strong emotional signal (≥2) OR explicit venting
  // phrase (≥1 friend match + no builder signal).
  if (friend >= 2 || (friend >= 1 && builder === 0 && master === 0)) {
    return { persona: "friend", source: "inference", signals: { builder, friend, master } };
  }
  // Otherwise Master — default for Nour's operator mode.
  return {
    persona: "master",
    source: master > 0 ? "inference" : "default",
    signals: { builder, friend, master },
  };
}

/**
 * Classify a batch of recent user messages — useful if we want to
 * average across the current conversation instead of just the latest
 * turn. Returns the modal persona.
 */
export function inferPersonaFromConversation(messages: string[]): InferenceResult {
  if (messages.length === 0) {
    return {
      persona: "master",
      source: "default",
      signals: { builder: 0, friend: 0, master: 0 },
    };
  }
  // Weight recent messages higher
  const totals = { builder: 0, friend: 0, master: 0 };
  const recent = messages.slice(-5);
  for (let i = 0; i < recent.length; i++) {
    const weight = i === recent.length - 1 ? 2 : 1; // latest turn counts double
    const r = inferPersona(recent[i], { useOverride: false });
    totals.builder += r.signals.builder * weight;
    totals.friend += r.signals.friend * weight;
    totals.master += r.signals.master * weight;
  }
  if (totals.builder >= totals.friend && totals.builder >= totals.master && totals.builder > 0) {
    return { persona: "builder", source: "inference", signals: totals };
  }
  if (totals.friend > totals.builder && totals.friend >= totals.master) {
    return { persona: "friend", source: "inference", signals: totals };
  }
  return { persona: "master", source: totals.master > 0 ? "inference" : "default", signals: totals };
}
