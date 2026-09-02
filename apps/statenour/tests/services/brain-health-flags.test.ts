/**
 * tests/services/brain-health-flags.test.ts
 * 2026-09-02 · the /brain?tab=health flag panel, narrowed — and proven awake.
 *
 * WHAT WAS WRONG. computeHealthFlags flagged any category with >5 rows and no
 * embeddings, skipping only `alert_pushed`. But lib/brain/embedding-policy.ts
 * TELEMETRY_CATEGORIES is a deliberate denylist — those rows are event logs,
 * and the backfill cron and drain script both exclude them, because embedding
 * a log line puts it in the same space as reasoning where it competes for a
 * finite number of recall slots.
 *
 * On prod that produced NINE red `no_vectors` flags, every one a category
 * faulted for lacking exactly what policy forbids it to have. `all_decayed`
 * was the same error wearing a different coat: all 1,056 memory_gateway_shadow
 * rows sit at confidence 0.1 because memory-commit-gateway.ts WRITES them at
 * 0.1 (min = max = 0.1, measured), so nothing decayed — they were born below
 * the 0.2 threshold the flag calls decay.
 *
 * Ten of eleven flags were noise.
 *
 * WHY THIS FILE IS MOSTLY ABOUT THE ALARM STILL FIRING. The cheapest way to
 * fix a noisy alarm is to silence it, and that would be far worse than the
 * noise: this check guards the defect that once left 83.5% of the brain
 * unreachable by recall (see tests/cron/embed-backfill-bounded.test.ts). So
 * every narrowing below is paired with a case proving the alarm still goes off
 * for the thing it was built to catch.
 */
import { describe, expect, it } from "vitest";
import { computeHealthFlags } from "@/lib/services/brain-health";
import { TELEMETRY_CATEGORIES } from "@/lib/brain/embedding-policy";

type Cat = Parameters<typeof computeHealthFlags>[0][number];

/** A healthy knowledge category; override one field per case. */
function cat(over: Partial<Cat> & { category: string }): Cat {
  return {
    category: over.category,
    count: 100,
    permanent: 0,
    decayed: 0,
    vectorized: 100,
    vectorizedPct: 100,
    avgConfidence: 0.9,
    avgSeen: 2,
    telemetry: false,
    newest: new Date().toISOString(),
    oldest: new Date().toISOString(),
    ageNewestHours: 1,
    ...over,
  } as Cat;
}

const flagsFor = (c: Cat) => computeHealthFlags([c]).map((f) => f.flag);

describe("computeHealthFlags · the alarm still fires for what it was built to catch", () => {
  it("FIRES no_vectors on a KNOWLEDGE category with no embeddings", () => {
    // The 83.5%-unreachable defect, in one row. If this ever stops firing the
    // panel is decorative and the narrowing below has gone too far.
    expect(flagsFor(cat({ category: "identity_snapshot", vectorized: 0 }))).toContain("no_vectors");
  });

  it("FIRES all_decayed on a KNOWLEDGE category where every row decayed", () => {
    expect(flagsFor(cat({ category: "strategic_law", decayed: 100 }))).toContain("all_decayed");
  });

  it("FIRES dormant_30d, and does so for TELEMETRY too", () => {
    // Deliberately NOT narrowed: a log category that stopped being written
    // means a writer died, which is real signal whatever the rows hold.
    const stale = { ageNewestHours: 24 * 45 };
    expect(flagsFor(cat({ category: "wisdom", ...stale }))).toContain("dormant_30d");
    expect(flagsFor(cat({ category: "friction", telemetry: true, vectorized: 0, ...stale }))).toContain(
      "dormant_30d",
    );
  });
});

describe("computeHealthFlags · telemetry is not unhealthy", () => {
  it("does NOT flag no_vectors on a telemetry category", () => {
    expect(flagsFor(cat({ category: "mastery_xp_event", telemetry: true, vectorized: 0 }))).toEqual([]);
  });

  it("does NOT flag all_decayed on telemetry written below the threshold", () => {
    // memory_gateway_shadow, exactly as prod holds it: 1,056 rows, all at 0.1.
    const shadow = cat({
      category: "memory_gateway_shadow",
      telemetry: true,
      count: 1056,
      decayed: 1056,
      vectorized: 0,
      avgConfidence: 0.1,
    });
    expect(flagsFor(shadow)).toEqual([]);
  });

  it("REGRESSION · the nine categories flagged on prod are all silent now", () => {
    // The exact live population from /brain?tab=health on 2026-09-02, with the
    // row counts read from the production database.
    const prod: Array<[string, number]> = [
      ["mastery_xp_event", 1988], ["memory_gateway_shadow", 1056], ["nick_quality", 695],
      ["persona_drift", 553], ["reply_quality", 119], ["friction", 103],
      ["objection_injection_log", 86], ["brain_dump_event", 64], ["goal_lift", 41],
    ];
    const cats = prod.map(([category, count]) =>
      cat({ category, count, telemetry: true, vectorized: 0, vectorizedPct: 0 }),
    );
    expect(computeHealthFlags(cats)).toEqual([]);
  });

  it("every category in the denylist is one this function will not fault", () => {
    // Ties the narrowing to embedding-policy rather than to a list retyped
    // here — if a category is added there, it is covered here automatically.
    for (const category of TELEMETRY_CATEGORIES) {
      const c = cat({ category, telemetry: true, vectorized: 0, count: 50, decayed: 50 });
      expect(flagsFor(c), `${category} should not be faulted`).toEqual([]);
    }
    expect(TELEMETRY_CATEGORIES.length).toBeGreaterThan(5); // the list is real
  });
});

describe("computeHealthFlags · unchanged behaviour", () => {
  it("still ignores categories at or below 5 rows", () => {
    expect(flagsFor(cat({ category: "tiny", count: 5, vectorized: 0 }))).toEqual([]);
    expect(flagsFor(cat({ category: "just_over", count: 6, vectorized: 0 }))).toContain("no_vectors");
  });

  it("still skips alert_pushed, which is a dedup marker not knowledge", () => {
    expect(flagsFor(cat({ category: "alert_pushed", vectorized: 0 }))).toEqual([]);
  });

  it("tolerates a category with no rows dated", () => {
    expect(() => flagsFor(cat({ category: "undated", ageNewestHours: null }))).not.toThrow();
  });
});
