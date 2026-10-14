/**
 * A failed Search Console fetch is not an empty one (branch statenour/memory-gsc-approvals-dump).
 *
 * THE DEFECT: a non-2xx from GSC returned gsc: [], and runIngestion stored "No search data
 * available." as a source document and reported success. A failed read must report failure
 * with the status code, and must store nothing.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/services/google-oauth", () => ({
  isGoogleOauthConfigured: async () => true,
  getAccessToken: async () => "test-token",
}));
vi.mock("@/lib/logger", () => ({
  logger: { withSurface: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) },
}));
const state = vi.hoisted(() => ({ documentCreates: [] as unknown[] }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    registeredSource: {
      findUnique: async () => ({ id: "src_1", name: "Search Console", domain: "seo", url: "https://bdnick.info/" }),
      update: async () => ({}),
    },
    sourceDocument: {
      create: async (args: unknown) => {
        state.documentCreates.push(args);
        return { id: "doc_1" };
      },
    },
    intelligenceClaim: { create: async () => ({ id: "claim_1" }) },
  },
}));
vi.mock("@/lib/intelligence/extraction", () => ({ extractClaimsFromText: async () => [] }));
vi.mock("@/lib/intelligence/grounding", () => ({ groundClaim: async () => ({}) }));
vi.mock("@/lib/intelligence/promote", () => ({ promoteIntelligenceClaims: async () => ({ promoted: 0, examined: 0 }) }));
vi.mock("@/lib/integrations/firecrawl", () => ({ scrapeUrl: async () => ({}), isFirecrawlConfigured: () => false }));
vi.mock("@/lib/intelligence/connectors/nhtsa", () => ({ fetchNHTSARecalls: async () => [] }));
vi.mock("@/lib/intelligence/connectors/sec", () => ({
  fetchCompetitorAndSECData: async () => ({ filings: [], prices: [] }),
}));
vi.mock("@/lib/intelligence/connectors/supplychain", () => ({ fetchSupplyChainMetrics: async () => ({}) }));
vi.mock("@/lib/intelligence/connectors/dealscouting", () => ({ fetchListedDeals: async () => [] }));
vi.mock("@/lib/intelligence/connectors/performance", () => ({ fetchBioPerformanceMetrics: async () => ({}) }));

import { fetchGSCAndGBPMetrics } from "@/lib/intelligence/connectors/gsc";
import { runIngestion } from "@/lib/intelligence/ingest";

beforeEach(() => {
  state.documentCreates.length = 0;
  vi.stubGlobal("fetch", vi.fn(async () => new Response("forbidden", { status: 403 })));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchGSCAndGBPMetrics - failed fetch", () => {
  it("a 403 is reported as an error with its status, not as an empty result", async () => {
    const out = await fetchGSCAndGBPMetrics();
    expect(out.gsc).toEqual([]);
    expect(out.error).toMatch(/403/);
  });
});

describe("runIngestion - seo source with a failed fetch", () => {
  it("a 403 fails the ingest and stores no 'no search data' document", async () => {
    const result = await runIngestion("src_1");
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/403/);
    expect(state.documentCreates).toEqual([]);
  });
});
