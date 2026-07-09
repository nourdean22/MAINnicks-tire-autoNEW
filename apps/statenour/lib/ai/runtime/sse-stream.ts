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
      const sendEvent = (type: string, payload: any) => {
        try {
          controller.enqueue(
            encoder.encode(`event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`)
          );
        } catch (err) {
          void import("@/lib/utils/error-log").then(({ logError }) => logError("ai.runtime.sse-stream", err, { fn: "createCockpitSseStream.sendEvent", eventType: type }, "warn"));
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

        // 4. Publish message.completed
        sendEvent("message.completed", {
          text: "", // client accumulates text from chunks
          costCents: 0,
          durationMs: 0,
          inputTokens: 0,
          outputTokens: 0,
        });

        controller.close();
      } catch (err) {
        void import("@/lib/utils/error-log").then(({ logError }) => logError("ai.runtime.sse-stream", err, { fn: "createCockpitSseStream.reader" }, "error"));
        controller.error(err);
      } finally {
        reader.releaseLock();
      }
    },
  });
}
