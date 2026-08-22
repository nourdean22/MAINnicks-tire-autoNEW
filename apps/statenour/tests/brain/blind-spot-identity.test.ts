/**
 * Blind-spot identity + recurrence policy · lib/brain/blind-spot-identity.ts
 * (2026-08-22).
 *
 * THE CANARY THIS FILE EXISTS FOR. The old cron keyed every write
 * `blindspot_${domain}_${Date.now()}`, so `remember()` — which upserts on
 * (category, key) — inserted a fresh row every night and the operator's
 * verdict had nothing to attach to. Prod receipt: 3 of 3 verdicts given
 * 2026-08-21 were regenerated as unjudged rows on 08-22.
 *
 * Per the repo's "ship the canary, not just the control" rule, idempotence is
 * PROVEN here rather than asserted: `runs the generator twice` drives two full
 * persist passes over an unchanged spot against a fake store and asserts the
 * second pass creates zero rows — and the accompanying negative test drives
 * the OLD timestamp key through the same store to show it produces two,
 * so a regression that reinstates a clock in the key cannot score green.
 *
 * SCOPE OF THE FAKE. memory-manager is mocked here, so nothing in this file
 * proves anything about the REAL reinforce(). The property the whole design
 * rests on — that reinforce() never writes `metadata` — is pinned against the
 * actual function in tests/brain/reinforce-metadata-canary.test.ts. Adversarial
 * review caught this file restating its own assumption.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  brainMemory: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  remember: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ prisma: { brainMemory: mocks.brainMemory } }));
vi.mock("@/lib/brain/memory-manager", () => ({
  brainMemory: { remember: mocks.remember },
}));

import type { BlindSpot } from "@/lib/brain/blind-spot-detector";
import {
  SEVERITY_RANK,
  blindSpotIdentity,
  blindSpotKey,
  blindSpotContent,
  shouldResurface,
  persistBlindSpot,
} from "@/lib/brain/blind-spot-identity";

const spot = (over: Partial<BlindSpot> = {}): BlindSpot => ({
  domain: "personal",
  description: 'Open loop untouched: "Research and compile the latest hacks"',
  severity: "high",
  evidence: "Last updated 51 days ago. Still marked as open.",
  daysSinceAttention: 51,
  suggestedAction: "Close, delegate, or schedule",
  ...over,
});

/**
 * A minimal stand-in for the (category, key) unique. `remember()` upserts on
 * it, so modelling exactly that is what makes the idempotence claim real
 * rather than a mock-call count.
 */
type Row = {
  id: string;
  key: string;
  metadata: Record<string, unknown>;
  deletedAt: Date | null;
  lastSeen: Date;
  expiresAt: Date | null;
};

/**
 * A stand-in for brain_memories that models the four behaviours this fix
 * actually depends on, rather than an idealised upsert:
 *
 *  · the (category, key) unique that remember() branches on;
 *  · reinforce() writing lastSeen but NEVER metadata;
 *  · the commit gateway's `noop` path, which returns the row COMPLETELY
 *    untouched when content is byte-identical from the same source;
 *  · the 24h probationary expiresAt and the soft-delete that sweeps it.
 *
 * The earlier version of this fake was an unconditional Map upsert with no TTL,
 * no gateway and no tombstone — it asserted a property that was true in the
 * fake and false in prod, which adversarial review caught.
 */
