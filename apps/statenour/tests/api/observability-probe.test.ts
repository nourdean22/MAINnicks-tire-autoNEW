/**
 * tests/api/observability-probe.test.ts · 2026-09-02
 *
 * The probe exists because "no traces" and "a dead pipeline" looked identical
 * from outside for hours. Its whole value is that it PLANTS A KNOWN POSITIVE
 * and FLUSHES — an unflushed probe that returns ok:true would be the same
 * false green it was built to catch, so the flush calls are asserted here.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  generateText: vi.fn(),
  flushLangfuse: vi.fn().mockResolvedValue(undefined),
  sentryFlush: vi.fn().mockResolvedValue(true),
  captureMessage: vi.fn().mockReturnValue("event-abc"),
  telemetry: vi.fn(() => ({ isEnabled: true, functionId: "observability-probe", metadata: {} })),
}));

vi.mock("ai", () => ({ generateText: mocks.generateText }));
vi.mock("@/lib/ai/provider", () => ({ getModel: () => ({ modelId: "test-model" }) }));
vi.mock("@/lib/observability/langfuse", () => ({
  flushLangfuseTraces: mocks.flushLangfuse,
  isLangfuseTelemetryEnabled: () => true,
  langfuseTelemetry: mocks.telemetry,
  langfuseTracingStatus: () => "started",
}));
vi.mock("@/lib/observability/sentry", () => ({ resolveSentryDsn: () => "https://p@o1.ingest.us.sentry.io/2" }));
vi.mock("@sentry/nextjs", () => ({ captureMessage: mocks.captureMessage, flush: mocks.sentryFlush }));
vi.mock("@/lib/auth-guard", () => ({
  requireCronAuth: vi.fn(),
  requireSyncAuth: vi.fn(),
  requireSession: vi.fn(),
}));

import { POST } from "@/app/api/system/observability-probe/route";

function post(body: unknown = {}) {
  return POST(
    new Request("http://test/api/system/observability-probe", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({}) },
  );
}

async function data(res: Response) {
  const json = (await res.json()) as { ok: boolean; data: Record<string, never> };
  return json.data as Record<string, never>;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.generateText.mockResolvedValue({ text: "pong", response: { modelId: "test-model" } });
  mocks.flushLangfuse.mockResolvedValue(undefined);
  mocks.sentryFlush.mockResolvedValue(true);
  mocks.captureMessage.mockReturnValue("event-abc");
});

describe("POST /api/system/observability-probe", () => {
  it("plants a traced model call AND flushes it — an unflushed probe proves nothing", async () => {
    const d = await data(await post());
    expect(mocks.generateText).toHaveBeenCalledTimes(1);
    expect(mocks.flushLangfuse, "the batch processor must be drained before we claim it landed").toHaveBeenCalledTimes(1);
    expect((d as { langfuse: { ok: boolean; flushed: boolean } }).langfuse.ok).toBe(true);
    expect((d as { langfuse: { flushed: boolean } }).langfuse.flushed).toBe(true);
  });

  it("carries the probe id into the trace metadata so it can be read back by name", async () => {
    const d = await data(await post());
    const probeId = (d as { probeId: string }).probeId;
    expect(probeId).toBeTruthy();
    expect(mocks.telemetry).toHaveBeenCalledWith(
      expect.objectContaining({ functionId: "observability-probe", metadata: { probeId } }),
    );
  });

  it("captures a Sentry message and flushes that too", async () => {
    const d = await data(await post());
    expect(mocks.captureMessage).toHaveBeenCalledTimes(1);
    expect(mocks.sentryFlush).toHaveBeenCalledTimes(1);
    expect((d as { sentry: { eventId: string } }).sentry.eventId).toBe("event-abc");
  });

  it("honours a targets filter", async () => {
    const d = await data(await post({ targets: ["sentry"] }));
    expect(mocks.generateText).not.toHaveBeenCalled();
    expect(mocks.captureMessage).toHaveBeenCalledTimes(1);
    expect("langfuse" in d).toBe(false);
  });

  it("reports a failing sink as ok:false instead of throwing (a 500 tells you nothing)", async () => {
    mocks.generateText.mockRejectedValue(new Error("model unreachable"));
    const d = await data(await post({ targets: ["langfuse"] }));
    const lf = (d as { langfuse: { ok: boolean; error: string } }).langfuse;
    expect(lf.ok).toBe(false);
    expect(lf.error).toContain("model unreachable");
  });

  it("is CRON_SECRET-gated, like every other server-to-server system probe", async () => {
    const source = (await import("node:fs")).readFileSync(
      new URL("../../app/api/system/observability-probe/route.ts", import.meta.url),
      "utf8",
    );
    expect(source).toMatch(/\{\s*auth:\s*"cron"\s*\}/);
  });
});
