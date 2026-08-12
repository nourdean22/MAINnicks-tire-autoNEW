/**
 * Empty-response fallback · last line of defense for the chat stream.
 *
 * When the model (notably glm-5.1 on ollama, which has NO thinking-budget
 * control — the VENICE_PARAMS `disable_thinking`/`reasoning_effort` knobs
 * are Venice-only) closes the stream with no usable assistant text after
 * every salvage path in persist-assistant-turn.ts, the turn used to be
 * silently dropped (hasContent=false → save skipped). The user saw a blank
 * bubble and retried — and when the empty turn had actually fired a tool,
 * the retry created DUPLICATES (the 06-08 "UFC USA BBQ" mission spawned 5×
 * with ~26 orphan tasks).
 *
 * This returns an HONEST fallback that replaces the silent drop. It never
 * claims a completed side effect (the model produced nothing, and a
 * completion verb would also trip the action-claim fabrication detector).
 * It branches on finishReason so a tool-call turn STEERS AWAY from a
 * blind retry (the action may already have run) while a truly-empty turn
 * invites one.
 *
 * NOTE: this is the symptom-level guarantee that the user never sees a
 * blank turn. The ROOT fix — giving glm-5.1/ollama a thinking-budget
 * control so it reliably emits visible text — is a separate, provider-
 * level change that needs live-model verification.
 *
 * Pure — no IO.
 */
export function emptyResponseFallback(finishReason?: string): string {
  // 2026-08-11 · refusal branch. Claude 5-family models end a turn with
  // stop_reason "refusal" (HTTP 200) — the AI SDK surfaces it as
  // finishReason "content-filter". Once the stream committed, mid-stream
  // provider rotation is impossible, so the honest move is to NAME the
  // refusal instead of pretending the request was "too heavy".
  if (finishReason === "content-filter") {
    return "The model refused this one — a provider-side safety classifier, not a system failure. Rephrase it, or retry; a retry may route to a different provider.";
  }
  if (finishReason === "tool-calls") {
    return "I went to take an action on that but came back without a written response. Check whether it actually went through before you re-send — re-asking could create a duplicate.";
  }
  return "That one didn't produce a response — the request may have been too heavy to answer in a single pass. Hit retry, or break it into a smaller ask.";
}
