import { describe, it, expect } from "vitest";
import { buildVeoRequestBody } from "./services/veoStudio";

describe("buildVeoRequestBody", () => {
  it("builds a 9:16 product clip with the prompt + no-people guards", () => {
    const body = buildVeoRequestBody("a clean tire on a dark studio backdrop", {} as NodeJS.ProcessEnv);
    expect(body.instances).toEqual([{ prompt: "a clean tire on a dark studio backdrop" }]);
    const p = body.parameters as Record<string, unknown>;
    expect(p.aspectRatio).toBe("9:16");
    expect(p.numberOfVideos).toBe(1);
    expect(String(p.negativePrompt)).toMatch(/person|people|face/i);
    expect(p.personGeneration).toBe("dont_allow");
    expect(p.durationSeconds).toBe("4");
  });

  it("honors env overrides for model params", () => {
    const env = {
      REEL_VEO_DURATION: "8",
      REEL_VEO_RESOLUTION: "1080p",
      REEL_VEO_PERSON_GENERATION: "allow_adult",
    } as unknown as NodeJS.ProcessEnv;
    const p = buildVeoRequestBody("x", env).parameters as Record<string, unknown>;
    expect(p.durationSeconds).toBe("8");
    expect(p.resolution).toBe("1080p");
    expect(p.personGeneration).toBe("allow_adult");
  });
});
