/**
 * Escape text interpolated into a Telegram parse_mode "HTML" message.
 *
 * Telegram requires every `<`, `>` and `&` that is not part of a tag or an
 * entity to be escaped; a stray one makes the API answer 400 "can't parse
 * entities" and the message is dropped. Worse, unescaped model text can carry
 * markup of its own -- a `<tg-spoiler>` hides part of an approval prompt from
 * the operator approving it (SN-07).
 *
 * Moved here from lib/services/telegram.ts (2026-10-10), which re-exports it:
 * a pure module that tests never mock, so callers that build prompts do not
 * depend on how a test stubs the Telegram transport.
 */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
