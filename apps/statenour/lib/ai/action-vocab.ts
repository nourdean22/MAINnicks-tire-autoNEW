/**
 * Action vocabulary · v10.0.177 · single source of truth
 *
 * ═══ Why this module exists ═══
 *
 * Pre-v10.0.177 we had TWO regex lists for the same vocabulary:
 *
 *   · lib/ai/chat/action-intent-detector.ts → catches user requests
 *     ("add a task", "mark X done") so we can flip toolChoice to
 *     "required" and force the model to call a real tool.
 *
 *   · lib/ai/chat/action-claim-detector.ts → catches model claims
 *     ("Added X", "Marked done") so we can warn / hedge when zero
 *     tools fired.
 *
 * Every fab incident produced two patches: input regex AND output
 * regex. Drift between the two lists meant a fab could match output
 * (warning fires) but not input (forcing didn't trigger) — exactly
 * the v10.0.176 Pitch Cleveland incident: "complete those tasks"
 * was caught by the claim detector ("Completed both tasks") but the
 * intent detector hadn't yet learned the bare-verb form, so
 * toolChoice="required" never engaged.
 *
 * ═══ Kaizen poka-yoke ═══
 *
 * One vocab. Both detectors derive their primary regexes from it.
 * Add a concept here → both detectors fix automatically. Drift is
 * structurally impossible for the verb-object lane.
 *
 * Edge-case patterns that don't fit verb+object structure (e.g.
 * "we're done with X", "I've added", "task(s) added" with the
 * subject elided) stay in the individual detector files. The vocab
 * is the SHARED 80% — bespoke patterns are the long tail.
 *
 * ═══ Adding a new concept ═══
 *
 * 1. Add an entry below with imperative + past verbs + objects.
 * 2. Run tests: vocab-parity test asserts each concept generates
 *    a matching pair (intent regex + claim regex).
 * 3. Both detectors auto-pick up the change. No detector edits
 *    required for verb-object phrases.
 */

export interface ActionConcept {
  /** Stable identifier for the concept (e.g. "task-create"). */
  intent: string;
  /**
   * Tool that should fire. Pipe-alternation allowed for multi-tool
   * intents (e.g. "sendEmail|sendTelegram") — the claim detector
   * already handles alternation via split("|").
   */
  tool: string;
  /**
   * Imperative / present-tense verbs the user uses to request this
   * action. Used by the intent detector. Lowercase only.
   */
  imperative: string[];
  /**
   * Past-tense verbs the model uses when claiming the action was
   * performed. Used by the claim detector. Lowercase only.
   */
  past: string[];
  /**
   * Object phrases the verbs act on (alternation). Optional —
   * concepts like "memory-write" act on a `that/this/to` clause
   * rather than a noun.
   */
  objects?: string[];
  /**
   * Optional connector that must appear between verb and object
   * (e.g. "to|on|in" for "add X to my list"). Defaults to none.
   */
  connector?: string[];
  /**
   * Allowed character distance between verb and object. Default 30.
   */
  gap?: number;
  /**
   * When true, the CLAIM (output-side) regex requires a first-person
   * subject ("I linked", "I've moved", "just linked") before the verb.
   * Relational verbs like "linked"/"moved" appear constantly in
   * descriptive prose ("Linked to: [brain:recall]", "you moved to a
   * new shop") that asserts no action — anchoring to first person
   * stops those benign uses registering as fabricated claims. The
   * input-side intent regex is unaffected.
   */
  claimNeedsFirstPerson?: boolean;
}

/**
 * Master vocabulary. Order matters — earlier concepts win when
 * multiple match (specific-before-general). Bulk variants come
 * before single variants.
 */
