/**
 * Sanitize image markdown from assistant message history before sending
 * to the LLM.
 *
 * Apr 28 · The venice-uncensored model has no function calling, and when
 * it sees prior assistant turns containing
 *   ![Generated Image](/api/images/<id>)
 * markdown, it pattern-matches and emits NEW image markdown with
 * fabricated cuid-shaped IDs. The image-ref-validator catches these on
 * the way out (replaces ghost markdown with an error block before
 * persisting), but that doesn't help the user mid-stream — they see the
 * broken image render before the cleaned history is reloaded.
 *
 * Root-cause fix: don't expose the `(/api/images/<id>)` pattern to the
 * LLM in the first place. Replace image markdown in assistant history
 * with a stable placeholder that:
 *   1. Tells the model an image was rendered (preserves semantic meaning)
 *   2. Doesn't include a URL pattern the model can copy
 *   3. Keeps the surrounding text (caption, hashtags, sign-off) intact
 *
 * PURE — returns new message/part objects only where the `text` field
 * changes; unchanged messages + parts pass through by reference to
 * avoid extra allocations across the potentially-large message list.
 * The input array and its objects are never mutated (callers pass
 * AI-SDK UIMessage objects the SDK assumes stay intact).
 *
 * No-op for: user messages, non-text parts, messages with no image
 * markdown, the most recent user/assistant turn (we only touch HISTORY).
 */

const IMAGE_MARKDOWN_LINE =
  /!\[Generated Image\]\(\/api\/images\/[a-z0-9_-]{8,}\)/gi;

const PROMPT_MODEL_FOOTER =
  /\*\*Prompt:\*\*[^\n]*(?:\n+\*\*Model:\*\*[^\n]*)?/gi;

const SYNTH_FOOTNOTE =
  /_Synthesized from prior turn:[^_]*_/gi;

/**
 * Returns a copy of the text with image-render markers replaced by a
 * neutral placeholder. Idempotent — runs the same way no matter how
 * many times you call it.
 */
export function stripImageMarkdownFromText(text: string): string {
  if (!text) return text;
  return text
    .replace(IMAGE_MARKDOWN_LINE, "[image rendered]")
    .replace(PROMPT_MODEL_FOOTER, "")
    .replace(SYNTH_FOOTNOTE, "")
    // Collapse multiple blank lines that the strips can leave behind
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * v10.0.163 · L3 anti-fabrication defense — context correction
 * injection. When a prior assistant turn was flagged + rewritten by
 * the v10.0.162 verifier (banner with VERIFIER_MARKER prefix), we
 * REPLACE the historical text with an explicit "[NOTE: previous claim
 * was fabricated and unverified — disregard]" so the model can't read
 * the prior fabrication as truth and compound the lie next turn.
 *
 * Without this, the conversation history feeds the lie back into the
 * context window: turn 1 says "I added 15 tasks", turn 2 sees the
 * lie as fact and says "as I mentioned, 15 tasks…" The compounding
 * is the worst part — the lie hardens into shared belief.
 *
 * The marker check is cheap (string startsWith). We import the helper
 * lazily so this module stays tree-shake-friendly for non-chat
 * surfaces that pull in sanitize-history but don't need fabrication
 * detection.
 */
function neutralizeFabricatedHistory(text: string): string {
  // Marker check — string prefix is the contract from the rewriter.
  // Keeping the literal here instead of importing avoids a circular
  // dep between sanitize-history (called from chat route) and
  // fabrication-rewriter (called from persist-assistant-turn).
  const MARKER = "[VERIFIER · v10.0.162]";
  if (!text.startsWith(MARKER)) return text;
  // Replace the entire turn with a single explicit note. Future
  // model turns see only this note + the original user message they
  // were responding to — they CAN'T compound the lie because the
  // prior text isn't in the window anymore.
  return "[VERIFIER NOTE: my previous response was flagged as fabricated (claimed actions without firing tools). Disregard it. Do not reference it. Treat the operator's last request as still open.]";
}

/**
 * 2026-07-05 (audit P3 · c) · errored-stub neutralization note. Stub
 * rows persisted by stream-error-handler.ts carry the BARE partial
 * text (streamingState "errored", no annotation) so reload shows what
 * the user saw — but the model must not read that interrupted fragment
 * back as a completed answer it gave. The `streamingState` field
 * survives the client round trip: use-conversations.ts hydrates it
 * onto the UIMessage and DefaultChatTransport serializes messages
 * as-is (verified against ai@6.0.162 — no field stripping).
 */
const STREAM_ERROR_NOTE =
  "[NOTE: my previous reply was interrupted mid-stream by a provider error and is incomplete — do not treat it as a completed answer or quote it as something I said. The operator's last request may still be unaddressed.]";

/**
 * Walks the message array and sanitizes assistant text parts that
 * contain image markdown. User messages and non-text parts are left
 * untouched. The last (most recent) message is also untouched — that's
 * the live user prompt we're answering, not history.
 *
 * v10.0.163 · also neutralizes fabricated turns (verifier-banner
 * marker) so they can't compound across turns.
 *
 * 2026-07-05 (audit P3) · also neutralizes errored stub turns
 * (streamingState "errored") with an explicit interruption note —
 * same verifier-style mechanism, keyed off the hydrated metadata
 * instead of a content marker.
 *
 * PURE: never mutates the input. Returns new message/part objects only
 * where a change is needed; unchanged messages + parts pass through by
 * reference (these are AI-SDK UIMessage objects the SDK assumes stay
 * intact, so we must not write back into the caller's array).
 */
export function sanitizeMessageHistory<
  T extends { role?: string; parts?: Array<{ type?: string; text?: string }> },
>(messages: T[]): T[] {
  if (!messages || messages.length < 2) return messages;
  const lastIndex = messages.length - 1;
  return messages.map((m, i) => {
    // The last message is the user's current turn — leave it untouched.
    if (i === lastIndex) return m;
    if (!m || m.role !== "assistant" || !Array.isArray(m.parts)) return m;
    // Errored stub turn — replace the partial text with the note so
    // the model sees the interruption, not a confident half-answer.
    if ((m as { streamingState?: unknown }).streamingState === "errored") {
      return { ...m, parts: [{ type: "text", text: STREAM_ERROR_NOTE }] };
    }
    const parts = m.parts;
    const newParts = parts.map((part) => {
      if (part?.type === "text" && typeof part.text === "string") {
        // v10.0.163 · L3 fabrication neutralization runs FIRST so the
        // image-stripper and other passes operate on the post-
        // neutralized text (cheaper + simpler).
        const neutralized = neutralizeFabricatedHistory(part.text);
        const cleaned = stripImageMarkdownFromText(neutralized);
        if (cleaned !== part.text) return { ...part, text: cleaned };
      }
      return part;
    });
    // Only allocate a new message when a part actually changed.
    const changed = newParts.some((p, idx) => p !== parts[idx]);
    return changed ? { ...m, parts: newParts } : m;
  });
}
