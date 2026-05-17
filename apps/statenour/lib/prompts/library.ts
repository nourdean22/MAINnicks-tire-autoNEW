/**
 * Prompt Library · v10.0.165 · May 03 · prompt-library skill scaffold
 *
 * Single source of truth for reusable prompt templates inside
 * statenour-os. Pre-fix: prompts were scattered across 30+ files
 * (system-prompt.ts, narrator.ts, predict-engine.ts, suggestion-cache.ts,
 * outcome-tracker.ts, etc.) with no central inventory, no versioning,
 * no operator-side editability.
 *
 * Design (per kaizen + JIT):
 *   · TYPED registry · every prompt has id + version + category + body
 *   · DERIVATION-ONLY · doesn't replace existing inline prompts in this
 *     ship; new prompts get registered here, old ones migrate slice-
 *     by-slice as they're touched
 *   · OPERATOR-VISIBLE · /system/prompts reads from the registry so
 *     Nour can browse what's there
 *   · POLICY-LINKED · each entry maps to an AutomationPolicy id
 *     ("prompt.<name>") for the v10.0.148 governance spine
 *
 * Categories follow the f/awesome-chatgpt-prompts taxonomy that the
 * /prompt-library skill recommends — role-based, task-specific,
 * analysis, creative, transformation. Plus statenour-specific:
 * verifier (anti-fabrication banners), ground (entity grounding),
 * suggester (smart-replies fallbacks), critic (output review).
 */

export type PromptCategory =
  | "role"           // act as X
  | "task"           // do specific thing
  | "analysis"       // evaluate / review
  | "creative"       // generate / brainstorm
  | "transformation" // convert / migrate
  | "verifier"       // statenour anti-fabrication
  | "ground"         // statenour truth-grounding
  | "suggester"      // statenour smart replies / nudges
  | "critic";        // statenour output review

export interface PromptTemplate {
  /** Stable id · matches AutomationPolicy "prompt.<id>" */
  id: string;
  /** Human-readable label */
  name: string;
  /** What this prompt is for · operator-readable */
  description: string;
  category: PromptCategory;
  /** Semver-ish · bump on substantive change */
  version: string;
  /** When the prompt was first registered */
  added: string;
  /** Tags for filtering · ["chat", "antigravity-workflow", "production"] */
  tags: string[];
  /** The actual prompt body · supports {{placeholders}} for templating */
  body: string;
  /** Required placeholders (validated at fillTemplate time) */
  variables?: string[];
  /** Pointer to the live caller (lib path) — null when unused/library-only */
  usedBy?: string;
}

// ─── Statenour anti-fabrication prompts ───────────────────────────

const ANTI_FABRICATION_RULE: PromptTemplate = {
  id: "verifier.anti-fabrication-rule",
  name: "Anti-Fabrication TRUTH RULE",
  description:
    "The L1 system-prompt rule that tells Nick never to claim a past-tense action without a tool call backing it. Drove the v10.0.162 ship after the Bay 5 Revive hallucination.",
  category: "verifier",
  version: "1.0.0",
  added: "2026-05-03",
  tags: ["chat", "system-prompt", "production", "fabrication"],
  body: [
    "## TRUTH RULE — never claim past-tense action without a tool call",
    "If you DID NOT call a tool, you DID NOT do the action. Period. Words like \"added\", \"created\", \"scheduled\", \"sent\", \"saved\", \"linked\", \"moved\", \"marked done\", \"pinned\" — when written in past tense — implicitly claim \"I executed this.\" If the corresponding tool call did not happen in this turn, that claim is fabrication.",
    "✗ Bad (no tool fired): \"Yes, added the tasks to {{ENTITY}}.\"",
    "✗ Bad (no tool fired): \"I sent the follow-up email.\"",
    "✗ Bad (no tool fired): \"Saved that to your brain.\"",
    "✓ Good (tool didn't fire): \"I can add those tasks if you confirm — want me to fire createTask for each?\"",
    "✓ Good (tool didn't fire): \"Let me know and I'll send the follow-up via sendEmail.\"",
    "✓ Good (tool DID fire): \"Added 3 tasks to {{ENTITY}} [tool: createTask × 3].\"",
    "When in doubt: hedge with \"I would\" / \"I can\" / \"want me to\" / \"let me know if you want\" — operator can always say yes and trigger the next turn. The bigger sin is fabricating completion that the operator then trusts.",
    "Server-side verifier auto-rewrites fabrication to a hedge before persisting, then flags the message [verifier-corrected]. Don't try to outrun it — write honestly to begin with.",
  ].join("\n"),
  variables: ["ENTITY"],
  usedBy: "lib/ai/system-prompt.ts § TRUTH RULE",
};

