import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cloneVoice, checkVoiceCloneHealth } from "../services/voice-clone";
import * as featureFlags from "../services/featureFlags";

vi.mock("../services/featureFlags", () => ({
  isEnabled: vi.fn(),
}));

describe("voice-clone service", () => {
  const origEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...origEnv };
    // Clear variables to isolate testing
    delete process.env.REPLICATE_API_KEY;
    delete process.env.XTTS_VOICE_SAMPLE_URL;
  });

  afterEach(() => {
    process.env = { ...origEnv };
  });

  it("refuses to clone voice if feature flag is disabled", async () => {
    vi.mocked(featureFlags.isEnabled).mockResolvedValue(false);

    const result = await cloneVoice({ text: "Hello customer." });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("disabled");
    }
  });

  it("refuses to clone voice if REPLICATE_API_KEY is missing", async () => {
    vi.mocked(featureFlags.isEnabled).mockResolvedValue(true);

    const result = await cloneVoice({ text: "Hello customer." });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("no_provider");
      expect(result.error).toContain("REPLICATE_API_KEY");
    }
  });

  it("uses official English fallback voice URL when XTTS_VOICE_SAMPLE_URL is not set", async () => {
    vi.mocked(featureFlags.isEnabled).mockResolvedValue(true);
    process.env.REPLICATE_API_KEY = "mock-key";

    // Spy on fetch to inspect what gets sent to Replicate
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ id: "123", status: "starting" }),
    });
    vi.stubGlobal("fetch", mockFetch);

    // Call voice cloning (which will time out or poll, we can timeout early)
    const result = await cloneVoice({ text: "Hello customer.", timeoutMs: 10 });
    
    expect(mockFetch).toHaveBeenCalled();
    const firstCallArgs = mockFetch.mock.calls[0];
    const postBody = JSON.parse(firstCallArgs[1].body);

    // Verify the fallback URL was passed as the speaker
    expect(postBody.input.speaker).toBe(
      "https://huggingface.co/coqui/XTTS-v2/resolve/v2.0.2/samples/en_sample.wav"
    );
  });

  it("correctly resolves default sample in health probe", async () => {
    vi.mocked(featureFlags.isEnabled).mockResolvedValue(true);
    process.env.REPLICATE_API_KEY = "mock-key";

    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", mockFetch);

    const health = await checkVoiceCloneHealth();
    expect(health.enabled).toBe(true);
    expect(health.provider).toBe("replicate");
    expect(health.providerReachable).toBe(true);
    expect(health.sampleReachable).toBe(true);
    
    // Verify that the health probe checked the fallback URL
    expect(mockFetch).toHaveBeenCalledWith(
      "https://huggingface.co/coqui/XTTS-v2/resolve/v2.0.2/samples/en_sample.wav",
      expect.any(Object)
    );
  });
});
