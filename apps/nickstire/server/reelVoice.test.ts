import { describe, it, expect, vi, afterEach } from "vitest";
import { pickVoiceProvider, googleTtsRequest, generateVoiceover, buildReelSsml } from "./services/reelVoice";

describe("pickVoiceProvider", () => {
  it("prefers Google when its service-account creds are present", () => {
    expect(
      pickVoiceProvider({ GOOGLE_SERVICE_ACCOUNT_EMAIL: "a@b.com", GOOGLE_SERVICE_ACCOUNT_KEY: "k", ELEVENLABS_API_KEY: "x" } as NodeJS.ProcessEnv),
    ).toBe("google");
  });
  it("falls back to ElevenLabs when only its key is set", () => {
    expect(pickVoiceProvider({ ELEVENLABS_API_KEY: "x" } as NodeJS.ProcessEnv)).toBe("elevenlabs");
  });
  it("returns null when no provider is configured", () => {
    expect(pickVoiceProvider({} as NodeJS.ProcessEnv)).toBeNull();
  });
});

describe("googleTtsRequest", () => {
  it("targets the synthesize endpoint with the Neural2 voice and LINEAR16 WAV output", () => {
    const { url, body } = googleTtsRequest("hello there");
    expect(url).toContain("texttospeech.googleapis.com");
    expect((body.voice as { name: string }).name).toBe("en-US-Neural2-J");
    expect((body.audioConfig as { audioEncoding: string }).audioEncoding).toBe("LINEAR16");
    // Sends SSML (not plain text) for natural pacing; the script is wrapped in <speak>.
    expect((body.input as { ssml: string }).ssml).toContain("<speak>");
    expect((body.input as { ssml: string }).ssml).toContain("hello there");
    expect((body.input as { text?: string }).text).toBeUndefined();
  });
});

describe("buildReelSsml", () => {
  it("emphasizes the hook sentence and inserts breaks between sentences", () => {
    const ssml = buildReelSsml("Your tires are lying. Ten degrees colder costs you a psi. Air up today.");
    expect(ssml.startsWith("<speak>")).toBe(true);
    expect(ssml).toContain('<emphasis level="strong">Your tires are lying.</emphasis>');
    expect(ssml).toContain('<break time="350ms"/>');
  });
  it("XML-escapes unsafe characters so the SSML never breaks", () => {
    const ssml = buildReelSsml("Tires & brakes <now>");
    expect(ssml).toContain("Tires &amp; brakes");
    expect(ssml).toContain("&lt;now&gt;");
    expect(ssml).not.toContain("& "); // no raw ampersand survives
  });
  it("wraps a single-sentence script and still emphasizes it as the hook (no breaks)", () => {
    const ssml = buildReelSsml("just one line");
    expect(ssml).toBe('<speak><emphasis level="strong">just one line</emphasis></speak>');
    expect(ssml).not.toContain("<break");
  });
});

describe("generateVoiceover", () => {
  it("returns null for empty/whitespace script without calling any provider", async () => {
    expect(await generateVoiceover("   ")).toBeNull();
    expect(await generateVoiceover(null)).toBeNull();
  });
});

/**
 * Fail-closed policy (Instagram audit wave 4): a brief WITH a voiceover script
 * is designed around narration — losing TTS must fail the job, not silently
 * assemble a narration-less reel the operator never reviewed. Null stays the
 * contract only for deliberately silent reels (no script) or the explicit
 * REEL_VO_OPTIONAL=true escape hatch.
 */
describe("generateVoiceover fail-closed policy", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  function clearProviders() {
    vi.stubEnv("GOOGLE_SERVICE_ACCOUNT_EMAIL", "");
    vi.stubEnv("GOOGLE_SERVICE_ACCOUNT_KEY", "");
    vi.stubEnv("ELEVENLABS_API_KEY", "");
    vi.stubEnv("REEL_VO_OPTIONAL", "");
  }

  it("THROWS when a script exists but no TTS provider is configured", async () => {
    clearProviders();
    await expect(generateVoiceover("Check your tread depth.")).rejects.toThrow(/no TTS provider/);
  });

  it("degrades to null under the explicit REEL_VO_OPTIONAL=true escape hatch", async () => {
    clearProviders();
    vi.stubEnv("REEL_VO_OPTIONAL", "true");
    expect(await generateVoiceover("Check your tread depth.")).toBeNull();
  });

  it("THROWS when the provider errors (was: silent null → narration-less reel)", async () => {
    clearProviders();
    vi.stubEnv("ELEVENLABS_API_KEY", "test-key");
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: false,
      status: 500,
      text: async () => "upstream down",
    })));
    await expect(generateVoiceover("Check your tread depth.")).rejects.toThrow(/Voiceover generation failed \(elevenlabs\)/);
  });

  it("provider errors still degrade to null when REEL_VO_OPTIONAL=true", async () => {
    clearProviders();
    vi.stubEnv("ELEVENLABS_API_KEY", "test-key");
    vi.stubEnv("REEL_VO_OPTIONAL", "true");
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: false,
      status: 500,
      text: async () => "upstream down",
    })));
    expect(await generateVoiceover("Check your tread depth.")).toBeNull();
  });

  it("uses ELEVENLABS_VOICE_ID when set, defaulting to Roger otherwise", async () => {
    clearProviders();
    vi.stubEnv("ELEVENLABS_API_KEY", "test-key");
    vi.stubEnv("ELEVENLABS_VOICE_ID", "custom-voice-123");
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ audio_base64: Buffer.from("audio").toString("base64") }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const vo = await generateVoiceover("Check your tread depth.");
    expect(vo?.provider).toBe("elevenlabs");
    expect(String(fetchMock.mock.calls[0][0])).toContain("custom-voice-123");

    vi.stubEnv("ELEVENLABS_VOICE_ID", "");
    await generateVoiceover("Check your tread depth.");
    expect(String(fetchMock.mock.calls[1][0])).toContain("CwhRBWXzGAHq8TQ4Fs17");
  });
});
