/**
 * The error card's text. A failure before the stream starts reaches useChat as
 * the raw response body ('{"error":"Chat stream failed"}'); a failure mid-stream
 * arrives as the server's authored category sentence (clientSafeStreamErrorText),
 * which reads through unchanged. Anything that is neither falls back.
 */
const FALLBACK = "Stream failed.";

const sentence = (s: string) => (/[.!?]$/.test(s) ? s : `${s}.`);

export function chatErrorText(message: string): string {
  const text = (message ?? "").trim();
  if (!text) return FALLBACK;
  if (text.startsWith("{")) {
    try {
      const body = JSON.parse(text) as { error?: unknown; reason?: unknown };
      const error = typeof body?.error === "string" ? body.error.trim() : "";
      if (!error) return FALLBACK;
      // The power-panel block (lib/ai/chat/gate.ts) puts what to do in `reason`.
      const reason = typeof body.reason === "string" ? body.reason.trim() : "";
      return reason ? `${sentence(error)} ${sentence(reason)}` : sentence(error);
    } catch {
      return FALLBACK;
    }
  }
  // An HTML error page from a proxy is markup, not a sentence.
  if (text.startsWith("<")) return FALLBACK;
  return text;
}
