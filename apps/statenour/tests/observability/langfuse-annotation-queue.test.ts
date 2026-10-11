import { describe, expect, it, vi } from "vitest";
import {
  enqueueLangfuseTraceForAnnotation,
  langfuseAnnotationQueueConfig,
} from "@/lib/observability/langfuse-annotation-queue";

// Langfuse traces from the OTel span processor carry 32-hex ids (audit 08-F17).
const HEX = "0123456789abcdef0123456789abcdef";
const ENV = { LANGFUSE_PUBLIC_KEY: "pk", LANGFUSE_SECRET_KEY: "sk", LANGFUSE_ANNOTATION_QUEUE_ID: "q" };

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
    const ok = await enqueueLangfuseTraceForAnnotation(HEX, {
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
      objectId: HEX,
      objectType: "TRACE",
      status: "PENDING",
    });
    expect((init.headers as Record<string, string>).authorization).toMatch(/^Basic /);
  });

  it("fails open on Langfuse rejection or network failure", async () => {
    expect(
      await enqueueLangfuseTraceForAnnotation(HEX, {
        env: {
          LANGFUSE_PUBLIC_KEY: "pk",
          LANGFUSE_SECRET_KEY: "sk",
          LANGFUSE_ANNOTATION_QUEUE_ID: "q",
        },
        fetchImpl: async () => ({ ok: false, status: 409 }),
      }),
    ).toBe(false);

    expect(
      await enqueueLangfuseTraceForAnnotation(HEX, {
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

  // Audit 08-F17: callers pass the statenour trace id (t_<base36>_...), which
  // matches no Langfuse trace, so every queue item pointed at nothing.
  it("a statenour trace id is not sent: it names no Langfuse trace", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200 }));
    expect(await enqueueLangfuseTraceForAnnotation("t_abc_0000_xyz", { env: ENV, fetchImpl })).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("control: a 32-hex Langfuse trace id is sent once", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200 }));
    expect(await enqueueLangfuseTraceForAnnotation(HEX, { env: ENV, fetchImpl })).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
