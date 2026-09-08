/**
 * tests/lib/observability/langfuse-scores.test.ts · 2026-09-08 (program U6)
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/logger", () => ({ logger: { withSurface: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) } }));

import { langfuseScoreConfig, sendLangfuseScore } from "@/lib/observability/langfuse-scores";

const ENV = { LANGFUSE_PUBLIC_KEY: "pk-test-fixture", LANGFUSE_SECRET_KEY: "sk-test-fixture", LANGFUSE_BASE_URL: "https://lf.test/" };

describe("sendLangfuseScore", () => {
  it("is a no-op without keys or without a traceId — and never calls fetch", async () => {
    const fetchImpl = vi.fn();
    expect(await sendLangfuseScore({ traceId: "t1", name: "operator_thumb", value: 1 }, { env: {}, fetchImpl })).toBe(false);
    expect(await sendLangfuseScore({ traceId: null, name: "operator_thumb", value: 1 }, { env: ENV, fetchImpl })).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("posts a NUMERIC score keyed by traceId with basic auth to the public API", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200 }));
    const ok = await sendLangfuseScore({ traceId: "trace-abc", name: "operator_thumb", value: -1, comment: "wrong amount" }, { env: ENV, fetchImpl });
    expect(ok).toBe(true);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://lf.test/api/public/scores");
    expect((init.headers as Record<string, string>).authorization).toBe(langfuseScoreConfig(ENV)!.auth);
    expect(JSON.parse(String(init.body))).toEqual({ traceId: "trace-abc", name: "operator_thumb", value: -1, dataType: "NUMERIC", comment: "wrong amount" });
  });

  it("a rejected or failing request returns false instead of throwing into the feedback path", async () => {
    expect(await sendLangfuseScore({ traceId: "t", name: "n", value: 1 }, { env: ENV, fetchImpl: vi.fn(async () => ({ ok: false, status: 401 })) })).toBe(false);
    expect(await sendLangfuseScore({ traceId: "t", name: "n", value: 1 }, { env: ENV, fetchImpl: vi.fn(async () => { throw new Error("boom"); }) })).toBe(false);
  });
});
