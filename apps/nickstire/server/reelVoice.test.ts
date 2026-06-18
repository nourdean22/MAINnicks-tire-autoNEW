import { describe, it, expect } from "vitest";
import { pickVoiceProvider, googleTtsRequest, generateVoiceover } from "./services/reelVoice";

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
    expect((body.input as { text: string }).text).toBe("hello there");
  });
});

describe("generateVoiceover", () => {
  it("returns null for empty/whitespace script without calling any provider", async () => {
    expect(await generateVoiceover("   ")).toBeNull();
    expect(await generateVoiceover(null)).toBeNull();
  });
});
