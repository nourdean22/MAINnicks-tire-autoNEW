/**
 * lib/chat/suggestion-seed.ts · Wave X.b (2026-05-24).
 *
 * Pure parser for the suggestion-prefix-encoded entity ids that
 * NickSuggestions chips emit when the operator taps them. Extracted
 * from /chat/page.tsx onSeed handler so the parsing logic is unit-
 * testable in isolation and the page just spreads the result onto
 * `transportBodyRef.current`.
 *
 * Pre-Wave-34 the system prompt got `lastSuggestionId="broken-
 * promise-abc123"` and Nick had to PARSE that string to find the
 * underlying taskId. Wave 34 moved the extraction client-side · this
 * extracts that 55 LOC of repeated `meta.id.replace(...)` parsing
 * into one pure function. Zero React · zero state · all data
 * transform.
 *
 * Suggestion-kind → underlying entity:
 *   broken-promise         → taskId
 *   stalled-goal           → goalId
 *   stale-pin              → pinId
 *   unresolved-reflection  → reflectionId
 *   (everything else)      → no anchor · lastSuggestionKind + Id alone
 */

export interface SuggestionMeta {
  kind: string;
  id: string;
}

export interface ExtractedEntity {
  /** Whatever was passed in · always preserved for transport. */
  lastSuggestionKind: string;
  lastSuggestionId: string;
  /** Set when kind=broken-promise · stripped of the prefix. */
  lastTaskId?: string;
  /** Set when kind=stalled-goal. */
  lastGoalId?: string;
  /** Set when kind=stale-pin. */
  lastPinId?: string;
  /** Set when kind=unresolved-reflection. */
  lastReflectionId?: string;
}

/**
 * Parse a NickSuggestions chip's meta into the transport body fields
 * the chat route expects. Pure · always returns a base object · adds
 * the kind-specific id when the prefix matches.
 */
export function extractEntityFromSuggestion(
  meta: SuggestionMeta,
): ExtractedEntity {
  const result: ExtractedEntity = {
    lastSuggestionKind: meta.kind,
    lastSuggestionId: meta.id,
  };

  switch (meta.kind) {
    case "broken-promise": {
      const taskId = meta.id.replace(/^broken-promise-/, "");
      if (taskId && taskId !== meta.id) result.lastTaskId = taskId;
      break;
    }
    case "stalled-goal": {
      const goalId = meta.id.replace(/^stalled-goal-/, "");
      if (goalId && goalId !== meta.id) result.lastGoalId = goalId;
      break;
    }
    case "stale-pin": {
      const pinId = meta.id.replace(/^stale-pin-/, "");
      if (pinId && pinId !== meta.id) result.lastPinId = pinId;
      break;
    }
    case "unresolved-reflection": {
      const reflectionId = meta.id.replace(/^unresolved-reflection-/, "");
      if (reflectionId && reflectionId !== meta.id) {
        result.lastReflectionId = reflectionId;
      }
      break;
    }
    // weak-axis / pattern / orphan-nudge / contradictions / overdue /
    // stuck-task → no single entity to anchor · lastSuggestionKind +
    // Id alone are sufficient.
  }

  return result;
}
