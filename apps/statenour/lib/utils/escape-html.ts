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

/** Tags still open at the end of `html`, innermost last. */
function openTags(html: string): string[] {
  const stack: string[] = [];
  for (const m of html.matchAll(/<(\/?)([a-z][a-z0-9-]*)[^>]*>/gi)) {
    const name = m[2].toLowerCase();
    if (!m[1]) stack.push(name);
    else {
      const i = stack.lastIndexOf(name);
      if (i >= 0) stack.splice(i, 1);
    }
  }
  return stack;
}

/**
 * Cut a parse_mode "HTML" Telegram message to `max` chars without breaking its markup.
 * A raw slice can end inside an entity (`&am`) or a tag (`<b`), or leave a tag open, and
 * Telegram then answers 400 "can't parse entities" and delivers nothing (2026-10-30,
 * job goals-system: the webhook's /brief and other replies cut with `.slice(0, 3900)`).
 */
export function clipTelegramHtml(text: string, max = 3900): string {
  if (text.length <= max) return text;
  let budget = max;
  for (let i = 0; i < 8; i++) {
    const cut = text.slice(0, budget).replace(/<[^>]*$/, "").replace(/&[#a-z0-9]*$/i, "").trimEnd();
    const closers = openTags(cut).reverse().map((t) => `</${t}>`).join("");
    if (cut.length + closers.length <= max) return cut + closers;
    budget -= cut.length + closers.length - max;
  }
  // last resort: plain text with no partial entity cannot fail to parse
  return text.replace(/<[^>]*>/g, "").slice(0, max).replace(/&[#a-z0-9]*$/i, "");
}
