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
  };
  recalledMemories: Array<{ id: string; content: string; similarity: number; category: string }>;
  contradictions: Array<{ id: string; claim: string; reality: string; severity: string }>;
  onFinishPromise: Promise<void>;
}

export function createCockpitSseStream(input: CreateCockpitSseStreamInput): ReadableStream<Uint8Array> {
  const {
    aiSdkStream,
    traceId,
    classification,
    recalledMemories,
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

      // 1. Publish intent.classified
      sendEvent("intent.classified", {
        intent: classification.intent,
        mode: classification.mode,
        model: classification.model,
        provider: classification.provider,
        targets: classification.targets,
      });

      // 2. Publish memory.recalled
      sendEvent("memory.recalled", {
        hits: recalledMemories,
        contradictions: contradictions,
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
        reader.releaseLock();
      }
    },
  });
}
