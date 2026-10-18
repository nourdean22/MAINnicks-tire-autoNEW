/**
 * decodeCockpitSseResponse - turn the chat route's cockpit SSE stream back into
 * the plain AI SDK UI-message stream that DefaultChatTransport can parse.
 *
 * POST /api/ai/chat always answers in the cockpit format
 * (lib/ai/runtime/sse-stream.ts): named `event:` frames, and `event: chunk`
 * frames whose data is a JSON string holding the BASE64 of the raw AI SDK
 * bytes. A bare DefaultChatTransport throws on the first named frame, so every
 * client of the route must pass its Response through here.
 *
 * Moved verbatim out of hooks/chat/use-chat-transport.ts (2026-10-18) so the
 * home command line (components/home/nick-command-line.tsx) decodes with the
 * same code as the main chat instead of a second copy. The one change: the
 * decode-error toast is the caller's `onDecodeError`, so this module imports no
 * UI library.
 */

export interface DecodeCockpitSseOpts {
  /** The request was the resume GET (bare `data:` frames get their start chunk patched). */
  isResume: boolean;
  /** P2-B6 · id of the bubble a named resume merges into. */
  resumeInto?: string;
  /** `event: message.persisted { id, content }`, tagged with this response's X-Trace-Id. */
  onMessagePersisted?: (persisted: { id: string; content: string; traceId: string | null }) => void;
  /** Called at most once per response when a chunk payload cannot be decoded. */
  onDecodeError?: () => void;
}

/** P2-B6 · only the `start` chunk carries the message id and metadata. Every
 *  resume marks its bubble resumed; a named one also adopts the id of the
 *  bubble already on screen. */
function patchResumeStart(frame: string, data: string, messageId: string | undefined): string {
  if (!data.includes('"start"')) return frame;
  try {
    const chunk = JSON.parse(data);
    if (chunk?.type !== "start") return frame;
    const messageMetadata = { ...chunk.messageMetadata, resumed: true };
    return `data: ${JSON.stringify({ ...chunk, ...(messageId ? { messageId } : {}), messageMetadata })}`;
  } catch {
    return frame;
  }
}

/** Caller checks `content-type` includes text/event-stream and that `res.body` exists. */
export function decodeCockpitSseResponse(res: Response, opts: DecodeCockpitSseOpts): Response {
  const { isResume, resumeInto, onMessagePersisted, onDecodeError } = opts;
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const responseTraceId = res.headers.get("X-Trace-Id");
  let buffer = "";
  let toastedDecodeError = false;
  // 2026-08-09 · MUST live out here, alongside `buffer`, not inside the
  // read loop. An SSE frame is `event: <name>` then `data: <payload>`,
  // and a network read boundary can fall BETWEEN those two lines - that
  // is what `buffer` exists to handle for the partial-line case. When
  // this was declared per-read, the event name was thrown away at the
  // end of every read, so a split frame arrived with currentEvent ""
  // and its data line matched neither `=== "chunk"` nor the truthy
  // `else if (currentEvent)` branch. There is no final `else`, so the
  // payload was silently DROPPED - lost stream bytes, no error, no log.
  // The per-frame reset already happens correctly on the blank line
  // that terminates each frame (see the `trimmed === ""` branch below),
  // which is the proof that per-frame, not per-read, is the intent.
  let currentEvent = "";

  const sseStream = new ReadableStream({
    async start(controller) {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            controller.close();
            break;
          }

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          // Keep the last partial line in buffer
          buffer = lines.pop() || "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.startsWith("event:")) {
              currentEvent = trimmed.slice(6).trim();
            } else if (trimmed.startsWith("data:")) {
              const dataVal = trimmed.slice(5).trim();
              if (currentEvent === "chunk") {
                try {
                  // The server sends the base64 string serialized as JSON (via JSON.stringify)
                  let base64Str = dataVal;
                  if (dataVal.startsWith('"') && dataVal.endsWith('"')) {
                    try {
                      base64Str = JSON.parse(dataVal);
                    } catch (_) {
                      // fallback to stripping quotes if parsing fails
                      base64Str = dataVal.slice(1, -1);
                    }
                  }
                  // Normalize base64 encoding (e.g. convert URL-safe to standard, correct padding)
                  const cleanBase64 = base64Str.replace(/-/g, "+").replace(/_/g, "/");
                  const paddedBase64 = cleanBase64.padEnd(
                    cleanBase64.length + ((4 - (cleanBase64.length % 4)) % 4),
                    "="
                  );
                  const binaryString = atob(paddedBase64);
                  const len = binaryString.length;
                  const bytes = new Uint8Array(len);
                  for (let i = 0; i < len; i++) {
                    bytes[i] = binaryString.charCodeAt(i);
                  }
                  controller.enqueue(bytes);
                } catch (err) {
                  console.error("[use-chat-transport] Failed to decode chunk:", err, "dataVal:", dataVal);
                  if (!toastedDecodeError) {
                    toastedDecodeError = true;
                    onDecodeError?.();
                  }
                }
              } else if (!currentEvent) {
                // A bare `data:` frame is a plain UI-message stream:
                // the resume GET, the image lane and the confirmation
                // lane all send one. The cockpit stream never does, so
                // forward it as-is instead of dropping it.
                const frame = isResume ? patchResumeStart(trimmed, dataVal, resumeInto) : trimmed;
                controller.enqueue(encoder.encode(`${frame}\n\n`));
              } else {
                try {
                  const parsed = JSON.parse(dataVal);
                  if (
                    currentEvent === "message.persisted" &&
                    typeof parsed?.id === "string" &&
                    typeof parsed?.content === "string"
                  ) {
                    onMessagePersisted?.({ id: parsed.id, content: parsed.content, traceId: responseTraceId });
                  }
                  const ev = new CustomEvent("cockpit-event", {
                    detail: { type: currentEvent, payload: parsed },
                  });
                  window.dispatchEvent(ev);
                } catch (e) {
                  console.error("[use-chat-transport] Failed to parse SSE event data:", e);
                }
              }
            } else if (trimmed === "") {
              currentEvent = "";
            }
          }
        }
      } catch (err) {
        controller.error(err);
      } finally {
        reader.releaseLock();
      }
    },
    cancel() {
      reader.cancel().catch(() => {});
    },
  });

  return new Response(sseStream, {
    status: res.status,
    statusText: res.statusText,
    headers: res.headers,
  });
}
