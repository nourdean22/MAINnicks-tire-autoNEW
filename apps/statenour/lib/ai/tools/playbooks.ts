/**
 * Tool playbooks · 2026-09-08 (program U7 · progressive tool disclosure).
 *
 * Nick has 181 catalogued tools and exposes ~24 per turn through
 * `pruneTools` (core + keyword families + semantic top-N). That is a per-tool
 * guess; a playbook is a per-INTENT bundle: when the operator's message reads
 * as one of three recurring jobs, the tools that job needs are attached
 * together and a short operating note rides in the system prompt. Nothing is
 * removed — playbooks only add — and every attachment is recorded in the
 * selection telemetry under its own tier, so "did the playbook help" is a
 * query, not a feeling.
 *
 * Tool names are catalog names (lib/ai/tools/catalog.ts); the repo test pins
 * that every one exists so a rename cannot silently hollow a playbook.
 */

export interface Playbook {
  id: "reflect" | "execute" | "publish";
  /** Matched against the latest operator message (lower-cased). */
  match: RegExp;
  /** Catalog tool names to attach when the playbook fires. Read-mostly by design. */
  tools: readonly string[];
  /** Operating note appended to the system prompt for this turn. Plain, short. */
  guidance: string;
}

export const PLAYBOOKS: readonly Playbook[] = [
  {
    id: "reflect",
    // 2026-09-19 · `blind spot` -> `blind spots?`. The trailing \b made the
    // SINGULAR match and the PLURAL not: after "spot" comes "s", so there is
    // no word boundary there. "what are my blind spots" — the natural
    // phrasing, and literally the tool's own name (getBlindSpots) — has
    // therefore never matched this playbook since it shipped.
    //
    // Found while demoting getBlindSpots out of CORE_TOOLS: the demotion was
    // justified on this playbook being its fallback path, and writing the
    // reachability test with REAL user text rather than text reverse-engineered
    // from the regex showed the path did not exist. `pattern` above has the
    // same shape but is already singular-correct for its usage.
    match: /\b(journal|reflect|reflection|debrief|how am i|how did i|mood|energy|sleep|tired|burn(ed|t)? out|anxious|pattern|blind spots?)\b/i,
    tools: [
      "getHealthToday",
      "getSleepTrend",
      "getBodyData",
      "getHabitStreaks",
      "getCommitments",
      "checkAntiPattern",
      "getBlindSpots",
      "logSituation",
      "journalDecision",
    ],
    guidance:
      "Playbook: reflect. Read the body and habit signals before interpreting the mood; name one pattern the data supports and one it does not; end with a single question, not a plan.",
  },
  {
    id: "execute",
    match: /\b(plan (my|the) day|today'?s plan|what (should|do) i do (next|now)|next move|mission|missions|tasks?|to-?do|prioriti[sz]e|mit\b|focus)\b/i,
    tools: [
      "getTasks",
      "getMissions",
      "getMissionDetail",
      "rankNextActions",
      "suggestMIT",
      "setMit",
      "getCommitments",
      "checkCommitments",
      "createTask",
      "completeTask",
      "scheduleFollowUp",
    ],
    guidance:
      "Playbook: execute. Rank before you suggest; one next physical action, sized to the energy the body data shows; never schedule into today what the deck says lands in Decide.",
  },
  {
    id: "publish",
    match: /\b(post|publish|caption|instagram|ig\b|reel|carousel|content (idea|plan)|hashtags?|brand voice)\b/i,
    // generateImage is deliberately NOT here: it is catalogued sideEffecting (spend).
    // The operator asks for an image explicitly; a playbook never pre-attaches spend.
    tools: [
      "getInstagramAutopostStatus",
      "getGscTopQueries",
      "getGscSummary",
      "getReviewStats",
      "renderInlineChart",
    ],
    guidance:
      "Playbook: publish. Draft only — publishing runs through /content and its approval gates; cite the search or review signal a hook rests on; Nick's Tire voice, Cleveland specifics, one CTA.",
  },
];

/** The first playbook whose pattern matches the latest operator message; null when none does. */
export function matchPlaybook(userContent: string): Playbook | null {
  const text = (userContent ?? "").slice(0, 2000);
  if (!text.trim()) return null;
  for (const p of PLAYBOOKS) if (p.match.test(text)) return p;
  return null;
}