export const ACTION_VOCAB: readonly ActionConcept[] = [
  // ── Bulk task creation (must come before single) ──
  {
    intent: "bulk-task-create",
    tool: "addTasksToProject",
    imperative: ["add", "create", "make"],
    past: ["added", "created", "made"],
    objects: ["these tasks", "the tasks", "all tasks", "multiple tasks", "several tasks", "some tasks"],
    gap: 30,
  },
  // ── Single task creation ──
  {
    intent: "task-create",
    tool: "createTask",
    imperative: ["add", "create", "make"],
    past: ["added", "created", "made"],
    objects: ["a task", "one task", "new task", "task", "tasks", "todo", "to-do", "item"],
    gap: 40,
  },
  // ── Task completion ──
  {
    intent: "task-complete",
    tool: "completeTask",
    imperative: ["complete", "finish", "close", "wrap up", "mark"],
    past: ["completed", "finished", "closed", "marked"],
    objects: ["task", "tasks", "job", "todo", "to-do", "item", "items", "those", "these", "done"],
    gap: 30,
  },
  // ── Send / communication ──
  // tool is the CANONICAL tool to force on the input side. Output-
  // side acceptance of alternative send tools (sendEmail, sendTelegram)
  // is handled by an edge claim pattern in action-claim-detector.ts.
  {
    intent: "send-comm",
    tool: "composeEmail",
    imperative: ["send", "email", "message", "text"],
    past: ["sent", "emailed", "messaged", "texted"],
    objects: ["email", "message", "note", "reply", "follow up", "follow-up", "text"],
    gap: 30,
  },
  // ── Schedule ──
  {
    intent: "schedule",
    tool: "scheduleFollowUp",
    imperative: ["schedule"],
    past: ["scheduled"],
    objects: ["follow up", "follow-up", "reminder", "call", "meeting"],
    gap: 30,
  },
  // ── Memory write ──
  // tool MUST be the real registered chat tool. The model fires
  // `pinMemory` on "remember this"/"pin this" — there is no
  // `saveToBrain` tool (that's a service, never in nourTools), so the
  // old pin meant every correct pin was flagged fabricated forever.
  {
    intent: "memory-write",
    tool: "pinMemory",
    imperative: ["save", "remember", "note", "capture"],
    past: ["saved", "remembered", "noted", "captured", "pinned"],
    objects: ["memory", "note", "brain", "that", "this"],
    gap: 30,
  },
  // ── Commitment logging ──
  {
    intent: "commitment-log",
    tool: "createCommitment",
    imperative: ["log", "track", "capture"],
    past: ["logged", "tracked"],
    objects: ["commitment"],
    gap: 20,
  },
  // ── Priority edits ──
  {
    intent: "priority-set",
    tool: "setTaskPriority",
    imperative: ["bump", "raise", "lower", "set"],
    past: ["bumped", "raised", "lowered", "set"],
    objects: ["priority"],
    gap: 30,
  },
  // ── Data sync / ingest (calendar · gmail · drive) ──
  // v10.0.533 · a live agent_traces read (2026-07-06) proved "sync my
  // calendar" was answered as PROSE ("Calendar synced. No new events.")
  // with toolsCalled=[] — no sync concept existed, so the intent detector
  // never forced toolChoice and the claim detector never caught the
  // fabricated "synced". The model claimed an action it didn't take. The
  // `tool` alternation attaches all three sync tools (route splits on "|");
  // toolChoice:"required" then makes the model call the right one instead
  // of narrating. Objects cover each sync tool's domain.
  {
    intent: "data-sync",
    tool: "syncCalendar|syncGmail|syncDriveMemory",
    imperative: ["sync", "resync", "re-sync", "refresh", "pull", "ingest"],
    past: ["synced", "resynced", "re-synced", "refreshed", "pulled", "ingested"],
    objects: [
      "calendar",
      "gmail",
      "email",
      "emails",
      "inbox",
      "drive",
      "docs",
      "documents",
      "knowledge base",
      "knowledge",
    ],
    // Tight gap (15, vs the usual 30): "sync my calendar" is a 4-char
    // verb→object hop, but a loose gap would false-fire on "sync up with
    // the team about the calendar" (a meeting, not a data ingest).
    gap: 15,
  },
  // ── Linking / moving (claim-only — input forms are ambiguous) ──
  // Both fold into `updateTask` (the real tool that absorbed
  // reframe/move/link — tasks.ts) — `linkResource`/`moveTask` were
  // never registered, so the claim could never be satisfied.
  // claimNeedsFirstPerson: "linked"/"moved" dominate descriptive prose
  // ("Linked to: [brain:recall]", "you moved shops") — only a
  // first-person subject ("I linked it…") signals a real action claim.
  {
    intent: "link",
    tool: "updateTask",
    imperative: ["link"],
    past: ["linked"],
    objects: ["to", "with"],
    gap: 40,
    claimNeedsFirstPerson: true,
  },
  {
    intent: "move",
    tool: "updateTask",
    imperative: ["move"],
    past: ["moved"],
    objects: ["project", "mission", "inbox"],
    connector: ["to"],
    gap: 40,
    claimNeedsFirstPerson: true,
  },
  // ── Posting / publishing ──
  // (removed v-truth) — there is no `publishContent` chat tool, so the
  // claim was permanently unsatisfiable AND the input side wrongly
  // forced toolChoice:"required" for a tool the model doesn't have.
] as const;

