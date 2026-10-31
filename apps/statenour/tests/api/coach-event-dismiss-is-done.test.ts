/**
 * The banner's dismiss button is the OPERATOR saying done (home-pulse W3, 2026-10-31).
 * It called ackCoachEvent, the writer's "condition cleared" signal, so the writer's next fire treated
 * the event as a new occurrence and the dismissed banner came back. Dismiss now records done, which
 * survives re-fires (tests/services/coach-events-operator-state.test.ts pins that rule).
 */
import { describe, it, expect, vi } from "vitest";

const h = vi.hoisted(() => ({ done: vi.fn(async () => true), ack: vi.fn(async () => true) }));

vi.mock("@/lib/utils/http", () => ({ apiHandler: (fn: unknown) => fn }));
vi.mock("@/lib/services/coach-events", () => ({ markCoachEventDone: h.done, ackCoachEvent: h.ack }));

import { POST } from "@/app/api/coach/events/[key]/ack/route";

const call = POST as unknown as (req: unknown, ctx: unknown) => Promise<Record<string, unknown>>;

describe("POST /api/coach/events/[key]/ack", () => {
  it("records operator done for the decoded key and never the writer ack", async () => {
    const out = await call({}, { params: Promise.resolve({ key: encodeURIComponent("coach:system-alert:cost-slo") }) });
    expect(out).toEqual({ ok: true, key: "coach:system-alert:cost-slo" });
    expect(h.done).toHaveBeenCalledWith("coach:system-alert:cost-slo");
    expect(h.ack).not.toHaveBeenCalled();
  });

  it("a key that does not resolve says so", async () => {
    h.done.mockResolvedValueOnce(false);
    const out = await call({}, { params: Promise.resolve({ key: "coach:system-alert:nope" }) });
    expect(out.ok).toBe(false);
  });
});
