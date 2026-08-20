import { describe, expect, it, vi, afterEach, type Mock } from "vitest";
import { durableStorageConfigured, assertDurableStorageForGeneration, storagePut } from "./storage";

// Node's "fs" is real ESM with a frozen module namespace — vi.spyOn on its
// exports throws "Cannot redefine property", so the local-fallback tests
// below need a full vi.mock, not a spy.
vi.mock("fs", () => ({
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  existsSync: vi.fn(() => true),
}));

/**
 * Storage safety (audit #7): never spend generation credits when the output
 * can't be durably kept (Railway local disk is ephemeral — prod lost clips
 * this way), and never silently ship business media to the anonymous Catbox
 * host. These pin the two guards.
 */
afterEach(() => vi.unstubAllEnvs());

describe("durableStorageConfigured", () => {
  it("true only when S3_BUCKET is set", () => {
    vi.stubEnv("S3_BUCKET", "my-bucket");
    expect(durableStorageConfigured()).toBe(true);
    vi.stubEnv("S3_BUCKET", "");
    expect(durableStorageConfigured()).toBe(false);
  });
});

describe("assertDurableStorageForGeneration", () => {
  it("throws (fails closed) with no S3 and no explicit ephemeral opt-in", () => {
    vi.stubEnv("S3_BUCKET", "");
    vi.stubEnv("REEL_ALLOW_EPHEMERAL_STORAGE", "");
    expect(() => assertDurableStorageForGeneration("reel job 7")).toThrowError(/durable storage|S3_BUCKET/);
  });

  it("passes when S3 is configured", () => {
    vi.stubEnv("S3_BUCKET", "my-bucket");
    expect(() => assertDurableStorageForGeneration("reel job 7")).not.toThrow();
  });

  it("passes under the explicit ephemeral opt-in", () => {
    vi.stubEnv("S3_BUCKET", "");
    vi.stubEnv("REEL_ALLOW_EPHEMERAL_STORAGE", "true");
    expect(() => assertDurableStorageForGeneration("reel job 7")).not.toThrow();
  });

  it("names the context so the failed job message is actionable", () => {
    vi.stubEnv("S3_BUCKET", "");
    vi.stubEnv("REEL_ALLOW_EPHEMERAL_STORAGE", "");
    expect(() => assertDurableStorageForGeneration("reel job 42 clip generation"))
      .toThrowError(/reel job 42 clip generation/);
  });
});

/**
 * 2026-08-20 · Higgsfield stock-fallback remediation, Phase 3. Found by
 * running the remediation's own archive step against real prod data: 11
 * reels, each archived to `remediation-archive/<reel_id>/original.mp4` +
 * `.../manifest.json`. On the local-disk fallback (no S3_BUCKET here), only
 * the LAST reel's two files survived — storagePut wrote every prior call to
 * `path.join(genDir, path.basename(key))`, so every key sharing a basename
 * ("original.mp4", "manifest.json") but differing only by directory
 * silently overwrote the one before it. No error, no warning; the "saved
 * locally" log line looked identical for every call. Fixed by writing to
 * `path.join(genDir, key)` (creating subdirectories as needed) instead of
 * discarding everything but the basename.
 */
describe("storagePut local-disk fallback — no S3 configured", () => {
  // resetAllMocks (not restoreAllMocks): these are vi.mock() factory fns,
  // not spies on the real module — reset clears call history AND any
  // per-test .mockImplementation() override, so one test's custom writeFileSync
  // capture can't leak into the next test's assertions.
  afterEach(() => vi.resetAllMocks());

  it("preserves the full relative key, not just the basename — two keys sharing a basename write to DISTINCT files", async () => {
    vi.stubEnv("S3_BUCKET", "");
    const fs = await import("fs");
    const written: Record<string, Buffer> = {};
    (fs.writeFileSync as Mock).mockImplementation((filePath: unknown, data: unknown) => {
      written[String(filePath)] = data as Buffer;
    });

    await storagePut("remediation-archive/1470001/original.mp4", Buffer.from("reel A"), "video/mp4");
    await storagePut("remediation-archive/1500001/original.mp4", Buffer.from("reel B"), "video/mp4");

    const paths = Object.keys(written);
    expect(paths).toHaveLength(2);
    expect(paths.some((p) => p.includes("1470001"))).toBe(true);
    expect(paths.some((p) => p.includes("1500001"))).toBe(true);
    // The regression: both used to resolve to the SAME path (basename-only),
    // so the second write would have clobbered the first.
    expect(paths[0]).not.toBe(paths[1]);
    expect(written[paths.find((p) => p.includes("1470001"))!].toString()).toBe("reel A");
    expect(written[paths.find((p) => p.includes("1500001"))!].toString()).toBe("reel B");
  });

  it("creates the destination's parent directory before writing", async () => {
    vi.stubEnv("S3_BUCKET", "");
    const fs = await import("fs");

    await storagePut("remediation-archive/1470001/original.mp4", Buffer.from("x"), "video/mp4");

    const mkdirCalls = (fs.mkdirSync as Mock).mock.calls.map((c) => String(c[0]));
    expect(mkdirCalls.some((d) => d.includes("1470001"))).toBe(true);
  });
});