/**
 * Escape a string for safe inclusion in a regex character set.
 */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Build an alternation group from a list of words/phrases.
 * Returns the alternation string (without surrounding parentheses).
 */
function alternation(items: readonly string[]): string {
  return items.map(escapeRegex).join("|");
}

/**
 * Generate the intent (input-side) regex for a concept.
 * Matches: <imperative-verb> [.{0,gap}] [<connector>] [.{0,gap}] <object>
 *
 * Used by the action-intent-detector.
 */
export function intentRegex(concept: ActionConcept): RegExp {
  const imp = alternation(concept.imperative);
  const gap = concept.gap ?? 30;
  if (!concept.objects || concept.objects.length === 0) {
    return new RegExp(`\\b(?:${imp})\\b`, "i");
  }
  const obj = alternation(concept.objects);
  if (concept.connector && concept.connector.length > 0) {
    const conn = alternation(concept.connector);
    return new RegExp(
      `\\b(?:${imp})\\b.{0,${gap}}\\b(?:${conn})\\b.{0,${gap}}\\b(?:${obj})\\b`,
      "i",
    );
  }
  return new RegExp(`\\b(?:${imp})\\b.{0,${gap}}\\b(?:${obj})\\b`, "i");
}

/**
 * Generate the claim (output-side) regex for a concept.
 * Matches: <past-verb> [.{0,gap}] [<connector>] [.{0,gap}] <object>
 *
 * Used by the action-claim-detector.
 */
export function claimRegex(concept: ActionConcept): RegExp {
  const past = alternation(concept.past);
  const gap = concept.gap ?? 30;
  // First-person anchor: require "I" / "I've" / "just" (then ≤2 words)
  // immediately before the verb, so relational verbs only register as
  // a self-claim ("I linked it…"), not as descriptive prose ("Linked
  // to: …", "you moved shops"). Empty for normal concepts.
  const fp = concept.claimNeedsFirstPerson
    ? `\\b(?:I|I'?ve|just)\\b\\s+(?:\\w+\\s+){0,2}`
    : "";
  if (!concept.objects || concept.objects.length === 0) {
    return new RegExp(`${fp}\\b(?:${past})\\b`, "i");
  }
  const obj = alternation(concept.objects);
  if (concept.connector && concept.connector.length > 0) {
    const conn = alternation(concept.connector);
    return new RegExp(
      `${fp}\\b(?:${past})\\b.{0,${gap}}\\b(?:${conn})\\b.{0,${gap}}\\b(?:${obj})\\b`,
      "i",
    );
  }
  return new RegExp(`${fp}\\b(?:${past})\\b.{0,${gap}}\\b(?:${obj})\\b`, "i");
}

export interface IntentEntry {
  regex: RegExp;
  intent: string;
  expectedTool: string;
}

export interface ClaimEntry {
  regex: RegExp;
  verb: string;
  mapsToTool: string;
}

/**
 * Materialize the vocab as intent-detector entries. The detector
 * iterates these in order; first match wins.
 */
export function intentEntries(): IntentEntry[] {
  return ACTION_VOCAB.map((c) => ({
    regex: intentRegex(c),
    intent: c.intent,
    expectedTool: c.tool,
  }));
}

/**
 * Materialize the vocab as claim-detector entries.
 */
export function claimEntries(): ClaimEntry[] {
  return ACTION_VOCAB.map((c) => ({
    regex: claimRegex(c),
    verb: c.intent,
    mapsToTool: c.tool,
  }));
}
