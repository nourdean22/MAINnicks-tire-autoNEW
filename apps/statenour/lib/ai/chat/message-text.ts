/**
 * Normalize an AI-SDK message `content` field to a plain string.
 *
 * Fixes the recurring `chat:post-process` crash
 *   TypeError: Cannot read properties of undefined (reading 'match')
 * The content-feedback post-process step cast a prior assistant
 * message's content to string with `as unknown as string`, but an
 * assistant turn can carry `content: undefined` (parts-only messages).
 * The cast produced `undefined`, and the next `.match()` threw — a
 * silent, error-captured background failure that recurred for weeks.
 *
 * Always returns a string: joins array parts' `text`, passes strings
 * through unchanged, and returns "" for any other shape (undefined,
 * null, number, object). Safe to call `.match()` on the result.
 */
export function messageContentToText(content: unknown): string {
  if (Array.isArray(content)) {
    return content
      .map((c) =>
        c && typeof c === "object" && "text" in c
          ? String((c as { text?: unknown }).text ?? "")
          : "",
      )
      .join("\n");
  }
  return typeof content === "string" ? content : "";
}
