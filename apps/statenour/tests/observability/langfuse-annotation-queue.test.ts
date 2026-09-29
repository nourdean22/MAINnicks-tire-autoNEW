import { describe, expect, it, vi } from "vitest";
import {
  enqueueLangfuseTraceForAnnotation,
  langfuseAnnotationQueueConfig,
} from "@/lib/observability/langfuse-annotation-queue";

describe("Q-32 Langfuse annotation queue client", () => {
  it("is disabled unless keys AND the one queue id are configured", () => {
    expect(langfuseAnnotationQueueConfig({})).toBeNull();
    expect(
      langfuseAnnotationQueueConfig({
        LANGFUSE_PUBLIC_KEY: "pk",
        LANGFUSE_SECRET_KEY: "sk",
      }),
    ).toBeNull();
  });

  it("POSTs the exact current Langfuse TRACE/PENDING contract", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200 }));
    const ok = await enqueueLangfuseTraceForAnnotation("trace-123", {
      env: {
        LANGFUSE_PUBLIC_KEY: "pk",
        LANGFUSE_SECRET_KEY: "sk",
        LANGFUSE_BASE_URL: "https://us.cloud.langfuse.com/",
        LANGFUSE_ANNOTATION_QUEUE_ID: "queue abc",
      },
      fetchImpl,
    });
    expect(ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(
      "https://us.cloud.langfuse.com/api/public/annotation-queues/queue%20abc/items",
    );
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({
      objectId: "trace-123",
      objectType: "TRACE",
      status: "PENDING",
    });
    expect((init.headers as Record<string, string>).authorization).toMatch(/^Basic /);
  });

  it("fails open on Langfuse rejection or network failure", async () => {
    expect(
      await enqueueLangfuseTraceForAnnotation("trace-1", {
        env: {
          LANGFUSE_PUBLIC_KEY: "pk",
          LANGFUSE_SECRET_KEY: "sk",
          LANGFUSE_ANNOTATION_QUEUE_ID: "q",
        },
        fetchImpl: async () => ({ ok: false, status: 409 }),
      }),
    ).toBe(false);

    expect(
      await enqueueLangfuseTraceForAnnotation("trace-2", {
        env: {
          LANGFUSE_PUBLIC_KEY: "pk",
          LANGFUSE_SECRET_KEY: "sk",
          LANGFUSE_ANNOTATION_QUEUE_ID: "q",
        },
        fetchImpl: async () => {
          throw new Error("network down");
        },
      }),
    ).toBe(false);
  });
});
