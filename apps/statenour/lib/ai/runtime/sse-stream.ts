import { CockpitEvent, cockpitEventStore } from "./event-protocol";

interface CreateCockpitSseStreamInput {
  aiSdkStream: ReadableStream<Uint8Array>;
  traceId: string;
  classification: {
    intent: string;
    mode: "fast" | "operator" | "engineer";
    model: string;
    provider: string;
    targets: string[];
    /** The classifier did not run; the other fields are the turn's own labels. */
    skipped?: boolean;
  };
  recalledMemories: Array<{ id: string; content: string; similarity: number; category: string }>;
  /** 2026-09-10 · three-state provenance for `recalledMemories`. An empty
   *  array means nothing on its own -- see memory-recall.RecallProvenance. */
  recallProvenance?: "OK" | "ZERO" | "ERROR" | "UNMEASURED";
  recallProvenanceReason?: string;
  contradictions: Array<{ id: string; claim: string; reality: string; severity: string }>;
  onFinishPromise: Promise<void>;
}

/**
 * 2026-10-10 (audit 04-F2 / 04-F14) · `message.persisted { id, content }`.
 *
 * ai@6 holds the response body open until onFinish resolves, and onFinish
 * keeps working after the row is written (post-persist verification,
 * deferred work). The persist step calls notifyMessagePersisted(traceId, ...)
 * the moment the row exists; the stream for that trace emits it at once, so
 * the client learns the STORED text and id without waiting for
 * message.completed. In-process only: persist and stream run in the same
 * request. A notify with no live stream for that trace is dropped (false).
 */
export interface PersistedMessage {
  id: string;
  content: string;
}
const persistedListeners = new Map<string, (p: PersistedMessage) => void>();

export function notifyMessagePersisted(traceId: string, persisted: PersistedMessage): boolean {
  const listener = persistedListeners.get(traceId);
  if (!listener) return false;
  listener(persisted);
  return true;
}

export function createCockpitSseStream(input: CreateCockpitSseStreamInput): ReadableStream<Uint8Array> {
  const {
    aiSdkStream,
    traceId,
    classification,
    recalledMemories,
    recallProvenance,
    recallProvenanceReason,
    contradictions,
    onFinishPromise,
  } = input;

  const encoder = new TextEncoder();
  const reader = aiSdkStream.getReader();

  return new ReadableStream({
    async start(controller) {
      // The client can disconnect mid-stream (navigate away / abort). After that
      // `controller.enqueue` throws "Controller is already closed" for every
      // subsequent event — which previously logged one warn PER chunk, flooding
      // error_logs (348 rows / 48h from a handful of aborted streams). Track it:
      // drop further sends silently and log exactly once.
      let clientClosed = false;
      const sendEvent = (type: string, payload: any) => {
        if (clientClosed) return;
        try {
          controller.enqueue(
            encoder.encode(`event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`)
          );
        } catch (err) {
          clientClosed = true;
          void import("@/lib/utils/error-log").then(({ logError }) => logError("ai.runtime.sse-stream", err, { fn: "createCockpitSseStream.sendEvent", eventType: type, note: "client disconnected mid-stream; suppressing further sends" }, "warn"));
        }
      };

      const onPersisted = (p: PersistedMessage) => {
        sendEvent("message.persisted", { id: p.id, content: p.content });
      };
      persistedListeners.set(traceId, onPersisted);

      // 1. Publish intent.classified
      sendEvent("intent.classified", {
        intent: classification.intent,
        mode: classification.mode,
        model: classification.model,
        provider: classification.provider,
        targets: classification.targets,
        ...(classification.skipped ? { skipped: true } : {}),
      });

      // 2. Publish memory.recalled
      sendEvent("memory.recalled", {
        hits: recalledMemories,
        contradictions: contradictions,
        provenance: recallProvenance,
        provenanceReason: recallProvenanceReason,
      });

      // 3. Define the publish function for our event protocol
      const publish = (event: CockpitEvent) => {
        sendEvent(event.type, event.payload);
      };

      try {
        // Run the async reading loop inside the AsyncLocalStorage context
        await cockpitEventStore.run({ traceId, publish }, async () => {
          while (true) {
            if (clientClosed) break; // client gone — stop pulling upstream
            const { done, value } = await reader.read();
            if (done) {
              break;
            }
            // Base64 encode raw chunk bytes to keep SSE boundaries clean
            const base64Chunk = Buffer.from(value).toString("base64");
            sendEvent("chunk", base64Chunk);
          }

          // Wait for onFinish post-processing work (and any action executions) to complete
          await onFinishPromise;
        });

        // 4. Publish message.completed — only if the client is still attached.
        // Always AFTER message.persisted (that fires mid-onFinish, above).
        // Closing an already-closed controller throws and re-logs noise.
        if (!clientClosed) {
          sendEvent("message.completed", {
            text: "", // client accumulates text from chunks
            costCents: 0,
            durationMs: 0,
            inputTokens: 0,
            outputTokens: 0,
          });
          controller.close();
        }
      } catch (err) {
        if (clientClosed) {
          // Client disconnected mid-stream; the read/close cascade is the
          // expected consequence, not a real failure. Log once at warn and do
          // NOT call controller.error — the controller is already closed.
          void import("@/lib/utils/error-log").then(({ logError }) => logError("ai.runtime.sse-stream", err, { fn: "createCockpitSseStream.reader", note: "client disconnected mid-stream" }, "warn"));
        } else {
          void import("@/lib/utils/error-log").then(({ logError }) => logError("ai.runtime.sse-stream", err, { fn: "createCockpitSseStream.reader" }, "error"));
          controller.error(err);
        }
      } finally {
        if (persistedListeners.get(traceId) === onPersisted) persistedListeners.delete(traceId);
        reader.releaseLock();
      }
    },
  });
}
