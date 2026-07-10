import { describe, it, expect } from "vitest";
import { buildVeoRequestBody } from "./services/veoStudio";

describe("buildVeoRequestBody", () => {
  it("builds the verified minimal 9:16 product body with the no-people guard", () => {
    const body = buildVeoRequestBody("a clean tire on a dark studio backdrop", {} as NodeJS.ProcessEnv);
    expect(body.instances).toEqual([{ prompt: "a clean tire on a dark studio backdrop" }]);
    const p = body.parameters as Record<string, unknown>;
    expect(p.aspectRatio).toBe("9:16");
    expect(p.resolution).toBe("720p");
    expect(String(p.negativePrompt)).toMatch(/person|people|face/i);
    // veo-3.0-generate-001 rejects all three — must be absent by default
    expect(p.numberOfVideos).toBeUndefined();
    expect(p.personGeneration).toBeUndefined();
    expect(p.durationSeconds).toBeUndefined();
  });

  it("adds model-specific extras only when env opts in (duration coerced to a number)", () => {
    const env = {
      REEL_VEO_DURATION: "8",
      REEL_VEO_RESOLUTION: "1080p",
      REEL_VEO_PERSON_GENERATION: "allow_adult",
    } as unknown as NodeJS.ProcessEnv;
    const p = buildVeoRequestBody("x", env).parameters as Record<string, unknown>;
    expect(p.resolution).toBe("1080p");
    expect(p.durationSeconds).toBe(8); // numeric, not the string "8" that veo-3.0 rejects
    expect(p.personGeneration).toBe("allow_adult");
  });

  it("does not pass the unverified generateAudio parameter", () => {
    const env = {
      REEL_VEO_AUDIO_DISABLED: "true",
      REEL_VEO_GENERATE_AUDIO: "false",
    } as unknown as NodeJS.ProcessEnv;
    const p = buildVeoRequestBody("x", env).parameters as Record<string, unknown>;
    expect(p.generateAudio).toBeUndefined();
  });
});
