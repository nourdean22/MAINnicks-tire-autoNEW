/**
 * The digest's healthy count must come from probes that RAN, and a scan that
 * produced nothing must surface as UNMEASURED — never as healthy.
 *
 * What shipped before (verified by direct read 2026-08-04, registered in the
 * false-green sweep memory): `healthy: 6 - criticalCount - warningCount`,
 * where 6 was wrong (the Promise.all has FIVE scans), the subtrahends counted
 * HIGHLIGHTS (up to 8 reachable, so healthy could render as -2), and a scan
 * whose .catch fired contributed nothing — tallying a crashed probe as clean.
 * countSlowRoutes24h additionally converted a circuit-open read into a
 * measured 0 via its fallback.
 *
 * Split pins, per the producer lesson in this repo: summarizeProbes (pure) is
 * pinned directly, AND computeHealthDigest is pinned end-to-end with all five
 * scans mocked — a pure function nothing calls is a fix nothing guards.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  scanCronHealth: vi.fn(),
  scanStaleData: vi.fn(),
  getGoogleOauthStatus: vi.fn(),
  safeQuery: vi.fn(),
}));

vi.mock("@/lib/system/cron-diagnostics", () => ({ scanCronHealth: mocks.scanCronHealth }));
vi.mock("@/lib/system/stale-data-scanner", () => ({ scanStaleData: mocks.scanStaleData }));
vi.mock("@/lib/services/google-oauth", () => ({ getGoogleOauthStatus: mocks.getGoogleOauthStatus }));
vi.mock("@/lib/services/deploy-identity", () => ({
  getDeployMeta: () => ({ sha: null, shaShort: null, branch: null, env: null, buildTime: null }),
}));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/db/safe-prisma", () => ({ safeQuery: mocks.safeQuery }));

import {
  computeHealthDigest,
  summarizeProbes,
  type ProbeReading,
} from "@/lib/system/health-digest";

/** Rows the slow-routes query resolves with; null = circuit open / threw. */
let slowRoutesRows: Array<{ c: bigint }> | null = [{ c: BigInt(0) }];

function healthyCron() {
  return {
    diagnoses: [],
    summary: {
      declaredActiveCrons: 10,
      silentDeclaredCrons: 0,
      killedIndividually: 0,
      totalLogRowsLast48h: 500,
    },
  };
}

function healthyGoogle() {
  return {
    state: "healthy" as const,
    lastSyncAt: "2026-08-04T00:00:00.000Z",
    consecutiveFailures: 0,
    email: "nour@example.com",
    reason: "",
  };
}

