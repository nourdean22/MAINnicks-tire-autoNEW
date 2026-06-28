import { describe, it, expect } from "vitest";
import { pickMusicBed, type ReelAssemblyBrief } from "./services/reelAssembly";

// pickMusicBed reads the committed loops in apps/nickstire/assets/reel-music.
// These tests assert it resolves a real bed and is deterministic per brief.
const BRIEF = { id: "music-test", voiceoverScript: "test script" } as ReelAssemblyBrief;

describe("pickMusicBed", () => {
  it("returns a committed reel-music bed path", () => {
    const bed = pickMusicBed(BRIEF);
    expect(bed, "expected a committed bed under assets/reel-music").toMatch(
      /[\\/]reel-music[\\/].+\.(mp3|wav|m4a)$/i,
    );
  });

  it("is deterministic for the same brief (stable rotation)", () => {
    expect(pickMusicBed(BRIEF)).toBe(pickMusicBed(BRIEF));
  });
});
