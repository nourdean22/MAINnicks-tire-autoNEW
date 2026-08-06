/**
 * Identity-snapshot read cache · 2026-08-06.
 *
 * loadIdentitySnapshot() reads brain_memories identity_snapshot/current on
 * EVERY chat turn — buildIdentityContextBlock() fired on 1417/1417 measured
 * turns — for a row the refresh-identity cron rolls once a day. It is now
 * wrapped in cached() at a 300s TTL.
 *
 * The second test is the one that matters. A 5-minute TTL on this row is
 * only safe because both writers invalidate; without the invalidation in
 * setManualOverride() an operator pinning an axis via PATCH /api/identity
 * would not see their own change for up to 5 minutes, and not only in
 * /chat — loadIdentitySnapshot has seven-plus consumers (operator.ts,
 * brain-domain.ts, ultron-ticker.ts, narrator.ts, /api/identity,
 * cross-system-nudge).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  update: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    brainMemory: {
      findUnique: (...args: unknown[]) => mocks.findUnique(...args),
      update: (...args: unknown[]) => mocks.update(...args),
    },
  },
}));

import {
  buildIdentityContextBlock,
  setManualOverride,
  type IdentityAxis,
  type IdentitySnapshot,
} from "@/lib/brain/identity-snapshot";
import { invalidate } from "@/lib/utils/cache";

/**
 * computed_at is deliberately NOW: buildIdentityContextBlock's only
 * time-varying term is the >7d staleNote, and a fresh snapshot keeps it
 * off so the rendered block is a pure function of the row.
 */
function makeSnapshot(velocityValue: number): IdentitySnapshot {
  const iso = new Date().toISOString();
  const axis = (value: number): IdentityAxis => ({
    value,
    manual: null,
    direction: "stable",
    evidence: [],
    updated_at: iso,
  });
  return {
    axes: {
      velocity: axis(velocityValue),
      patience_horizon: axis(50),
      promise_integrity: axis(50),
      dopamine_discipline: axis(50),
      business_vs_personal: axis(50),
      risk_appetite: axis(50),
      social_battery: axis(50),
      reflection_cadence: axis(50),
    },
    computed_at: iso,
    data_horizon_days: 30,
  };
}

// The persisted row, simulated: findUnique serves it and update replaces
// it, so a write is visible to the next read exactly as it is in Postgres.
let storedContent = "";

describe("loadIdentitySnapshot() read cache", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // L2 off — this pins L1 behavior, not Redis reachability.
    vi.stubEnv("REDIS_URL", "");
    // Literal mirrors IDENTITY_CACHE_KEY in lib/brain/identity-snapshot.ts.
    invalidate("identity_snapshot_current");
    storedContent = JSON.stringify(makeSnapshot(40));
    mocks.findUnique.mockImplementation(async () => ({ content: storedContent }));
    mocks.update.mockImplementation(async (args: { data: { content: string } }) => {
      storedContent = args.data.content;
      return { id: "identity-current" };
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("two turns read the row ONCE and render an identical block", async () => {
    const first = await buildIdentityContextBlock();
    expect(mocks.findUnique).toHaveBeenCalledTimes(1);

    const second = await buildIdentityContextBlock();
    // No second round-trip — this is the whole point of the change.
    expect(mocks.findUnique).toHaveBeenCalledTimes(1);

    expect(second).toBe(first);
    expect(first).toContain("- Velocity: 40/100");
  });

  it("setManualOverride() invalidates — the pin is visible on the NEXT read", async () => {
    const before = await buildIdentityContextBlock();
    expect(before).toContain("- Velocity: 40/100");
    const readsBeforePatch = mocks.findUnique.mock.calls.length;

    // The PATCH /api/identity path: loads (cache hit), writes, invalidates.
    await setManualOverride("velocity", 91);
    expect(mocks.update).toHaveBeenCalledTimes(1);

    const after = await buildIdentityContextBlock();

    // DID re-query. The invalidation is what makes this work — the
    // previous test proves the TTL alone would have served the old row.
    expect(mocks.findUnique.mock.calls.length).toBe(readsBeforePatch + 1);
    expect(after).toContain("- Velocity: 91/100 · (pinned)");
    expect(after).not.toContain("- Velocity: 40/100");
  });
});