function fakeStore(opts: { gatewayNoop?: boolean } = {}) {
  const rows = new Map<string, Row>();
  const contentByKey = new Map<string, string>();
  let creates = 0;
  let reinforces = 0;
  let noops = 0;

  mocks.brainMemory.findUnique.mockImplementation(
    async ({ where }: { where: { category_key?: { key: string }; id?: string } }) => {
      if (where.category_key) return rows.get(where.category_key.key) ?? null;
      return [...rows.values()].find((r) => r.id === where.id) ?? null;
    },
  );

  mocks.remember.mockImplementation(
    async (
      _cat: string,
      key: string,
      content: string,
      _src: string,
      meta: Record<string, unknown>,
    ) => {
      const existing = rows.get(key);
      if (existing) {
        // Gateway: same source + byte-identical content => noop, returns the
        // row without touching ANYTHING (memory-manager.ts:401).
        if (opts.gatewayNoop || contentByKey.get(key) === content) {
          noops++;
          return existing;
        }
        // Gateway "update" => reinforce(id, content, { bumpConfidence: false }).
        // Moves lastSeen and content. Does NOT touch metadata, does NOT
        // increment seenCount, does NOT clear expiresAt.
        reinforces++;
        existing.lastSeen = new Date();
        contentByKey.set(key, content);
        return existing;
      }
      creates++;
      const row: Row = {
        id: `mem-${creates}`,
        key,
        metadata: { ...meta },
        deletedAt: null,
        lastSeen: new Date(),
        // The 24h probation the create arm stamps (memory-manager.ts:501).
        expiresAt: new Date(Date.now() + 86_400_000),
      };
      rows.set(key, row);
      contentByKey.set(key, content);
      return row;
    },
  );

  mocks.brainMemory.update.mockImplementation(
    async ({
      where,
      data,
    }: {
      where: { id: string };
      data: Record<string, unknown>;
    }) => {
      const row = [...rows.values()].find((r) => r.id === where.id);
      if (!row) return {};
      if ("metadata" in data) row.metadata = { ...(data.metadata as Record<string, unknown>) };
      if ("expiresAt" in data) row.expiresAt = data.expiresAt as Date | null;
      if ("deletedAt" in data) row.deletedAt = data.deletedAt as Date | null;
      if ("lastSeen" in data) row.lastSeen = data.lastSeen as Date;
      return {};
    },
  );

  return {
    rows,
    /** The nightly TTL sweep: pruneNoise soft-deletes anything past expiry. */
    runPruneNoise(now = new Date()) {
      let swept = 0;
      for (const r of rows.values()) {
        if (r.deletedAt === null && r.expiresAt !== null && r.expiresAt < now) {
          r.deletedAt = new Date();
          swept++;
        }
      }
      return swept;
    },
    get creates() {
      return creates;
    },
    get reinforces() {
      return reinforces;
    },
    get noops() {
      return noops;
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("blindSpotKey — identity, not discovery time", () => {
  it("contains no timestamp: the same spot keys identically across runs", () => {
    const a = blindSpotKey(spot());
    const b = blindSpotKey(spot());
    expect(a).toBe(b);
    // The exact defect: a clock anywhere in the key. Date.now() is 13 digits.
    expect(a).not.toMatch(/\d{13}/);
  });

  it("normalises the leading counts the two live detector templates embed", () => {
    // `${pendingDecisions} decisions awaiting review` moves 9 -> 10 overnight.
    // Un-normalised, that mints a new key on the day the number changes.
    const nine = spot({ description: "9 decisions awaiting review", domain: "general" });
    const ten = spot({ description: "10 decisions awaiting review", domain: "general" });
    expect(blindSpotKey(nine)).toBe(blindSpotKey(ten));
  });

  it("does NOT merge genuinely different spots", () => {
    expect(blindSpotKey(spot({ description: 'Open loop untouched: "A"' }))).not.toBe(
      blindSpotKey(spot({ description: 'Open loop untouched: "B"' })),
    );
  });

  it("scopes by domain and frame so lookalike phrasings cannot collide", () => {
    expect(blindSpotKey(spot({ domain: "revenue" }))).not.toBe(
      blindSpotKey(spot({ domain: "body" })),
    );
    expect(blindSpotIdentity(spot({ frame: "inversion" }))).not.toBe(
      blindSpotIdentity(spot({ frame: "constraint" })),
    );
  });

  it("keys on identity only — severity and evidence change nightly and must not shift it", () => {
    expect(blindSpotKey(spot({ severity: "critical", evidence: "Last updated 52 days ago" }))).toBe(
      blindSpotKey(spot({ severity: "high", evidence: "Last updated 51 days ago" })),
    );
  });
});

describe("CANARY · idempotence is proven, not asserted", () => {
  it("runs the generator twice A DAY APART and creates ZERO new rows", async () => {
    // THE CLOCK ADVANCE IS THE WHOLE TEST. Written without it, both calls land
    // in the same millisecond, so even the old `Date.now()` key produced one
    // row and this canary passed against the very defect it exists to catch —
    // observed, not hypothesised, while breaking the gate on 2026-08-22. The
    // real failure only appears across a nightly boundary, so the test has to
    // cross one.
    const store = fakeStore();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-21T07:02:00Z"));

    await persistBlindSpot(spot());
    const afterFirst = store.rows.size;

    vi.setSystemTime(new Date("2026-08-22T07:01:00Z"));
    const second = await persistBlindSpot(spot());
    vi.useRealTimers();

    expect(afterFirst).toBe(1);
    expect(store.rows.size).toBe(1);
    expect(store.creates).toBe(1);
    expect(second.action).toBe("reinforced");
    // Byte-identical content from the same source is a gateway NOOP, not a
    // reinforce — remember() returns the row untouched. Reported, because the
    // reconciling write is then the ONLY thing keeping the row current.
    expect(store.noops).toBe(1);
    expect(second.noop).toBe(true);
  });

  it("BREAKS the gate: the OLD Date.now() key produces two rows over the same boundary", async () => {
    // Without this arm the test above would pass against a store that simply
    // never creates anything. Same store, same spot, same 24h gap — only the
    // key scheme differs, so a green here would mean the harness is blind.
    const store = fakeStore();
    const legacyKey = (s: BlindSpot) => `blindspot_${s.domain}_${Date.now()}`;
    vi.useFakeTimers();

    vi.setSystemTime(new Date("2026-08-21T07:02:00Z"));
    await mocks.remember("blind_spot", legacyKey(spot()), "x", "y", {});
    vi.setSystemTime(new Date("2026-08-22T07:01:00Z"));
    await mocks.remember("blind_spot", legacyKey(spot()), "x", "y", {});
    vi.useRealTimers();

    expect(store.creates).toBe(2);
    expect(store.rows.size).toBe(2);
  });

  it("survives a re-sighting with the operator verdict INTACT", async () => {
    const store = fakeStore();
    await persistBlindSpot(spot());
    const key = blindSpotKey(spot());

    // Operator taps "Noise" — rateDiscovery writes metadata on the row.
    const row = store.rows.get(key)!;
    row.metadata.discoveryVerdict = "noise";
    row.metadata.discoveryVerdictSeverityRank = SEVERITY_RANK.high;

    // Next night's run, same spot, same severity.
    await persistBlindSpot(spot());

    expect(store.rows.get(key)!.metadata.discoveryVerdict).toBe("noise");
  });
});

/**
 * The TTL chain, found in adversarial review AFTER the key fix was written and
 * confirmed against prod. A stable key alone is NOT sufficient — it is worse
 * than the original bug, because a tombstoned row keeps occupying the unique
 * key and the spot can never surface again.
 */
describe("CANARY · the row must outlive the 24h probation", () => {
  it("drops the probationary expiry on the SECOND sighting", async () => {
    const store = fakeStore();
    const key = blindSpotKey(spot());

    await persistBlindSpot(spot());
    // Create arm stamps a 24h TTL that the commit gateway can never clear:
    // neither the noop nor the update path increments seenCount, so
    // reinforce()'s `seenCount >= 3` promotion is unreachable.
    expect(store.rows.get(key)!.expiresAt).not.toBeNull();

    await persistBlindSpot(spot());
    expect(store.rows.get(key)!.expiresAt).toBeNull();
  });

  it("BREAKS the gate: without the reconciling write, pruneNoise tombstones the spot", async () => {
    // Proves the sweep is real and reaches these rows — otherwise the test
    // above passes against a store that never expires anything.
    const store = fakeStore();
    await persistBlindSpot(spot());
    const swept = store.runPruneNoise(new Date(Date.now() + 2 * 86_400_000));
    expect(swept).toBe(1);
  });

  it("REVIVES a tombstoned row instead of burning its key forever", async () => {
    // The severe case: findUnique on (category,key) does not filter deletedAt,
    // so a swept row still answers as `existing`. Without revival the create
    // arm is never taken again and the spot is invisible permanently.
    const store = fakeStore();
    await persistBlindSpot(spot());
    const key = blindSpotKey(spot());
    store.runPruneNoise(new Date(Date.now() + 2 * 86_400_000));
    expect(store.rows.get(key)!.deletedAt).not.toBeNull();

    const res = await persistBlindSpot(spot());

    expect(res.revived).toBe(true);
    expect(store.rows.get(key)!.deletedAt).toBeNull();
    expect(store.rows.get(key)!.expiresAt).toBeNull();
    expect(store.rows.size).toBe(1);
  });

  it("refreshes lastSeen even when the gateway refuses the write", async () => {
    // The gateway noop path returns without touching lastSeen. Left alone, a
    // still-current spot ages out of the feed's 30-day recency window while
    // being re-detected every single night.
    const store = fakeStore({ gatewayNoop: true });
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-21T07:00:00Z"));
    await persistBlindSpot(spot());
    const key = blindSpotKey(spot());

    vi.setSystemTime(new Date("2026-09-30T07:00:00Z"));
    const res = await persistBlindSpot(spot());
    vi.useRealTimers();

    expect(res.noop).toBe(true);
    expect(store.rows.get(key)!.lastSeen.toISOString()).toBe("2026-09-30T07:00:00.000Z");
  });
});

describe("recurrence policy — suppress by default, resurface only on escalation", () => {
  it("keeps a noise verdict standing while severity is unchanged", () => {
    expect(shouldResurface("noise", SEVERITY_RANK.high, "high")).toBe(false);
  });

  it("keeps it standing when severity DROPS", () => {
    expect(shouldResurface("noise", SEVERITY_RANK.critical, "high")).toBe(false);
  });

  it("resurfaces when severity escalates above the tier judged", () => {
    expect(shouldResurface("noise", SEVERITY_RANK.high, "critical")).toBe(true);
  });

  it("never resurfaces `known` — escalation does not make a known thing novel", () => {
    expect(shouldResurface("known", SEVERITY_RANK.low, "critical")).toBe(false);
  });

  it("never resurfaces `investigate` — the spawned task is the tracker", () => {
    expect(shouldResurface("investigate", SEVERITY_RANK.low, "critical")).toBe(false);
  });

  it("does nothing for an unjudged row", () => {
    expect(shouldResurface(null, null, "critical")).toBe(false);
  });

  it("clears the verdict on escalation and APPENDS the history the card needs", async () => {
    const store = fakeStore();
    await persistBlindSpot(spot({ severity: "high" }));
    const key = blindSpotKey(spot());
    const row = store.rows.get(key)!;
    row.metadata.discoveryVerdict = "noise";
    row.metadata.discoveryVerdictSeverityRank = SEVERITY_RANK.high;
    row.metadata.discoveryRatedAt = "2026-08-21T07:37:46.624Z";

    const res = await persistBlindSpot(spot({ severity: "critical" }));

    expect(res.resurfaced).toBe(true);
    const after = store.rows.get(key)!.metadata;
    expect(after.discoveryVerdict).toBeNull();
    expect(after.discoveryResurfacedFromRank).toBe(SEVERITY_RANK.high);
    expect(after.discoveryResurfacedToRank).toBe(SEVERITY_RANK.critical);
    // Without the history the resurface is indistinguishable from a repeat
    // alert — Ancker's 87.9% repeat-override is what that earns.
    expect(after.discoveryVerdictHistory).toEqual([
      { verdict: "noise", at: "2026-08-21T07:37:46.624Z", severityRank: SEVERITY_RANK.high },
    ]);
  });

  it("bounds resurfaces: history accumulates across repeated escalations", async () => {
    const store = fakeStore();
    await persistBlindSpot(spot({ severity: "low" }));
    const key = blindSpotKey(spot());
    const row = store.rows.get(key)!;

    for (const [judged, next] of [
      ["low", "medium"],
      ["medium", "high"],
      ["high", "critical"],
    ] as const) {
      row.metadata.discoveryVerdict = "noise";
      row.metadata.discoveryVerdictSeverityRank = SEVERITY_RANK[judged];
      row.metadata.discoveryRatedAt = `2026-08-2${SEVERITY_RANK[judged]}T00:00:00.000Z`;
      await persistBlindSpot(spot({ severity: next }));
    }

    // Four tiers means at most three escalations in a spot's entire life —
    // that bound is the reason the policy is escalation-based and not
    // time-based. A 30-day re-ask would be unbounded.
    expect((store.rows.get(key)!.metadata.discoveryVerdictHistory as unknown[]).length).toBe(3);
  });
});

describe("blindSpotContent", () => {
  it("matches the format the cron used to inline, so stored cards do not change shape", () => {
    expect(blindSpotContent(spot({ severity: "high" }))).toBe(
      '[HIGH] Open loop untouched: "Research and compile the latest hacks": ' +
        "Last updated 51 days ago. Still marked as open.. Action: Close, delegate, or schedule",
    );
  });
});

/**
 * The over-merge canary. The first version of blindSpotIdentity() collapsed
 * EVERY digit run, which merged distinct operator-authored tasks — silent data
 * loss, since one "Noise" tap suppresses every row behind a card. Caught in
 * adversarial review before ship.
 */
describe("CANARY · digit normalisation must not merge distinct operator text", () => {
  it("keeps two tasks apart when they differ only by an embedded number", () => {
    const a = spot({ description: 'Open loop untouched: "Order 4 winter tires"' });
    const b = spot({ description: 'Open loop untouched: "Order 6 winter tires"' });
    expect(blindSpotKey(a)).not.toBe(blindSpotKey(b));
  });

  it("keeps two commitments apart the same way", () => {
    const a = spot({ description: 'Commitment overdue: "Pay invoice 2841"' });
    const b = spot({ description: 'Commitment overdue: "Pay invoice 3190"' });
    expect(blindSpotKey(a)).not.toBe(blindSpotKey(b));
  });

  it("still stabilises the LEADING counts that motivated normalising at all", () => {
    // blind-spot-detector.ts:264 and :276 — the two templates that genuinely
    // open with a moving count.
    expect(blindSpotKey(spot({ description: "9 decisions awaiting review" }))).toBe(
      blindSpotKey(spot({ description: "11 decisions awaiting review" })),
    );
    expect(
      blindSpotKey(spot({ description: "3 unresolved drift alerts accumulating" })),
    ).toBe(blindSpotKey(spot({ description: "7 unresolved drift alerts accumulating" })));
  });
});
