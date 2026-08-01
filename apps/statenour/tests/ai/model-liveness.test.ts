/**
 * tests/ai/model-liveness.test.ts · 2026-08-01.
 *
 * Pins the Ollama lane canary. The probe exists because this key has
 * lost two models to silent retirement, and because the vision lane then
 * ran dead in production for ~6 weeks AFTER the registry was corrected —
 * a stale Railway OLLAMA_VISION_MODEL pin beat the registry default.
 *
 * So the load-bearing property is not "it makes an HTTP call". It is
 * that it probes what `resolveProviderModel` RESOLVES (env override
 * included) rather than what the registry declares. A probe reading the
 * registry would have reported healthy through the entire outage.
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { probeOllamaLanes, summarizeLanes } from "@/lib/ai/model-liveness";
import { PROVIDERS_REGISTRY } from "@/config/ai-providers";

interface Captured {
  url: string;
  model: string;
  auth: string | undefined;
}

/** Fake fetch that records each request and replies per-model. */
function fakeFetch(reply: (model: string) => { status: number; body?: string }) {
  const calls: Captured[] = [];
  const impl = (async (url: unknown, init: unknown) => {
    const opts = init as { body: string; headers: Record<string, string> };
    const model = JSON.parse(opts.body).model as string;
    calls.push({
      url: String(url),
      model,
      auth: opts.headers?.Authorization,
    });
    const { status, body } = reply(model);
    return {
      status,
      text: async () => body ?? "",
    };
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const ALL_OK = () => ({ status: 200 });

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Ollama lane liveness probe", () => {
  it("probes the model the app RESOLVES, not the registry default", async () => {
    // The regression this canary exists for: prod pinned the vision lane
    // to a retired id via env, so the registry default was never used.
    // The probe must follow the override or it reports a lane healthy
    // while every real turn 410s.
    vi.stubEnv("OLLAMA_API_KEY", "test-key");
    vi.stubEnv("OLLAMA_VISION_MODEL", "some-pinned-vision-model");

    const { impl, calls } = fakeFetch(ALL_OK);
    await probeOllamaLanes(impl);

    const probed = calls.map((c) => c.model);
    expect(probed).toContain("some-pinned-vision-model");
    expect(probed).not.toContain(PROVIDERS_REGISTRY.ollama.defaultVisionModel);
  });

  it("probes all three lanes and authenticates each call", async () => {
    vi.stubEnv("OLLAMA_API_KEY", "test-key");
    const { impl, calls } = fakeFetch(ALL_OK);

    const report = await probeOllamaLanes(impl);

    expect(report.ok).toBe(true);
    expect(report.failing).toHaveLength(0);
    expect(report.probes.map((p) => p.lane).sort()).toEqual(["chat", "fast", "vision"]);
    expect(calls).toHaveLength(3);
    for (const c of calls) expect(c.auth).toBe("Bearer test-key");
  });

  it("classifies HTTP 410 as RETIRED, distinct from a generic failure", async () => {
    // 410 means "never again" — it must not be flattened into the same
    // bucket as a timeout, because the remediation is different.
    vi.stubEnv("OLLAMA_API_KEY", "test-key");
    vi.stubEnv("OLLAMA_VISION_MODEL", "qwen3-vl:235b-instruct");
    const { impl } = fakeFetch((model) =>
      model === "qwen3-vl:235b-instruct"
        ? { status: 410, body: '{"error":"qwen3-vl:235b-instruct was retired at 2026-06-16"}' }
        : { status: 200 },
    );

    const report = await probeOllamaLanes(impl);
    const vision = report.probes.find((p) => p.lane === "vision");

    expect(report.ok).toBe(false);
    expect(vision?.state).toBe("retired");
    expect(vision?.httpStatus).toBe(410);
    // The retirement date is the single most useful line for the operator.
    expect(vision?.detail).toContain("retired at 2026-06-16");
    expect(report.failing).toHaveLength(1);
  });

  it("classifies 401/403 as unauthorized, not as a dead model", async () => {
    vi.stubEnv("OLLAMA_API_KEY", "test-key");
    const { impl } = fakeFetch(() => ({ status: 401, body: "invalid key" }));

    const report = await probeOllamaLanes(impl);

    expect(report.ok).toBe(false);
    expect(report.probes.every((p) => p.state === "unauthorized")).toBe(true);
  });

  it("a thrown request becomes unreachable, never a silent pass", async () => {
    vi.stubEnv("OLLAMA_API_KEY", "test-key");
    const impl = (async () => {
      throw new Error("ETIMEDOUT");
    }) as unknown as typeof fetch;

    const report = await probeOllamaLanes(impl);

    expect(report.ok).toBe(false);
    expect(report.probes.every((p) => p.state === "unreachable")).toBe(true);
    expect(report.probes[0]?.detail).toContain("ETIMEDOUT");
  });

  it("a missing API key FAILS the probe instead of skipping it", async () => {
    // The silent-IDLE trap this repo keeps hitting: a canary that
    // returns ok when it is unconfigured is decorative. Absence of a
    // key means the entire Ollama lane is off — that is an alarm.
    vi.stubEnv("OLLAMA_API_KEY", "");
    const { impl, calls } = fakeFetch(ALL_OK);

    const report = await probeOllamaLanes(impl);

    expect(report.ok).toBe(false);
    expect(report.failing).toHaveLength(3);
    expect(report.probes.every((p) => p.state === "unconfigured")).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it("summarizeLanes names the lane, the model and the reason", async () => {
    vi.stubEnv("OLLAMA_API_KEY", "test-key");
    vi.stubEnv("OLLAMA_VISION_MODEL", "dead-model");
    const { impl } = fakeFetch((model) =>
      model === "dead-model" ? { status: 410, body: "retired" } : { status: 200 },
    );

    const report = await probeOllamaLanes(impl);
    const text = summarizeLanes(report.probes);

    // An alert that omits the model id forces the operator to go dig.
    expect(text).toContain("vision");
    expect(text).toContain("dead-model");
    expect(text).toContain("retired");
    expect(text).toContain("410");
  });
});
