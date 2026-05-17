/**
 * tests/services/voice-latency.test.ts · v10.0.526 · Arc A Feature 3
 *
 * Coverage:
 *   1. captureVoiceLatency · happy path + rejects invalid input +
 *      fails-open on DB error
 *   2. getP50P95ByStage · correct quantile math per stage + handles
 *      empty + handles missing table (parked migration)
 *   3. getCurrentBreachStreak · counts consecutive trailing call-days
 *      over target · breaks on first day ≤ target · honors threshold
 *   4. getEndToEndFromVapiCall · derives from startedAt/endedAt ·
 *      rejects missing/inverted timestamps · falls back to createdAt
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  voiceLatencyEvent: {
    create: vi.fn(),
    findMany: vi.fn(),
  },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    voiceLatencyEvent: mocks.voiceLatencyEvent,
  },
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    withSurface: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  },
}));

import {
  captureVoiceLatency,
  getCurrentBreachStreak,
  getEndToEndFromVapiCall,
  getP50P95ByStage,
  VOICE_LATENCY_TARGET_MS,
} from "@/lib/services/voice-latency";

describe("voice-latency service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── 1. captureVoiceLatency ─────────────────────────────────────
  describe("captureVoiceLatency", () => {
    it("writes a row for valid input", async () => {
      mocks.voiceLatencyEvent.create.mockResolvedValue({ id: "v_1" });

      const out = await captureVoiceLatency({
        callId: "call_123",
        assistantId: "asst_xyz",
        stage: "stt_end",
        latencyMs: 420,
      });

      expect(out.ok).toBe(true);
      expect(mocks.voiceLatencyEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          callId: "call_123",
          assistantId: "asst_xyz",
          stage: "stt_end",
          latencyMs: 420,
        }),
      });
    });

    it("rejects missing callId / negative latency / bad stage", async () => {
      // Missing callId
      expect(
        (
          await captureVoiceLatency({
            callId: "",
            assistantId: "asst_xyz",
            stage: "stt_end",
            latencyMs: 100,
          })
        ).ok,
      ).toBe(false);

      // Negative latency
      expect(
        (
          await captureVoiceLatency({
            callId: "c",
            assistantId: "a",
            stage: "stt_end",
            latencyMs: -1,
          })
        ).ok,
      ).toBe(false);

      // Invalid stage (cast to bypass TS guard)
      expect(
        (
          await captureVoiceLatency({
            callId: "c",
            assistantId: "a",
            stage: "bogus_stage" as never,
            latencyMs: 100,
          })
        ).ok,
      ).toBe(false);

      // None of the invalid inputs should hit the DB.
      expect(mocks.voiceLatencyEvent.create).not.toHaveBeenCalled();
    });

    it("fails-open when DB throws (parked migration)", async () => {
      mocks.voiceLatencyEvent.create.mockRejectedValue(
        new Error('relation "voice_latency_events" does not exist'),
      );

      const out = await captureVoiceLatency({
        callId: "call_x",
        assistantId: "asst_x",
        stage: "tts_first_byte",
        latencyMs: 250,
      });

      expect(out.ok).toBe(false);
    });
  });

  // ── 2. getP50P95ByStage ────────────────────────────────────────
  describe("getP50P95ByStage", () => {
    it("computes p50/p95 per stage from rows", async () => {
      // 10-value distribution · p50 nearest-rank = 5th element ·
      // p95 nearest-rank = 10th element
      const ttsValues = [100, 150, 180, 200, 220, 240, 260, 280, 320, 800];
      mocks.voiceLatencyEvent.findMany.mockResolvedValue(
        ttsValues.map((v) => ({ stage: "tts_first_byte", latencyMs: v })),
      );

      const stages = await getP50P95ByStage(7);
      const tts = stages.find((s) => s.stage === "tts_first_byte");
      expect(tts).toBeDefined();
      expect(tts!.count).toBe(10);
      // Sorted [100,150,180,200,220,240,260,280,320,800]
      // ceil(0.5*10)-1 = 4 → 220
      expect(tts!.p50).toBe(220);
      // ceil(0.95*10)-1 = 9 → 800
      expect(tts!.p95).toBe(800);

      // Empty stages should be present with zeros.
      const stt = stages.find((s) => s.stage === "stt_end");
      expect(stt!.count).toBe(0);
      expect(stt!.p50).toBe(0);
    });

    it("returns zero stats when table is missing", async () => {
      mocks.voiceLatencyEvent.findMany.mockRejectedValue(
        new Error("relation does not exist"),
      );

      const stages = await getP50P95ByStage(7);
      expect(stages.every((s) => s.count === 0)).toBe(true);
      expect(stages.length).toBeGreaterThan(0);
    });
  });

  // ── 3. getCurrentBreachStreak ──────────────────────────────────
  describe("getCurrentBreachStreak", () => {
    it("counts consecutive trailing days above target", async () => {
      const now = Date.now();
      const day = 86_400_000;
      const overTarget = VOICE_LATENCY_TARGET_MS + 200;
      const underTarget = VOICE_LATENCY_TARGET_MS - 50;

      // Build 4 trailing days · today/yesterday/2d/3d
      // Today: 3 over-target values · p50 over-target
      // Yesterday: 3 over-target values · p50 over-target
      // 2d ago: 3 over-target values · p50 over-target  → streak=3
      // 3d ago: 3 under-target values · p50 under-target → break
      mocks.voiceLatencyEvent.findMany.mockResolvedValue([
        // 3d ago (under)
        { createdAt: new Date(now - 3 * day), latencyMs: underTarget },
        { createdAt: new Date(now - 3 * day + 1000), latencyMs: underTarget },
        { createdAt: new Date(now - 3 * day + 2000), latencyMs: underTarget },
        // 2d ago (over)
        { createdAt: new Date(now - 2 * day), latencyMs: overTarget },
        { createdAt: new Date(now - 2 * day + 1000), latencyMs: overTarget },
        { createdAt: new Date(now - 2 * day + 2000), latencyMs: overTarget },
        // 1d ago (over)
        { createdAt: new Date(now - 1 * day), latencyMs: overTarget },
        { createdAt: new Date(now - 1 * day + 1000), latencyMs: overTarget },
        { createdAt: new Date(now - 1 * day + 2000), latencyMs: overTarget },
        // today (over)
        { createdAt: new Date(now), latencyMs: overTarget },
        { createdAt: new Date(now - 1000), latencyMs: overTarget },
        { createdAt: new Date(now - 2000), latencyMs: overTarget },
      ]);

      const breach = await getCurrentBreachStreak();
      expect(breach.streak).toBe(3);
      expect(breach.alertReady).toBe(true);
    });

    it("returns streak=0 when most-recent day is under target", async () => {
      const now = Date.now();
      const day = 86_400_000;
      const overTarget = VOICE_LATENCY_TARGET_MS + 200;
      const underTarget = VOICE_LATENCY_TARGET_MS - 50;

      mocks.voiceLatencyEvent.findMany.mockResolvedValue([
        // Yesterday over (would-be streak)
        { createdAt: new Date(now - 1 * day), latencyMs: overTarget },
        // Today under (breaks immediately)
        { createdAt: new Date(now), latencyMs: underTarget },
      ]);

      const breach = await getCurrentBreachStreak();
      expect(breach.streak).toBe(0);
      expect(breach.alertReady).toBe(false);
    });
  });

  // ── 4. getEndToEndFromVapiCall ─────────────────────────────────
  describe("getEndToEndFromVapiCall", () => {
    it("derives ms from startedAt → endedAt", () => {
      const out = getEndToEndFromVapiCall({
        id: "call_a",
        assistantId: "asst_a",
        startedAt: "2026-05-12T10:00:00.000Z",
        endedAt: "2026-05-12T10:00:00.750Z",
      });
      expect(out.ok).toBe(true);
      expect(out.endToEndMs).toBe(750);
      expect(out.callId).toBe("call_a");
    });

    it("falls back to createdAt when startedAt missing", () => {
      const out = getEndToEndFromVapiCall({
        id: "call_b",
        createdAt: "2026-05-12T10:00:00.000Z",
        endedAt: "2026-05-12T10:00:01.000Z",
      });
      expect(out.ok).toBe(true);
      expect(out.endToEndMs).toBe(1000);
    });

    it("rejects calls with missing endpoints or inverted times", () => {
      // Missing endedAt
      expect(
        getEndToEndFromVapiCall({
          id: "c",
          startedAt: "2026-05-12T10:00:00.000Z",
        }).ok,
      ).toBe(false);

      // Inverted (endedAt before startedAt)
      expect(
        getEndToEndFromVapiCall({
          id: "c",
          startedAt: "2026-05-12T10:00:01.000Z",
          endedAt: "2026-05-12T10:00:00.000Z",
        }).ok,
      ).toBe(false);

      // Missing id
      expect(getEndToEndFromVapiCall({ id: "" }).ok).toBe(false);
    });
  });
});
