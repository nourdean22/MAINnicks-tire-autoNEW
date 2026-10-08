/**
 * Previs readability gate (client/src/lib/facelessReelStudio.ts
 * validateOnScreenReadability), checked against every approved reel pack.
 */
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { validateOnScreenReadability, type StoryboardBeat } from "../client/src/lib/facelessReelStudio";

const beat = (n: number, start: number, end: number, onScreenText: string): StoryboardBeat => ({
  beatNumber: n, startSecond: start, endSecond: end, onScreenText, visual: "", motion: "", purpose: "", audioCue: "", safeZoneNotes: "",
});

describe("validateOnScreenReadability", () => {
  it("blocks text no one can read before the cut", () => {
    const r = validateOnScreenReadability([beat(1, 0, 2, "Fluid level is checked at a fill plug which is a lift job not a driveway job")]);
    expect(r.blocking).toHaveLength(1);
  });
  it("warns on tight text and passes comfortable text", () => {
    const r = validateOnScreenReadability([
      beat(1, 0, 3, "The 3,000-mile oil sticker is a sales tool today."),
      beat(2, 3, 7, "Heat makes a low tire read full."),
    ]);
    expect(r.blocking).toEqual([]);
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toMatch(/^beat 1:/);
  });
  it("empty text and zero-length beats are not this check's business", () => {
    expect(validateOnScreenReadability([beat(1, 0, 3, ""), beat(2, 3, 3, "words")])).toEqual({ blocking: [], warnings: [] });
  });
});

describe("approved reel packs", () => {
  it("no approved pack beat is BLOCKED by the readability gate (only flagged)", () => {
    const root = new URL("..", import.meta.url).pathname;
    const files = execSync("git ls-files 'docs/reel-packs/*/brief.json'", { encoding: "utf8", cwd: root }).split("\n").filter(Boolean);
    expect(files.length).toBeGreaterThan(50);
    const blocked: string[] = [];
    let beatsSeen = 0;
    for (const f of files) {
      let brief: { storyboardBeats?: StoryboardBeat[] };
      try { brief = JSON.parse(readFileSync(`${root}${f}`, "utf8")); } catch { continue; }
      const beats = (brief.storyboardBeats ?? []).map((b) => ({ ...b, onScreenText: b.onScreenText ?? "" }));
      beatsSeen += beats.length;
      blocked.push(...validateOnScreenReadability(beats).blocking.map((m) => `${f}: ${m}`));
    }
    expect(beatsSeen).toBeGreaterThan(300);
    expect(blocked).toEqual([]);
  });
});
