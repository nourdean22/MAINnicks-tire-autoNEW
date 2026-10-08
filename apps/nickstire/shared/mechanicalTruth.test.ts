import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { buildTruthPacketFragment, mechanicalTruthViolations } from "./mechanicalTruth";
import { condemnedContentProblem } from "./reelClaimAudit";

/** One unsafe sentence per prohibited claim — every pattern must fire on something. */
const UNSAFE: Record<string, string> = {
  plug_alone_is_proper_repair: "Honestly a plug is a permanent fix, you're good to go.",
  sidewall_is_repairable: "Nail in the sidewall? It can be patched in ten minutes.",
  every_puncture_repairable: "Any nail can be patched, so don't buy a new tire.",
  safe_until_bald: "Your tires are fine until they're bald.",
  two_32_is_plenty: "2/32 is plenty for the city.",
  wrong_legal_minimum: "4/32 is the legal minimum in Ohio.",
  uneven_wear_always_alignment: "Uneven tire wear always means your alignment is off.",
  vibration_single_certain_cause: "That shake at 60 is definitely wheel balance.",
  pothole_certain_damage: "Hit a pothole? It will always bend your rim.",
  pothole_no_feel_no_damage: "If you don't feel anything after the hit, you're fine.",
};

/** Correct statements already in the repo's own content — none may be blocked. */
const SAFE = [
  "A nail in the tread is often repairable — in the sidewall, usually not (it flexes too much to patch safely).",
  "No patch fixes a sidewall.",
  "It can't be repaired — the sidewall flexes too much.",
  "Replace at 2/32 of an inch.",
  "5/32 of an inch, not the legal minimum, is when wet grip starts to drop.",
  "uneven tread wear on a sedan almost always means alignment",
  "vibration is almost always related to tire balance",
  "A hard pothole hit can damage a wheel even when you feel nothing.",
];

describe("mechanical truth packets", () => {
  it("every prohibited claim has an unsafe example that it catches (no silent pattern)", () => {
    // Read the ids from the module source so a newly added pattern without an
    // unsafe example fails here instead of shipping untested.
    const src = readFileSync(new URL("./mechanicalTruth.ts", import.meta.url), "utf8");
    const ids = [...src.matchAll(/^\s+id: "([a-z0-9_]+)",$/gm)].map((m) => m[1]);
    expect(ids.length).toBeGreaterThanOrEqual(10);
    expect(Object.keys(UNSAFE).sort()).toEqual([...ids].sort());
    for (const [id, sentence] of Object.entries(UNSAFE)) {
      expect(mechanicalTruthViolations(sentence).map((v) => v.id), sentence).toContain(id);
    }
  });

  it("correct statements pass", () => {
    for (const s of SAFE) expect(mechanicalTruthViolations(s), s).toEqual([]);
  });

  it("no approved reel pack, concept, blog or guide in the repo trips a packet", () => {
    const files = execSync(
      "git ls-files docs/reel-packs shared/absurdityConcepts.ts shared/blog.ts shared/guides.ts shared/seo-pages.ts shared/tireSizeContent.ts server/cron/jobs/dailyReelPost.ts",
      { encoding: "utf8", cwd: new URL("..", import.meta.url).pathname },
    ).split("\n").filter(Boolean);
    expect(files.length).toBeGreaterThan(300);
    const hits: string[] = [];
    for (const f of files) {
      const text = readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
      for (const line of text.split("\n")) for (const v of mechanicalTruthViolations(line)) hits.push(`${f}: ${v.id}: ${v.match}`);
    }
    expect(hits).toEqual([]);
  });

  it("no packet claims a technician sign-off it does not have", () => {
    const src = readFileSync(new URL("./mechanicalTruth.ts", import.meta.url), "utf8");
    expect([...src.matchAll(/technicianApproval: ([^,\n]+),/g)].map((m) => m[1])).toEqual(Array(5).fill("null"));
  });

  it("the generator is told the packets before it writes (reelBriefGen system prompt)", () => {
    const fragment = buildTruthPacketFragment();
    expect(fragment).toContain("puncture repair:");
    expect(fragment).toContain("Never imply:");
    // The prohibited SENTENCES are never in the prompt, only their reasons.
    for (const sentence of Object.values(UNSAFE)) expect(fragment).not.toContain(sentence);
    const gen = readFileSync(new URL("../server/services/reelBriefGen.ts", import.meta.url), "utf8");
    expect(gen).toContain("${buildTruthPacketFragment()}");
  });
});

describe("wired into the reel publish door", () => {
  it("condemnedContentProblem refuses a script teaching an unsafe shortcut, from voiceover or on-screen text", () => {
    expect(condemnedContentProblem({ voiceover: "Good news: a plug is a permanent fix.", onScreenText: "" })).toMatch(/puncture repair truth packet/);
    expect(condemnedContentProblem({ voiceover: "", onScreenText: "4/32 is the legal minimum" })).toMatch(/tread depth truth packet/);
  });
  it("a correct script still passes the door", () => {
    expect(condemnedContentProblem({ voiceover: SAFE[0], onScreenText: "Tread nail: often fixable" })).toBeNull();
  });
});
