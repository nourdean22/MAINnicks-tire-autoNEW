/**
 * Local Discovery library (ScanFinish NT-014) + its wiring into the topic
 * miner. Two properties matter most: (1) e_check topics still route through
 * the government-evidence-gated franchise — this library must not become a
 * back door around the NHTSA/Ohio-EPA fetch-blocked rule; (2) tire_symptom
 * and weather_road topics are auto-renderable, since they carry no
 * government-source claim.
 */
import { describe, it, expect } from "vitest";
import { LOCAL_DISCOVERY_LIBRARY, localDiscoveryTopics, categoryForTopic } from "../../../shared/localDiscoveryLibrary";
import { mineTopicCandidates, autoRenderable } from "../../../shared/contentTopicMiner";

describe("LOCAL_DISCOVERY_LIBRARY", () => {
  it("covers all three categories the brief asked for", () => {
    const categories = new Set(LOCAL_DISCOVERY_LIBRARY.map((e) => e.category));
    expect(categories).toEqual(new Set(["tire_symptom", "e_check", "weather_road"]));
  });

  it("every entry has a unique id and a non-empty topic", () => {
    const ids = LOCAL_DISCOVERY_LIBRARY.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const e of LOCAL_DISCOVERY_LIBRARY) expect(e.topic.trim().length).toBeGreaterThan(0);
  });

  it("categoryForTopic resolves a real entry and returns null for an unknown string", () => {
    expect(categoryForTopic(LOCAL_DISCOVERY_LIBRARY[0].topic)).toBe(LOCAL_DISCOVERY_LIBRARY[0].category);
    expect(categoryForTopic("not in the library")).toBeNull();
  });

  it("localDiscoveryTopics excludes topics already covered recently", () => {
    const some = LOCAL_DISCOVERY_LIBRARY[0].topic;
    expect(localDiscoveryTopics([some])).not.toContain(some);
    expect(localDiscoveryTopics([])).toContain(some);
  });
});

describe("local_discovery source wired into the miner", () => {
  it("tire_symptom/weather_road topics are auto-renderable — no government evidence required", () => {
    const nonEcheck = LOCAL_DISCOVERY_LIBRARY.filter((e) => e.category !== "e_check").map((e) => e.topic);
    const candidates = mineTopicCandidates({ localDiscoveryTopics: nonEcheck });
    expect(candidates.length).toBeGreaterThan(0);
    for (const c of candidates) {
      expect(c.source).toBe("local_discovery");
      expect(c.blockedReason).toBeUndefined();
    }
    expect(autoRenderable(candidates).length).toBe(candidates.length);
  });

  it("e_check topics fed via governmentFeedTopics are surfaced but NOT auto-renderable — the previously-dead government_feed source, now wired", () => {
    const echeck = LOCAL_DISCOVERY_LIBRARY.filter((e) => e.category === "e_check").map((e) => e.topic);
    const candidates = mineTopicCandidates({ governmentFeedTopics: echeck });
    expect(candidates.length).toBeGreaterThan(0);
    for (const c of candidates) {
      expect(c.source).toBe("government_feed");
      expect(c.blockedReason).toMatch(/NHTSA|government/i);
    }
    expect(autoRenderable(candidates)).toHaveLength(0);
  });

  it("local_discovery scores below coverage_gap — a curated fallback, not a read of the business", () => {
    const c = mineTopicCandidates({
      localDiscoveryTopics: ["why lake-effect snow needs stronger wipers"],
      underCoveredServices: ["exhaust work"],
    });
    const local = c.find((x) => x.source === "local_discovery");
    const gap = c.find((x) => x.source === "coverage_gap");
    expect(gap!.score).toBeGreaterThan(local!.score);
  });
});
