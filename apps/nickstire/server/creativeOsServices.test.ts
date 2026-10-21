/**
 * Creative OS services (Wave C): organic evidence, atomizer, pattern miner,
 * trend intel. Pure parts tested directly; DB/LLM parts through honest
 * failure shapes.
 *
 * POSITIVE CONTROLS recorded 2026-10-01: before these modules existed the ads
 * architect received no organic evidence at all (grep: zero readers of
 * social_content_inventory metrics outside Learn.tsx), there was no
 * thesis→derivative plan, no mined-pattern originality gate, no trend
 * classifier. Each `rejects` / `skip` case below is the behaviour the old
 * absence could not provide.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("./lib/db-helper", () => ({
  db: async () => { throw new Error("tidb unreachable (test)"); },
  dbTyped: async () => null,
  requireDb: async () => { throw new Error("tidb unreachable (test)"); },
}));

import { buildOrganicEvidence, rankOrganicRows, renderOrganicEvidenceBlock } from "./services/organicEvidence";

const row = (o: Partial<Parameters<typeof rankOrganicRows>[0][number]>) => ({
  id: 1, topic: "brakes", hookCategory: "customer_quote", hookText: "it only grinds in the morning", contentType: "reel", platform: "instagram",
  metricsReach: 1000, metricsShares: 20, metricsSaves: 10, metricsComments: 2, publishedAt: new Date("2026-09-20T12:00:00Z"), ...o,
});

describe("organicEvidence", () => {
  it("ranks by sends+saves per reach, excludes zero-reach rows from ratios, groups hook categories", () => {
    const ev = rankOrganicRows([
      row({ id: 1, metricsReach: 1000, metricsShares: 50, metricsSaves: 30 }),
      row({ id: 2, topic: "tires", hookCategory: "myth", metricsReach: 2000, metricsShares: 10, metricsSaves: 10 }),
      row({ id: 3, topic: "oil", hookCategory: "offer", metricsReach: 0, metricsShares: 0, metricsSaves: 0 }),
    ], { windowDays: 90, limit: 8 });
    expect(ev.sampled).toBe(3);
    expect(ev.measured).toBe(2);
    expect(ev.theses.map((t) => t.inventoryId)).toEqual([1, 2]);
    expect(ev.theses[0].sharesPerReach).toBe(0.05);
    expect(ev.winningHookCategories[0].hookCategory).toBe("customer_quote");
    expect(ev.topicsByFormat.find((t) => t.topic === "brakes")?.bestFormat).toBe("reel");
    const block = renderOrganicEvidenceBlock(ev);
    expect(block).toMatch(/NOT ad-conversion evidence/);
    expect(block).toContain("it only grinds in the morning");
  });
  it("a DB failure is reported as unavailable — never an empty 'nothing worked'", async () => {
    const ev = await buildOrganicEvidence();
    expect(ev.error).toMatch(/tidb unreachable/);
    expect(renderOrganicEvidenceBlock(ev)).toMatch(/unavailable/);
    expect(renderOrganicEvidenceBlock({ ...ev, error: undefined, sampled: 4, measured: 0 })).toMatch(/none with reach yet/);
  });
});

