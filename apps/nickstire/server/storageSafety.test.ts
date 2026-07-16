import { describe, expect, it, vi, afterEach } from "vitest";
import { durableStorageConfigured, assertDurableStorageForGeneration } from "./storage";

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
