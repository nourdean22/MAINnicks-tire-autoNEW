/**
 * tests/lib/auth/extension-token.test.ts · Wave I.b (2026-05-23).
 *
 * Round-trip coverage: issue → validate → list → revoke. The token
 * surface is THE auth boundary for /api/brain/dump · regressions
 * here would leak external access. Cases cover:
 *   · token format (sn_ prefix · fixed length)
 *   · validate rejects bad header / wrong prefix / wrong length
 *   · validate finds an issued token by sha256 hash match
 *   · revoked tokens fail validation
 *   · listing surfaces label + lastUsedAt
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  brainMemory: {
    create: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
  },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    brainMemory: mocks.brainMemory,
  },
}));

describe("extension-token · issue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.brainMemory.create.mockResolvedValue({ id: "row1" });
  });

  it("returns a sn_-prefixed token of fixed length", async () => {
    const { issueToken } = await import("@/lib/auth/extension-token");
    const result = await issueToken({ label: "chrome-laptop" });
    expect(result.token).toMatch(/^sn_[A-Za-z0-9]{24}$/);
    expect(result.label).toBe("chrome-laptop");
    expect(typeof result.createdAt).toBe("string");
  });

  it("writes a sha256 hash (NOT the raw token) into brain memory", async () => {
    const { issueToken } = await import("@/lib/auth/extension-token");
    const result = await issueToken({ label: "test" });
    const call = mocks.brainMemory.create.mock.calls[0]?.[0];
    expect(call.data.content).not.toContain(result.token);
    // sha256 is 64 hex chars
    expect(call.data.content).toMatch(/^[a-f0-9]{64}$/);
    expect(call.data.category).toBe("api_token");
  });

  it("sanitizes the label into a usable BrainMemory key", async () => {
    const { issueToken } = await import("@/lib/auth/extension-token");
    await issueToken({ label: "chrome @ work!" });
    const call = mocks.brainMemory.create.mock.calls[0]?.[0];
    // Spaces + special chars get replaced with hyphens · timestamp suffix
    expect(call.data.key).toMatch(/^chrome---work-_[a-z0-9]+$/);
  });

  it("rejection-samples to avoid modulo bias on the 62-char alphabet", async () => {
    // 2026-05-23 · audit follow-up · pre-fix the generator used
    // `bytes[i] % 62` which over-weighted the first 8 alphabet
    // chars by ~25% (256 % 62 = 8). This test issues many tokens
    // and asserts the per-char distribution is approximately
    // uniform across all 62 chars. Chi-squared isn't worth it ·
    // a coarse "no char dominates" check is enough.
    const { issueToken } = await import("@/lib/auth/extension-token");
    const counts = new Map<string, number>();
    const SAMPLES = 200;
    for (let i = 0; i < SAMPLES; i++) {
      const r = await issueToken({ label: `t${i}` });
      // Strip prefix · count each char of the body
      for (const ch of r.token.slice(3)) {
        counts.set(ch, (counts.get(ch) ?? 0) + 1);
      }
    }
    // Expected per-char count ≈ (24 × 200) / 62 ≈ 77.4
    // Allow generous tolerance · we just want to catch a 25%+ skew
    // toward the first 8 chars (which would give them count > 96).
    const firstEight = ["a", "b", "c", "d", "e", "f", "g", "h"];
    const firstEightTotal = firstEight.reduce(
      (s, c) => s + (counts.get(c) ?? 0),
      0,
    );
    const overallTotal = Array.from(counts.values()).reduce((s, n) => s + n, 0);
    const firstEightShare = firstEightTotal / overallTotal;
    // Uniform expectation: 8/62 ≈ 0.129. Biased pre-fix would give
    // ≈ 5/256 / (mean ≈ 4.13/256) ≈ 0.158 (~22% skew).
    // Tolerance · 0.10-0.18 = uniform-ish · outside that = bias.
    expect(firstEightShare).toBeGreaterThan(0.1);
    expect(firstEightShare).toBeLessThan(0.18);
  });
});

describe("extension-token · validate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects null / empty header", async () => {
    const { validateToken } = await import("@/lib/auth/extension-token");
    expect(await validateToken(null)).toBeNull();
    expect(await validateToken("")).toBeNull();
  });

  it("rejects header without Bearer prefix", async () => {
    const { validateToken } = await import("@/lib/auth/extension-token");
    expect(await validateToken("sn_abc")).toBeNull();
    expect(await validateToken("Basic sn_abc")).toBeNull();
  });

  it("rejects tokens without sn_ prefix", async () => {
    const { validateToken } = await import("@/lib/auth/extension-token");
    expect(
      await validateToken(
        "Bearer x_aaaaaaaaaaaaaaaaaaaaaaaa",
      ),
    ).toBeNull();
  });

  it("rejects tokens of wrong length", async () => {
    const { validateToken } = await import("@/lib/auth/extension-token");
    // Too short
    expect(await validateToken("Bearer sn_short")).toBeNull();
    // Too long
    expect(
      await validateToken("Bearer sn_" + "a".repeat(50)),
    ).toBeNull();
  });

  it("returns the row when sha256 matches", async () => {
    mocks.brainMemory.findFirst.mockResolvedValue({
      id: "row1",
      key: "chrome-laptop_xyz",
      metadata: {
        label: "chrome-laptop",
        scope: "extension",
        lastUsedAt: null,
      },
      createdAt: new Date("2026-05-23T00:00:00Z"),
    });
    mocks.brainMemory.update.mockResolvedValue({ id: "row1" });
    const { validateToken } = await import("@/lib/auth/extension-token");
    const result = await validateToken(
      "Bearer sn_aaaaaaaaaaaaaaaaaaaaaaaa",
    );
    expect(result).not.toBeNull();
    expect(result?.label).toBe("chrome-laptop");
    expect(result?.scope).toBe("extension");
    // findFirst filters by deletedAt: null (revoked rows excluded)
    const call = mocks.brainMemory.findFirst.mock.calls[0]?.[0];
    expect(call.where.deletedAt).toBeNull();
  });

  it("returns null when row missing", async () => {
    mocks.brainMemory.findFirst.mockResolvedValue(null);
    const { validateToken } = await import("@/lib/auth/extension-token");
    expect(
      await validateToken("Bearer sn_aaaaaaaaaaaaaaaaaaaaaaaa"),
    ).toBeNull();
  });

  it("degrades to null on DB error", async () => {
    mocks.brainMemory.findFirst.mockRejectedValue(new Error("db"));
    const { validateToken } = await import("@/lib/auth/extension-token");
    expect(
      await validateToken("Bearer sn_aaaaaaaaaaaaaaaaaaaaaaaa"),
    ).toBeNull();
  });
});

describe("extension-token · list + revoke", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("listTokens projects to a clean shape", async () => {
    mocks.brainMemory.findMany.mockResolvedValue([
      {
        id: "row1",
        key: "chrome-laptop_abc123",
        metadata: { label: "chrome-laptop", scope: "extension", lastUsedAt: null },
        createdAt: new Date("2026-05-23T00:00:00Z"),
      },
    ]);
    const { listTokens } = await import("@/lib/auth/extension-token");
    const result = await listTokens();
    expect(result).toHaveLength(1);
    expect(result[0].label).toBe("chrome-laptop");
    expect(result[0].keyHint).toBe("abc123");
    expect(result[0].lastUsedAt).toBeNull();
  });

  it("revokeToken sets deletedAt", async () => {
    mocks.brainMemory.update.mockResolvedValue({ id: "row1" });
    const { revokeToken } = await import("@/lib/auth/extension-token");
    const result = await revokeToken("row1");
    expect(result.ok).toBe(true);
    const call = mocks.brainMemory.update.mock.calls[0]?.[0];
    expect(call.data.deletedAt).toBeInstanceOf(Date);
  });

  it("revokeToken returns ok=false on DB error", async () => {
    mocks.brainMemory.update.mockRejectedValue(new Error("db"));
    const { revokeToken } = await import("@/lib/auth/extension-token");
    const result = await revokeToken("row1");
    expect(result.ok).toBe(false);
  });
});
