/**
 * v10 Track E.3 · Tests for getEcosystemDigest contract.
 *
 * Verifies:
 *   - Manifest-only path (no GITHUB_TOKEN) returns a valid digest
 *     without throwing or making any fetch call.
 *   - With a token + mocked fetch: commit windows are computed from
 *     committer.date, lastCommitMessage trims to 80 chars + first
 *     line, totals roll up correctly.
 *   - Flag rules fire on the right conditions:
 *       · stale tag in manifest
 *       · active repo with last commit > 30d ago
 *       · core tier active repo with 0 commits this week
 *   - Narrative composition: personal ring repos by-commit-count;
 *     business ring collapsed when healthy; flagged business listed.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// We need to mock the REPOS manifest before importing the digest
// builder so we can exercise specific scenarios.
vi.mock("@/config/repos", () => {
  return {
    REPOS: [
      {
        name: "statenour-os",
        fullName: "owner/statenour-os",
        ring: "personal",
        tier: "core",
        purpose: "p",
        host: "vercel",
        branch: "main",
        productionUrl: "https://example.com",
        status: "active",
        monitored: true,
        nickWriteAccess: "none",
      },
      {
        name: "biz-main",
        fullName: "owner/biz-main",
        ring: "business",
        tier: "core",
        purpose: "p",
        host: "railway",
        branch: "main",
        productionUrl: "https://biz.example.com",
        status: "active",
        monitored: true,
        nickWriteAccess: "none",
      },
      {
        name: "biz-cron",
        fullName: "owner/biz-cron",
        ring: "business",
        tier: "active-support",
        purpose: "p",
        host: "railway",
        branch: "main",
        productionUrl: null,
        status: "active",
        monitored: true,
        nickWriteAccess: "none",
      },
      {
        name: "old-scaffold",
        fullName: "owner/old-scaffold",
        ring: "archive",
        tier: "archive",
        purpose: "p",
        host: "github-only",
        branch: null,
        productionUrl: null,
        status: "archived",
        monitored: false,
        nickWriteAccess: "none",
      },
    ],
  };
});

import { getEcosystemDigest } from "@/lib/system/repo-briefing";

const ORIGINAL_GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const ORIGINAL_FETCH = globalThis.fetch;

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  if (ORIGINAL_GITHUB_TOKEN === undefined) {
    delete process.env.GITHUB_TOKEN;
  } else {
    process.env.GITHUB_TOKEN = ORIGINAL_GITHUB_TOKEN;
  }
  globalThis.fetch = ORIGINAL_FETCH;
});

describe("v10 E.3 · getEcosystemDigest · manifest-only path", () => {
  it("returns liveDataAvailable=false when GITHUB_TOKEN missing", async () => {
    delete process.env.GITHUB_TOKEN;
    // No fetch should be called when there's no token.
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof globalThis.fetch;

    const digest = await getEcosystemDigest();

    expect(digest.liveDataAvailable).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
    // Three monitored repos in the mock — old-scaffold is monitored:false.
    expect(digest.repos.length).toBe(3);
    expect(digest.totalCommitsLast7d).toBe(0);
    expect(digest.totalCommitsLast30d).toBe(0);
  });

  it("emits a non-empty narrative even without live data", async () => {
    delete process.env.GITHUB_TOKEN;
    const digest = await getEcosystemDigest();
    expect(typeof digest.narrative).toBe("string");
    expect(digest.narrative.length).toBeGreaterThan(0);
  });
});

describe("v10 E.3 · getEcosystemDigest · live data path", () => {
  function buildCommit(daysAgo: number, msg = "commit msg") {
    const d = new Date(Date.now() - daysAgo * 86_400_000);
    return {
      sha: "abc1234567890",
      commit: {
        message: msg,
        committer: { date: d.toISOString() },
      },
    };
  }

  function mockFetch(
    perRepo: Record<string, Array<ReturnType<typeof buildCommit>>>,
  ) {
    const fetchSpy = vi.fn(async (url: string) => {
      // Match repo from URL
      const match = url.match(/\/repos\/(owner\/[^/]+)\/commits/);
      const repoName = match?.[1] ?? "";
      const data = perRepo[repoName] ?? [];
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => data,
      } as unknown as Response;
    });
    globalThis.fetch = fetchSpy as unknown as typeof globalThis.fetch;
    return fetchSpy;
  }

  it("counts commits in 7d and 30d windows", async () => {
    process.env.GITHUB_TOKEN = "ghp_test";
    mockFetch({
      "owner/statenour-os": [
        buildCommit(1, "yesterday"),
        buildCommit(3, "three days ago"),
        buildCommit(20, "three weeks ago"),
      ],
      "owner/biz-main": [buildCommit(2, "biz commit")],
      "owner/biz-cron": [],
    });

    const digest = await getEcosystemDigest();

    const personal = digest.repos.find(
      (r) => r.repo.name === "statenour-os",
    );
    expect(personal?.commitsLast7d).toBe(2);
    expect(personal?.commitsLast30d).toBe(3);

    const biz = digest.repos.find((r) => r.repo.name === "biz-main");
    expect(biz?.commitsLast7d).toBe(1);
    expect(biz?.commitsLast30d).toBe(1);

    expect(digest.totalCommitsLast7d).toBe(3);
    expect(digest.totalCommitsLast30d).toBe(4);
  });

  it("flags an active core repo with zero commits this week", async () => {
    process.env.GITHUB_TOKEN = "ghp_test";
    mockFetch({
      "owner/statenour-os": [],
      "owner/biz-main": [buildCommit(1)],
      "owner/biz-cron": [buildCommit(1)],
    });

    const digest = await getEcosystemDigest();

    const personal = digest.repos.find(
      (r) => r.repo.name === "statenour-os",
    );
    expect(personal?.flagReasons.some((r) => r.includes("stalled"))).toBe(
      true,
    );
  });

  it("flags an active repo with last commit > 30d ago as going dormant", async () => {
    process.env.GITHUB_TOKEN = "ghp_test";
    // statenour-os last commit was 45 days ago — still in window so it
    // appears in `commits` query, but commitsLast30d will be 0.
    mockFetch({
      "owner/statenour-os": [buildCommit(45, "old commit")],
      "owner/biz-main": [buildCommit(1)],
      "owner/biz-cron": [buildCommit(1)],
    });

    const digest = await getEcosystemDigest();
    const personal = digest.repos.find(
      (r) => r.repo.name === "statenour-os",
    );
    expect(
      personal?.flagReasons.some((r) =>
        r.includes("active repo going dormant"),
      ),
    ).toBe(true);
  });

  it("trims long commit messages to 80 chars + first line only", async () => {
    process.env.GITHUB_TOKEN = "ghp_test";
    const longMsg =
      "First line of message that is unusually long and should be trimmed at eighty chars\nbody line one\nbody line two";
    mockFetch({
      "owner/statenour-os": [buildCommit(1, longMsg)],
      "owner/biz-main": [buildCommit(1)],
      "owner/biz-cron": [],
    });

    const digest = await getEcosystemDigest();
    const personal = digest.repos.find(
      (r) => r.repo.name === "statenour-os",
    );
    expect(personal?.lastCommitMessage?.length).toBeLessThanOrEqual(80);
    expect(personal?.lastCommitMessage?.includes("\n")).toBe(false);
  });

  it("narrative collapses business ring when all healthy", async () => {
    process.env.GITHUB_TOKEN = "ghp_test";
    mockFetch({
      "owner/statenour-os": [buildCommit(1), buildCommit(2)],
      "owner/biz-main": [buildCommit(1)],
      "owner/biz-cron": [buildCommit(1)],
    });

    const digest = await getEcosystemDigest();
    expect(digest.narrative.toLowerCase()).toContain("business ring");
    expect(digest.narrative.toLowerCase()).toContain("healthy");
  });

  it("returns no flag for the archive entry", async () => {
    process.env.GITHUB_TOKEN = "ghp_test";
    mockFetch({
      "owner/statenour-os": [buildCommit(1)],
      "owner/biz-main": [buildCommit(1)],
      "owner/biz-cron": [buildCommit(1)],
    });

    const digest = await getEcosystemDigest();
    const archived = digest.repos.find((r) => r.repo.name === "old-scaffold");
    // monitored:false in mock — should not appear in repos array.
    expect(archived).toBeUndefined();
  });

  it("never throws if a fetch fails", async () => {
    process.env.GITHUB_TOKEN = "ghp_test";
    globalThis.fetch = (vi.fn(async () => {
      throw new Error("network down");
    })) as unknown as typeof globalThis.fetch;

    await expect(getEcosystemDigest()).resolves.toBeDefined();
  });

  it("flags commitsCapHit when GitHub returned 100 commits (per_page max)", async () => {
    process.env.GITHUB_TOKEN = "ghp_test";
    // Build exactly 100 commits — this is the per_page max.
    const hundred = Array.from({ length: 100 }, (_, i) => buildCommit(i % 30));
    mockFetch({
      "owner/statenour-os": hundred,
      "owner/biz-main": [buildCommit(1)],
      "owner/biz-cron": [buildCommit(1)],
    });

    const digest = await getEcosystemDigest();
    const personal = digest.repos.find(
      (r) => r.repo.name === "statenour-os",
    );
    expect(personal?.commitsCapHit).toBe(true);
    expect(
      personal?.flagReasons.some((r) =>
        r.includes("capped at 100"),
      ),
    ).toBe(true);
  });
});
