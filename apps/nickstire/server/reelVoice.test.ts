import { describe, it, expect } from "vitest";
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
