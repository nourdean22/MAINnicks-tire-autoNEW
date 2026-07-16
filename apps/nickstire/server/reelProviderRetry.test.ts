import { describe, expect, it, vi, afterEach } from "vitest";
import { withTimeout, LocalTimeoutError, isLocalTimeout } from "./services/reelPipeline";
import { veoCredentialsPresent } from "./services/veoStudio";

/**
 * P1: (1) a LOCAL poll timeout must be distinguishable from a provider failure,
 * so the reel worker resumes the SAME Veo op instead of submitting a fresh paid
 * one (duplicate-spend bug); (2) the pipeline-health card must check VEO creds
 * (the active reel video generator), not Higgsfield.
 */
describe("withTimeout / LocalTimeoutError", () => {
  it("rejects with a tagged LocalTimeoutError so callers can avoid re-submitting", async () => {
    const never = new Promise(() => {});
    const err = await withTimeout(never, 5, "poll beat").then(() => null, (e) => e);
    expect(err).toBeInstanceOf(LocalTimeoutError);
    expect(isLocalTimeout(err)).toBe(true);
  });

  it("does NOT tag a genuine provider error as a local timeout", async () => {
    const providerFail = Promise.reject(new Error("Veo submit failed (HTTP 403): key leaked"));
    const err = await withTimeout(providerFail, 5000, "poll beat").then(() => null, (e) => e);
    expect(isLocalTimeout(err)).toBe(false);
    expect(String((err as Error).message)).toMatch(/key leaked/);
  });

  it("passes a resolved value straight through", async () => {
    expect(await withTimeout(Promise.resolve("uri"), 5000, "poll")).toBe("uri");
  });
});

describe("veoCredentialsPresent", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("true with a Gemini API key", () => {
    vi.stubEnv("GEMINI_API_KEY", "k");
    vi.stubEnv("GOOGLE_SERVICE_ACCOUNT_EMAIL", "");
    vi.stubEnv("GOOGLE_SERVICE_ACCOUNT_KEY", "");
    expect(veoCredentialsPresent()).toBe(true);
  });

  it("true with a full service-account pair", () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    vi.stubEnv("GOOGLE_AI_API_KEY", "");
    vi.stubEnv("GOOGLE_GENAI_API_KEY", "");
    vi.stubEnv("GOOGLE_SERVICE_ACCOUNT_EMAIL", "svc@x.iam");
    vi.stubEnv("GOOGLE_SERVICE_ACCOUNT_KEY", "-----BEGIN-----");
    expect(veoCredentialsPresent()).toBe(true);
  });

  it("false with no Veo creds — even if Higgsfield is configured elsewhere", () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    vi.stubEnv("GOOGLE_AI_API_KEY", "");
    vi.stubEnv("GOOGLE_GENAI_API_KEY", "");
    vi.stubEnv("GOOGLE_SERVICE_ACCOUNT_EMAIL", "");
    vi.stubEnv("GOOGLE_SERVICE_ACCOUNT_KEY", "");
    expect(veoCredentialsPresent()).toBe(false);
  });
});
