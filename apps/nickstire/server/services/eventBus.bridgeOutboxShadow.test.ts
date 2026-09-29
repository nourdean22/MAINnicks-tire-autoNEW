/**
 * Q-12 phase 1b · the bus reaches the bridge_outbox shadow enqueue for every
 * type, and adding it removed neither StateNour sender (ADR-0019 §9: shadow
 * runs BESIDE the legacy path until a family is cut over).
 *
 * Driven through the real routing (__routeForTest, what dispatch() uses), with
 * bridgeOutbox mocked so no database is touched.
 */
import { describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ shadowEnqueue: vi.fn(async () => "enqueued") }));
vi.mock("./bridgeOutbox", () => ({ shadowEnqueue: h.shadowEnqueue }));

import { BUSINESS_EVENTS, __routeForTest, type EventPayload } from "./eventBus";

describe("bus -> bridge_outbox shadow", () => {
  it("routes every bus type to the shadow destination, and the handler enqueues the event it was given", async () => {
    for (const type of BUSINESS_EVENTS) {
      const route = await __routeForTest(type);
      const shadow = route.find((d) => d.name === "bridge-outbox-shadow");
      expect(shadow, type).toBeDefined();
      const event: EventPayload = { type, data: { id: 1 }, priority: "normal", source: "test", timestamp: "2026-09-29T20:00:00.000Z" };
      h.shadowEnqueue.mockClear();
      await shadow!.handler(event);
      expect(h.shadowEnqueue, type).toHaveBeenCalledWith(event);
    }
  });

  it("keeps the legacy StateNour senders routed (shadow replaces nothing)", async () => {
    const lead = (await __routeForTest("lead_captured")).map((d) => d.name);
    expect(lead).toContain("nour-os-bridge");
    const draft = (await __routeForTest("social_draft:sync")).map((d) => d.name);
    expect(draft).toContain("statenour-sync");
  });
});
