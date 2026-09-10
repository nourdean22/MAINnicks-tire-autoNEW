/**
 * lib/ai/chat/recall-failure-notice.ts · 2026-09-10
 *
 * THE DEFECT THIS CLOSES. The three-state recall provenance work
 * (OK / ZERO / ERROR / UNMEASURED) told the OPERATOR the truth and left
 * the MODEL believing a lie.
 *
 * Trace it: `brain-context.ts` builds the recall block as
 * `withTimeout(buildChatRecallBlock(...), 3000, "")`, and `rawBlocks` is
 * `.filter(b => b.content.trim().length > 0)`. So when retrieval fails or
 * times out the block is `""` and is dropped from the prompt entirely.
 * The prompt NICK receives is then byte-identical to the prompt for a
 * turn where recall ran perfectly and genuinely matched nothing.
 *
 * Meanwhile `recallProvenance: "ERROR"` flows all the way to
 * `components/chat/memory-inspector-sidebar.tsx`, which correctly renders
 * "Memory read failed -- state unknown, not empty."
 *
 * So the operator sees an honest failure notice while, in the same turn,
 * the model says "I don't have anything on that" -- with the full
 * confidence of a completed search it never performed. That is the
 * empty-vs-error defect at the layer where it does the most damage: not
 * a wrong number on a panel, but a false assertion about the agent's own
 * knowledge, delivered in NICK's voice.
 *
 * L1's TRUTH RULE (system-prompt.ts) bans claiming a past-tense ACTION
 * without a tool call. It does not ban asserting the ABSENCE of a memory
 * you failed to read, because from inside the turn those are
 * indistinguishable -- there is nothing in context to distinguish them
 * FROM. This block is that missing something.
 *
 * WHY A SYSTEM BLOCK AND NOT A PROMPT RULE. A standing instruction
 * ("hedge if recall might have failed") would fire on every turn and is
 * unfalsifiable from inside the model. This is a per-turn FACT, computed
 * from the retrieval report by code the model cannot influence -- the
 * same discipline as truth-grounding (L4) and the `untrustedInput`
 * fence: a declaration the model controls is not a control.
 *
 * SCOPE, deliberately narrow. Only `ERROR` produces the failure notice.
 * `UNMEASURED` means recall was never attempted (a two-word message, no
 * embedding needed) and telling the model a read failed would be its own
 * fabrication -- as well as firing on trivial turns until the notice
 * becomes wallpaper. `ZERO` is a real measured empty and must stay
 * clean, or every cold-start turn learns to hedge.
 */

/** Mirrors `RecallProvenance` in lib/brain/memory-recall.ts. */
export type NoticeProvenance = "OK" | "ZERO" | "ERROR" | "UNMEASURED";

export interface RecallNoticeInput {
  provenance?: NoticeProvenance;
  /** The producer's own explanation, e.g. "every retrieval lane failed". */
  reason?: string;
  /** How many hits survived. A partial outage can fail AND return rows. */
  hitCount: number;
}

/**
 * The heading is matched by the block-assembly test, so keep it stable.
 */
export const RECALL_FAILURE_HEADING = "# MEMORY READ FAILED";
export const RECALL_DEGRADED_HEADING = "# MEMORY READ DEGRADED";

/**
 * The reason is interpolated into the SYSTEM PROMPT, which makes it a
 * sink. Audited 2026-09-10: every producer value is a code-authored
 * literal or a count -- `lib/brain/memory-recall.ts` interpolates only
 * the lane names ("main" | "durable" | "lexical") and `hits.length`, and
 * brain-context's two fallbacks are constants. Nothing DB- or
 * user-derived reaches here today.
 *
 * It is hardened anyway. "Today's producers are clean" is a fact about
 * today's producers, and the next person to add a reason string will be
 * describing a failure, not thinking about injection -- a row's category
 * or a provider's error text is exactly the kind of thing that gets
 * appended to a diagnostic message. Stripping the tag characters and
 * capping the length costs nothing and means the sink cannot be opened
 * from a distance by an edit in another file.
 */
function sanitizeReason(reason: string): string {
  return reason
    .replace(/[<>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
}

/**
 * Build the per-turn recall-state notice for the system prompt.
 *
 * Returns "" when there is nothing honest to say -- which is most turns.
 * An empty string is dropped by brain-context's own
 * `.filter(b => b.content.trim().length > 0)`, so "no notice" costs
 * nothing and needs no special-casing at the call site.
 */
export function buildRecallFailureNotice(input: RecallNoticeInput): string {
  const { provenance, reason, hitCount } = input;

  if (provenance === "ERROR") {
    // The read did not complete. Whether rows exist is unknown, so the
    // instruction is about what NICK must NOT assert.
    const detail = reason ? ` Reported cause: ${sanitizeReason(reason)}.` : "";
    return [
      RECALL_FAILURE_HEADING,
      `The memory lookup for this turn did not complete.${detail}`,
      "",
      "This is NOT the same as having no memory of the subject. You did not",
      "successfully look. Do not say you have nothing on it, do not say you",
      "do not recall it, and do not treat its absence from this prompt as",
      "evidence it is not stored.",
      "",
      "If the answer depends on what you remember, say plainly that the",
      "memory lookup failed this turn and offer to try again. Answer from",
      "what is in front of you, and mark it as such.",
    ].join("\n");
  }

  /**
   * PARTIAL OUTAGE. `recallMemoriesForQuery` reports OK when surviving
   * lanes returned rows, and records the dead ones in `provenanceReason`
   * -- a clean run leaves that field undefined. So a reason present on an
   * OK verdict is exactly the "hits are real, ranking is degraded" case,
   * which the Memory Inspector already renders for the operator.
   *
   * The instruction is different from the ERROR case and must stay
   * different: these rows ARE real, so telling NICK not to trust them
   * would throw away good evidence. What is unreliable is the RANKING --
   * and therefore any claim that the top hit is the BEST match, or that
   * what is missing from the list is missing from memory.
   */
  if (provenance === "OK" && hitCount > 0 && reason) {
    return [
      RECALL_DEGRADED_HEADING,
      `Some retrieval lanes failed this turn: ${sanitizeReason(reason)}.`,
      "",
      "The memories shown are real and may be used. Their RANKING is not",
      "reliable, and the set is incomplete -- do not claim the top match is",
      "the best one, and do not infer that something absent from this list",
      "is absent from memory.",
    ].join("\n");
  }

  // OK-and-clean, a true ZERO, or a turn where recall was never run.
  // Nothing to declare.
  return "";
}