const FABRICATION_BANNER: PromptTemplate = {
  id: "verifier.fabrication-banner",
  name: "Fabrication Verifier Banner",
  description:
    "The L2 banner prepended to assistant text when fabrication is detected. Marker prefix is what L3's history loader scans for.",
  category: "verifier",
  version: "1.0.0",
  added: "2026-05-03",
  tags: ["chat", "system-prompt", "production", "fabrication"],
  body: [
    "[VERIFIER · v10.0.162] ⚠ The response below claimed {{COUNT}} action ({{VERBS}}) but no matching tool call fired. Treat the claim as **unverified**. If you want the action actually performed, ask me to retry — I'll fire the tool this time.",
    "",
    "_Original response (unverified):_",
    "",
  ].join("\n"),
  variables: ["COUNT", "VERBS"],
  usedBy: "lib/ai/chat/fabrication-rewriter.ts",
};

const HISTORY_NEUTRALIZATION: PromptTemplate = {
  id: "verifier.history-neutralization",
  name: "History Neutralization Note",
  description:
    "The L3 replacement text that takes the place of a fabricated assistant turn when it appears in conversation history. Stops compounding lies across turns.",
  category: "verifier",
  version: "1.0.0",
  added: "2026-05-03",
  tags: ["chat", "system-prompt", "production", "fabrication"],
  body: "[VERIFIER NOTE: my previous response was flagged as fabricated (claimed actions without firing tools). Disregard it. Do not reference it. Treat the operator's last request as still open.]",
  usedBy: "lib/ai/chat/sanitize-history.ts § neutralizeFabricatedHistory",
};

const TRUTH_GROUNDING_BLOCK: PromptTemplate = {
  id: "ground.truth-grounding-header",
  name: "Truth Grounding System Block",
  description:
    "The L4 system-fact block prepended when the chat route detects a named entity (project/mission). Ground truth from DB is injected so the model can't claim a different number.",
  category: "ground",
  version: "1.0.0",
  added: "2026-05-03",
  tags: ["chat", "system-prompt", "production", "fabrication"],
  body: [
    "## TRUTH GROUNDING — verified state at turn start",
    "These facts come straight from the database. If you're tempted to claim a different number, STOP and re-read.",
    "{{FACTS}}",
  ].join("\n"),
  variables: ["FACTS"],
  usedBy: "lib/ai/chat/truth-grounding.ts § buildTruthGroundingBlock",
};

// ─── Suggester prompts (smart-replies fallbacks) ──────────────────

const SMART_REPLIES_GROUND_TASK: PromptTemplate = {
  id: "suggester.smart-replies-task-grounded",
  name: "Smart Replies · Task Category · Entity-Grounded",
  description:
    "Heuristic fallback when Venice fails on a task-category turn AND the assistant message contains a recognizable entity. Picks the entity for grounding.",
  category: "suggester",
  version: "1.0.0",
  added: "2026-05-03",
  tags: ["chat", "smart-replies", "fallback"],
  body: [
    "Show {{ENTITY}} tasks",
    "What's next on {{ENTITY}}?",
    "Open {{ENTITY}} in /tasks",
  ].join("\n"),
  variables: ["ENTITY"],
  usedBy: "lib/ai/suggestion-cache.ts § heuristicSuggestions(task category)",
};

// ─── Role prompts (general-purpose, not yet wired) ────────────────

const ROLE_EXPERT_DEVELOPER: PromptTemplate = {
  id: "role.expert-developer",
  name: "Expert Developer (15+ yr · Karpathy-aligned)",
  description:
    "Role-priming prompt for code-review tasks. Prioritizes readability, surfaces tradeoffs, follows the karpathy-guidelines (think before coding, surgical changes, simplicity first).",
  category: "role",
  version: "1.0.0",
  added: "2026-05-03",
  tags: ["builder-mode", "code-review", "antigravity-workflow"],
  body: [
    "Act as an expert software developer with 15+ years of experience following the karpathy-guidelines (think before coding · simplicity first · surgical changes · goal-driven execution).",
    "When reviewing code:",
    "  1. Identify bugs and potential issues",
    "  2. Suggest performance improvements grounded in measurement",
    "  3. Recommend better patterns ONLY when current pattern is broken",
    "  4. Explain reasoning + tradeoffs",
    "Always prioritize readability and maintainability over cleverness. State assumptions explicitly. If multiple interpretations exist, present them — don't pick silently.",
  ].join("\n"),
  usedBy: undefined, // available for invocation; not yet wired
};

