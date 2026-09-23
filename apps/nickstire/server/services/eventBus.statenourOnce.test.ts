/**
 * Q-12 phase 0 (docs/adr/0019-idempotent-bridge-writes.md §9): every bus event
 * reaches statenour exactly ONCE.
 *
 * Two bus destinations POST to statenour: "nour-os-bridge" (via its typeMap into
 * nour-os-bridge.ts) and "statenour-sync" (a direct fetch to /api/sync/events).
 * Before phase 0 both handled "all", so 14 of the 17 types arrived twice. This walks
 * EVERY registered type through the real routing (routeFor, the filter dispatch()
 * uses) and the real handlers, and counts the statenour sends:
 *   0 -> the type lost its only path (a new type nobody forwards)
 *   2 -> the double POST is back
 * Handlers are invoked directly instead of dispatch() so the other destinations
 * (Telegram, manager SMS, DB) never run.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const bridge = vi.hoisted(() => {
  const names = [
    "onLeadCaptured", "onCallbackRequested", "onBookingCreated", "onBookingCompleted",
    "onTireOrderPlaced", "onInvoiceCreated", "onRevenueMilestone", "onEmergencyRequest",
    "onReviewDetected", "onCampaignResult", "onStageChanged",
  ];
  return Object.fromEntries(names.map(n => [n, vi.fn()])) as Record<string, ReturnType<typeof vi.fn>>;
});
vi.mock("../nour-os-bridge", () => bridge);

import { BUSINESS_EVENTS, __routeForTest, type BusinessEvent } from "./eventBus";

const STATENOUR_SENDERS = new Set(["nour-os-bridge", "statenour-sync"]);

const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));

function syncPosts(): Array<{ type: string }> {
  return fetchMock.mock.calls
    .filter(([url]) => String(url).endsWith("/api/sync/events"))
    .map(([, init]) => JSON.parse(String((init as RequestInit).body)));
}

function bridgeCalls(): number {
  return Object.values(bridge).reduce((n, fn) => n + fn.mock.calls.length, 0);
}

async function statenourSendsFor(type: BusinessEvent): Promise<{ bridge: number; direct: number }> {
  fetchMock.mockClear();
  Object.values(bridge).forEach(fn => fn.mockClear());
  const route = (await __routeForTest(type)).filter(d => STATENOUR_SENDERS.has(d.name));
  for (const dest of route) {
    await dest.handler({ type, data: { id: 1 }, priority: "normal", source: "test", timestamp: "2026-09-23T00:00:00.000Z" });
  }
  return { bridge: bridgeCalls(), direct: syncPosts().length };
}

describe("eventBus -> statenour: each bus type is sent exactly once", () => {
  beforeEach(() => {
    vi.stubEnv("STATENOUR_SYNC_KEY", "test-key");
    vi.stubEnv("STATENOUR_SYNC_URL", "https://statenour.test");
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it.each(BUSINESS_EVENTS.map(t => [t]))("%s reaches statenour through exactly one sender", async (type) => {
    const sends = await statenourSendsFor(type);
    expect(sends.bridge + sends.direct, JSON.stringify(sends)).toBe(1);
  });

  // assert-the-consumer: the types the bridge does not map keep statenour-sync as
  // their only path, under the exact type string app/api/sync/events consumes
  // (it upserts socialPublishQueue on "nickstire:social_draft:sync").
  it.each([["social_draft:sync"], ["mirror_synced"], ["data_refreshed"]] as const)(
    "%s still arrives via statenour-sync as nickstire:<type>",
    async (type) => {
      const sends = await statenourSendsFor(type);
      expect(sends).toEqual({ bridge: 0, direct: 1 });
      expect(syncPosts()[0].type).toBe(`nickstire:${type}`);
    },
  );
});
