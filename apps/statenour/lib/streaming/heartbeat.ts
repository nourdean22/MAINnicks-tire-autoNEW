/**
 * SSE heartbeat — B4 · keep long-lived streams alive through slow
 * middle-boxes and silent tool calls.
 *
 * ─── The problem ───────────────────────────────────────────────────
 * `useChat` (AI SDK) streams server-sent events to the client. When
 * Nick hits a slow tool mid-stream (think a 12s arsenal research
 * call or a Venice completion that's cold-starting), there's a gap
 * in data frames. If that gap is > ~10s, some of:
 *   · Corporate proxies / Cloudflare drop the connection as "idle"
 *   · iOS Safari backgrounds the fetch and kills it
 *   · The client's stall-detection fires "Nick is stuck"
 *
 * ─── The fix ───────────────────────────────────────────────────────
 * Interleave SSE comment frames (`: ping-<ts>\n\n`) every N seconds.
 * Comments are spec-compliant (RFC 6202 / W3C EventSource §9) and
 * any SSE parser — including the AI SDK's UI-message parser — is
 * required to ignore them. The client sees bytes arriving so the
 * socket stays open; the parser sees nothing.
 *
 * ─── Usage ─────────────────────────────────────────────────────────
 *   const response = result.toUIMessageStreamResponse();
 *   return new Response(withHeartbeat(response.body, 7_000), {
 *     status: response.status,
 *     headers: response.headers,
 *   });
 *
 * Defaults are tuned for Vercel + Cloudflare:
 *   · 7s interval (< 10s idle-kill threshold on CF)
 *   · first ping immediate (starts the read so proxy commits to SSE)
 *   · stops cleanly when upstream closes
 */

export interface HeartbeatOptions {
  /** Interval between pings in ms. Default 7_000. */
  intervalMs?: number;
  /** Send an initial ping immediately. Default true. */
  leadingPing?: boolean;
  /** Custom label in the ping comment for debugging. Default "ping". */
  label?: string;
}

/**
 * Wrap a ReadableStream so it emits SSE-safe heartbeat comments at a
 * fixed cadence without disrupting the underlying byte stream.
 *
 * The wrapped stream:
 *   · Passes every chunk from `upstream` through unchanged
 *   · Enqueues `: <label>-<ts>\n\n` every intervalMs
 *   · Stops the timer when upstream closes, errors, or is cancelled
 */
export function withHeartbeat(
  upstream: ReadableStream<Uint8Array> | null,
  intervalMs = 7_000,
  opts: Omit<HeartbeatOptions, "intervalMs"> = {},
): ReadableStream<Uint8Array> {
  const { leadingPing = true, label = "ping" } = opts;
  const encoder = new TextEncoder();
  const pingBytes = () =>
    encoder.encode(`: ${label}-${Date.now()}\n\n`);

  // Shared state lives in the outer closure so `cancel()` can signal
  // `start()` to unwind even after start() has yielded. Without this,
  // cancelling mid-stream leaked both the upstream reader and the
  // heartbeat timer.
  let timer: ReturnType<typeof setInterval> | null = null;
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  let closed = false;

  const stopTimer = () => {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  };

  const teardown = () => {
    closed = true;
    stopTimer();
    if (reader) {
      try {
        reader.cancel().catch(() => {});
      } catch {
        /* reader already released */
      }
      try {
        reader.releaseLock();
      } catch {
        /* already released */
      }
      reader = null;
    }
  };

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const safeEnqueue = (bytes: Uint8Array) => {
        if (closed) return;
        try {
          controller.enqueue(bytes);
        } catch {
          // Controller closed out from under us — happens on cancel.
          teardown();
        }
      };

      // Kick the stream immediately so the client + any proxy commit
      // to the connection before upstream produces its first chunk.
      // (Without this, Cloudflare sometimes buffers the response
      // headers and delays TTFB by the full upstream cold-start.)
      if (leadingPing) safeEnqueue(pingBytes());

      timer = setInterval(() => safeEnqueue(pingBytes()), intervalMs);

      if (!upstream) {
        // No upstream body — degenerate case, just keep pinging until
        // the caller cancels. Unlikely but cheap to handle.
        return;
      }

      reader = upstream.getReader();
      try {
        while (!closed) {
          const { value, done } = await reader.read();
          if (done) break;
          if (value) safeEnqueue(value);
        }
      } catch (err) {
        if (!closed) {
          try {
            controller.error(err);
          } catch {
            /* already closed */
          }
        }
      } finally {
        teardown();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },

    cancel(reason) {
      // Consumer aborted. Tear down IMMEDIATELY so the upstream reader
      // and heartbeat timer don't outlive the stream. Without this the
      // while-loop in start() keeps pulling until upstream naturally
      // ends — which for a long AI stream can be minutes.
      teardown();
      // Propagate cancellation upstream so the underlying fetch / model
      // call can also be aborted (saves Venice/OpenAI spend on dropped
      // conversations).
      if (upstream) {
        upstream.cancel(reason).catch(() => {});
      }
    },
  });
}
