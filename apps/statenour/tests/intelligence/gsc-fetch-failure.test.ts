/**
 * A failed Search Console read is not an empty one (branch statenour/memory-gsc-approvals-dump).
 *
 * THE DEFECT: a non-2xx from GSC returned gsc: [], and runIngestion stored "No search data
 * available." as a source document and reported success. A probe that could not read the
 * integration table and a Google account that is not connected were both read the same way. A
 * failed read must report failure with its reason and store nothing. "Not connected" is an
 * explicit skip that stores nothing.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

type Probe = { configured: boolean; probeFailed: boolean; reason: string };

const oauth = vi.hoisted(() => ({
  probe: { configured: true, probeFailed: false, reason: "" } as Probe,
}));

vi.mock("@/lib/services/google-oauth", () => ({
  // Mirrors the real module: the probe never throws. A DB failure is probeFailed, and the boolean
  // wrapper reads it as configured: false, which is exactly why the caller must read the probe.
  probeGoogleOauthConfigured: async () => oauth.probe,
  isGoogleOauthConfigured: async () => oauth.probe.configured,
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

const UNREADABLE = "Integration table unreadable — check DB connectivity, NOT the Google grant";
const NOT_GRANTED = "Google OAuth not configured — grant access at /api/oauth/google-data/start";

beforeEach(() => {
  state.documentCreates.length = 0;
  oauth.probe = { configured: true, probeFailed: false, reason: "" };
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

  it("a fetch that throws an empty-message error still reports a non-empty error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error(""); }));
    const out = await fetchGSCAndGBPMetrics();
    expect(out.gsc).toEqual([]);
    expect(out.error).toBeTruthy();
  });
});

describe("fetchGSCAndGBPMetrics - probe and connection state", () => {
  it("a probe that cannot read the integration table is an error carrying its reason, not 'not connected'", async () => {
    oauth.probe = { configured: false, probeFailed: true, reason: UNREADABLE };
    const out = await fetchGSCAndGBPMetrics();
    expect(out.gsc).toEqual([]);
    expect(out.error).toBe(UNREADABLE);
    expect(out.notConnected).toBeUndefined();
  });

  it("not configured is an explicit not-connected result, not an error", async () => {
    oauth.probe = { configured: false, probeFailed: false, reason: NOT_GRANTED };
    const out = await fetchGSCAndGBPMetrics();
    expect(out.notConnected).toBe(true);
    expect(out.error).toBeUndefined();
  });
});

describe("runIngestion - seo source with a failed fetch", () => {
  it("a 403 fails the ingest and stores no 'no search data' document", async () => {
    const result = await runIngestion("src_1");
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/403/);
    expect(state.documentCreates).toEqual([]);
  });

  it("a fetch that throws an empty-message error fails the ingest and stores nothing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error(""); }));
    const result = await runIngestion("src_1");
    expect(result.success).toBe(false);
    expect(state.documentCreates).toEqual([]);
  });

  it("a probe that cannot read the integration table fails the ingest with its reason and stores nothing", async () => {
    oauth.probe = { configured: false, probeFailed: true, reason: UNREADABLE };
    const result = await runIngestion("src_1");
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/Integration table unreadable/);
    expect(state.documentCreates).toEqual([]);
  });

  it("not connected skips the ingest and stores no 'no search data' document", async () => {
    oauth.probe = { configured: false, probeFailed: false, reason: NOT_GRANTED };
    const result = await runIngestion("src_1");
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/not connected/);
    expect(state.documentCreates).toEqual([]);
  });
});
