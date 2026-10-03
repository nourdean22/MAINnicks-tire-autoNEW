/**
 * Serialize a chat transcript for chat_sessions.messagesJson without ever
 * exceeding the column.
 *
 * TiDB runs STRICT_TRANS_TABLES: an over-width write is REJECTED, not
 * truncated, and the whole turn's transcript is lost. The column is MEDIUMTEXT
 * since drizzle/0142 (it was TEXT, 64 KB, and long chats overflowed it).
 *
 * Over the limit, the OLDEST messages are dropped first so the newest context
 * survives. Only if the single newest message is itself over the limit is its
 * content shortened — the row is always writable.
 */

/** MEDIUMTEXT holds 2^24 - 1 BYTES (not characters). */
const CHAT_TRANSCRIPT_MAX_BYTES = 16_777_215;

type ChatMessage = { role: string; content: string };

export function serializeTranscript(
  messages: ChatMessage[],
  maxBytes: number = CHAT_TRANSCRIPT_MAX_BYTES,
): { json: string; droppedMessages: number; truncatedNewest: boolean } {
  const fits = (s: string) => Buffer.byteLength(s, "utf8") <= maxBytes;

  let kept = messages;
  let json = JSON.stringify(kept);
  while (!fits(json) && kept.length > 1) {
    kept = kept.slice(1);
    json = JSON.stringify(kept);
  }

  let truncatedNewest = false;
  if (!fits(json) && kept.length === 1) {
    let newest = kept[0];
    while (!fits(json) && newest.content.length > 0) {
      newest = { ...newest, content: newest.content.slice(0, Math.floor(newest.content.length / 2)) };
      json = JSON.stringify([newest]);
      truncatedNewest = true;
    }
  }

  return { json, droppedMessages: messages.length - kept.length, truncatedNewest };
}