beforeEach(() => {
  slowRoutesRows = [{ c: BigInt(0) }];
  mocks.scanCronHealth.mockResolvedValue(healthyCron());
  mocks.scanStaleData.mockResolvedValue({ totalStaleRows: 0, categories: [] });
  mocks.getGoogleOauthStatus.mockResolvedValue(healthyGoogle());
  mocks.safeQuery.mockImplementation(
    async (_fn: unknown, fallback: unknown, opts?: { label?: string }) =>
      opts?.label === "health-digest.slow-routes" ? slowRoutesRows : fallback,
  );
  // env readiness reads process.env directly — pin all four groups configured
  // so the env probe is deterministic regardless of the shell running this.
  vi.stubEnv("VAPID_PUBLIC_KEY", "test");
  vi.stubEnv("VAPID_PRIVATE_KEY", "test");
  vi.stubEnv("GEMINI_API_KEY", "test");
  vi.stubEnv("CRON_SECRET", "test");
  vi.stubEnv("GOOGLE_CLIENT_ID", "test");
  vi.stubEnv("GOOGLE_CLIENT_SECRET", "test");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("summarizeProbes (pure)", () => {
  const r = (name: string, ran: boolean, issueCount: number): ProbeReading => ({
    name,
    ran,
    issueCount,
  });

  it("healthy = ran with zero issues; never negative, never inferred", () => {
    const out = summarizeProbes([
      r("cron", true, 4),
      r("stale-data", true, 0),
      r("env", true, 1),
      r("google-oauth", true, 0),
      r("slow-routes", true, 1),
    ]);
    expect(out.healthy).toBe(2);
    expect(out.unmeasured).toEqual([]);
  });

  it("a probe that did not run is unmeasured by name — not healthy", () => {
    const out = summarizeProbes([
      r("cron", false, 0),
      r("stale-data", true, 0),
      r("env", false, 0),
    ]);
    expect(out.healthy).toBe(1);
    expect(out.unmeasured).toEqual(["cron", "env"]);
  });
});

describe("computeHealthDigest counting (producer, five scans mocked)", () => {
  it("all probes ran and clean: healthy 5, unmeasured 0, overall healthy", async () => {
    const d = await computeHealthDigest();
    expect(d.counts).toEqual({ critical: 0, warning: 0, healthy: 5, unmeasured: 0 });
    expect(d.overall).toBe("healthy");
    expect(d.highlights.map((h) => h.severity)).toEqual(["info"]);
    expect(d.stats.googleOauthProbeFailed).toBe(false);
  });

  it("null scans surface as a named unmeasured warning and veto 'healthy' overall", async () => {
    mocks.scanStaleData.mockResolvedValue(null);
    mocks.scanCronHealth.mockRejectedValue(new Error("scan crashed"));

    const d = await computeHealthDigest();

    const unmeasured = d.highlights.find((h) => /unmeasured/.test(h.headline));
    expect(unmeasured).toBeDefined();
    expect(unmeasured!.severity).toBe("warning");
    expect(unmeasured!.headline).toMatch(/cron/);
    expect(unmeasured!.headline).toMatch(/stale-data/);
    // The load-bearing assertion: a digest with unread probes may not say healthy.
    expect(d.overall).not.toBe("healthy");
    expect(d.counts.unmeasured).toBe(2);
    expect(d.counts.healthy).toBe(3); // env, google, slow-routes ran clean
  });

  it("a circuit-open slow-routes read is unmeasured, not a measured zero", async () => {
    slowRoutesRows = null;

    const d = await computeHealthDigest();

    expect(d.counts.unmeasured).toBe(1);
    expect(d.counts.healthy).toBe(4);
    expect(d.overall).toBe("warning");
    expect(d.highlights.some((h) => /slow-routes/.test(h.headline))).toBe(true);
  });

  it("google probeFailed keeps its own targeted warning and is counted, not double-named", async () => {
    mocks.getGoogleOauthStatus.mockResolvedValue({
      state: "missing",
      lastSyncAt: null,
      consecutiveFailures: 0,
      email: null,
      reason: "Integration table unreadable",
      probeFailed: true,
    });

    const d = await computeHealthDigest();

    // Its dedicated highlight (with the reason) is the operator-facing notice…
    expect(d.highlights.some((h) => /OAuth status unknown/i.test(h.headline))).toBe(true);
    // …so the generic unmeasured headline must not name it a second time…
    expect(d.highlights.some((h) => /unmeasured/.test(h.headline))).toBe(false);
    // …but the COUNT still tells the truth.
    expect(d.counts.unmeasured).toBe(1);
    expect(d.stats.googleOauthProbeFailed).toBe(true);
    expect(d.overall).toBe("warning");
  });

  it("a highlight burst can no longer drive healthy negative", async () => {
    // Old formula on this input: 6 - 2 criticals - 5 warnings = -1.
    mocks.scanCronHealth.mockResolvedValue({
      diagnoses: [
        { severity: "critical", headline: "cron A dead" },
        { severity: "critical", headline: "cron B dead" },
        { severity: "critical", headline: "cron C dead (sliced off)" },
      ],
      summary: {
        declaredActiveCrons: 10,
        silentDeclaredCrons: 3,
        killedIndividually: 1,
        totalLogRowsLast48h: 500,
      },
    });
    mocks.scanStaleData.mockResolvedValue({
      totalStaleRows: 90,
      categories: [{ count: 90 }],
    });
    vi.stubEnv("VAPID_PUBLIC_KEY", "");
    vi.stubEnv("VAPID_PRIVATE_KEY", "");
    vi.stubEnv("GEMINI_API_KEY", "");
    vi.stubEnv("GOOGLE_GENERATIVE_AI_API_KEY", "");
    vi.stubEnv("CRON_SECRET", "");
    slowRoutesRows = [{ c: BigInt(3) }];

    const d = await computeHealthDigest();

    expect(d.counts.critical).toBe(2);
    expect(d.counts.warning).toBe(5);
    // google-oauth is the only probe that ran clean.
    expect(d.counts.healthy).toBe(1);
    expect(d.counts.healthy).toBeGreaterThanOrEqual(0);
    expect(d.counts.unmeasured).toBe(0);
    expect(d.overall).toBe("critical");
  });
});
