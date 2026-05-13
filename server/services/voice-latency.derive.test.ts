/**
 * getEndToEndFromVapiCall · wave-181.18 · Gap 2 from test-analyzer audit
 *
 * This is the ONLY pure-logic function in the voice-latency service —
 * 5 distinct failure paths, no DB, no async. It's the single point of
 * failure for the vapi-latency-sync cron's primary output (end-to-end
 * latency rows).
 *
 * A regression here silently produces ZERO new latency rows every
 * night. The cron returns success because derived.ok=false just bumps
 * skippedUnusable. The breach-streak alert can never fire because the
 * data plane is empty. Dashboard tile reads zero forever.
 *
 * Same 14-day silent-bug pattern as wave-181.1's phone-match. Cheap
 * test, prevents it.
 */

import { describe, expect, it } from "vitest";
import { getEndToEndFromVapiCall } from "./voice-latency";

describe("getEndToEndFromVapiCall", () => {
  it("happy path · startedAt + endedAt 1000ms apart yields endToEndMs=1000", () => {
    const r = getEndToEndFromVapiCall({
      id: "call-1",
      assistantId: "asst-1",
      startedAt: "2026-05-12T00:00:00.000Z",
      endedAt: "2026-05-12T00:00:01.000Z",
    });
    expect(r.ok).toBe(true);
    expect(r.endToEndMs).toBe(1000);
    expect(r.callId).toBe("call-1");
    expect(r.assistantId).toBe("asst-1");
  });

  it("missing id returns ok=false (can't dedup downstream without it)", () => {
    const r = getEndToEndFromVapiCall({
      assistantId: "asst-1",
      startedAt: "2026-05-12T00:00:00.000Z",
      endedAt: "2026-05-12T00:00:01.000Z",
    });
    expect(r.ok).toBe(false);
    expect(r.endToEndMs).toBeNull();
  });

  it("missing both startedAt AND createdAt returns ok=false", () => {
    const r = getEndToEndFromVapiCall({
      id: "call-1",
      assistantId: "asst-1",
      endedAt: "2026-05-12T00:00:01.000Z",
    });
    expect(r.ok).toBe(false);
    expect(r.endToEndMs).toBeNull();
  });

  it("missing endedAt returns ok=false (call still in progress)", () => {
    const r = getEndToEndFromVapiCall({
      id: "call-1",
      assistantId: "asst-1",
      startedAt: "2026-05-12T00:00:00.000Z",
    });
    expect(r.ok).toBe(false);
    expect(r.endToEndMs).toBeNull();
  });

  it("endedAt <= startedAt returns ok=false (clock skew / VAPI bug)", () => {
    const r = getEndToEndFromVapiCall({
      id: "call-1",
      assistantId: "asst-1",
      startedAt: "2026-05-12T00:00:05.000Z",
      endedAt: "2026-05-12T00:00:00.000Z", // earlier than start
    });
    expect(r.ok).toBe(false);
    expect(r.endToEndMs).toBeNull();
  });

  it("falls back to createdAt when startedAt missing", () => {
    const r = getEndToEndFromVapiCall({
      id: "call-1",
      assistantId: "asst-1",
      createdAt: "2026-05-12T00:00:00.000Z",
      endedAt: "2026-05-12T00:00:02.000Z",
    });
    expect(r.ok).toBe(true);
    expect(r.endToEndMs).toBe(2000);
  });

  it("missing assistantId defaults to 'unknown' (preserves callId for dedup)", () => {
    const r = getEndToEndFromVapiCall({
      id: "call-1",
      startedAt: "2026-05-12T00:00:00.000Z",
      endedAt: "2026-05-12T00:00:01.000Z",
    });
    expect(r.ok).toBe(true);
    expect(r.assistantId).toBe("unknown");
  });

  it("invalid date strings return ok=false (Number.isFinite guard)", () => {
    const r = getEndToEndFromVapiCall({
      id: "call-1",
      assistantId: "asst-1",
      startedAt: "not-a-date",
      endedAt: "2026-05-12T00:00:01.000Z",
    });
    expect(r.ok).toBe(false);
    expect(r.endToEndMs).toBeNull();
  });
});