const ROLE_KAIZEN_REVIEWER: PromptTemplate = {
  id: "role.kaizen-reviewer",
  name: "Kaizen Code Reviewer (4-pillar lens)",
  description:
    "Role for reviewing code through the kaizen lens: continuous improvement, poka-yoke (error-proof), standardized work, just-in-time. Calls out over-engineering + speculative abstraction.",
  category: "role",
  version: "1.0.0",
  added: "2026-05-03",
  tags: ["builder-mode", "code-review", "kaizen"],
  body: [
    "Act as a senior code reviewer applying the kaizen four-pillar lens:",
    "  1. Continuous Improvement — does each change cleanly compose with prior work? Could the change be smaller and still solve the problem?",
    "  2. Poka-Yoke (Error Proofing) — is there a way to make the wrong path harder/impossible at the type/test/lint level?",
    "  3. Standardized Work — does this match existing patterns? If introducing a new pattern, is the deviation documented?",
    "  4. Just-In-Time — is anything built speculatively? YAGNI it.",
    "Format your review as:",
    "  🔴 Critical (must fix)",
    "  🟡 Suggestions (should consider)",
    "  🟢 Praise (what's done well)",
    "Cite specific lines + file paths. No abstract advice.",
  ].join("\n"),
  usedBy: undefined,
};

// ─── Public registry ──────────────────────────────────────────────

export const PROMPTS: Record<string, PromptTemplate> = {
  [ANTI_FABRICATION_RULE.id]: ANTI_FABRICATION_RULE,
  [FABRICATION_BANNER.id]: FABRICATION_BANNER,
  [HISTORY_NEUTRALIZATION.id]: HISTORY_NEUTRALIZATION,
  [TRUTH_GROUNDING_BLOCK.id]: TRUTH_GROUNDING_BLOCK,
  [SMART_REPLIES_GROUND_TASK.id]: SMART_REPLIES_GROUND_TASK,
  [ROLE_EXPERT_DEVELOPER.id]: ROLE_EXPERT_DEVELOPER,
  [ROLE_KAIZEN_REVIEWER.id]: ROLE_KAIZEN_REVIEWER,
};

/** List every registered prompt · used by /system/prompts. */
export function listPrompts(filter?: {
  category?: PromptCategory;
  tag?: string;
}): PromptTemplate[] {
  const all = Object.values(PROMPTS);
  return all.filter((p) => {
    if (filter?.category && p.category !== filter.category) return false;
    if (filter?.tag && !p.tags.includes(filter.tag)) return false;
    return true;
  });
}

/** Look up by id. Returns null when missing. */
export function getPrompt(id: string): PromptTemplate | null {
  return PROMPTS[id] ?? null;
}

/**
 * Fill a prompt's template with values for its declared variables.
 * Throws if a declared variable is missing — fail-fast catches typos
 * at integration time.
 */
export function fillTemplate(
  id: string,
  values: Record<string, string>,
): string {
  const p = getPrompt(id);
  if (!p) throw new Error(`prompt "${id}" not found`);
  let body = p.body;
  for (const v of p.variables ?? []) {
    if (!(v in values)) {
      throw new Error(`prompt "${id}" missing required variable {{${v}}}`);
    }
    body = body.replaceAll(`{{${v}}}`, values[v]);
  }
  return body;
}

/**
 * Stats for the operator surface · how many prompts in each category,
 * how many wired vs library-only.
 */
export function getRegistryStats(): {
  total: number;
  byCategory: Record<PromptCategory, number>;
  wired: number;
  libraryOnly: number;
} {
  const all = Object.values(PROMPTS);
  const byCategory = {} as Record<PromptCategory, number>;
  let wired = 0;
  for (const p of all) {
    byCategory[p.category] = (byCategory[p.category] ?? 0) + 1;
    if (p.usedBy) wired += 1;
  }
  return {
    total: all.length,
    byCategory,
    wired,
    libraryOnly: all.length - wired,
  };
}
