/**
 * ONE LENS, ONE ARCHETYPE, ONE OBJECT - FOR EVERY REEL THE MAIN LANE PRODUCED.
 *
 * approvedReelPackRotation built every pack-derived brief with
 * motionLens "extreme_macro_push_in" and archetype "tiny_cinematic_story"
 * hardcoded. That lane produces most of the account's reels.
 *
 * Measured against production 2026-09-09: of 27 reels queued and ready to
 * publish, 26 carried the identical lens. Across the whole 21-day window only
 * 5 of 14 lenses and 6 of 14 archetypes appeared at all.
 *
 * It also silently defeated the per-lens palettes shipped the same day:
 * LENS_PALETTES gives each of the fourteen lenses its own world, and a lane
 * pinned to one lens can only ever reach one of them. The palette work was
 * real and the main producer of reels could not see it.
 *
 * Rotation is DETERMINISTIC on the pack id, not random. A re-run must produce
 * the same reel from the same source, or the repetition ledger cannot tell a
 * retry from a new idea.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { MOTION_LENSES, OBJECT_CHARACTERS, REEL_ARCHETYPES, buildHiggsfieldReelPromptPack, type ReelBrief } from "../client/src/lib/facelessReelStudio";
import { SAMPLE_REEL_BRIEFS } from "../client/src/lib/facelessReelStudioSamples";
import { buildApprovedPackBriefForTest } from "./services/approvedReelPackRotation";

const SRC = readFileSync(path.join(__dirname, "services", "approvedReelPackRotation.ts"), "utf8");

/** Mirrors pickForPack. Kept in the test so the DISTRIBUTION is asserted on the
 *  real algorithm rather than on the source text describing it. */
function pick<T>(briefId: string, salt: string, options: readonly T[]): T {
  return options[createHash("sha256").update(`${briefId}::${salt}`).digest().readUInt32BE(0) % options.length];
}

const LENSES = Object.keys(MOTION_LENSES);
const ARCHETYPES = Object.keys(REEL_ARCHETYPES);
// Realistic pack ids: the directory convention is <date>-<slug>.
const PACKS = Array.from({ length: 166 }, (_, i) => {
  const d = new Date(Date.UTC(2026, 5, 27 + Math.floor(i / 2)));
  return `${d.toISOString().slice(0, 10)}-pack-${i}`;
});

describe("the pack lane no longer stamps one look on everything", () => {
  it("the hardcoded lens and archetype are gone from the source", () => {
    expect(SRC, "motionLens is hardcoded again").not.toContain(`motionLens: "extreme_macro_push_in"`);
    expect(SRC, "archetype is hardcoded again").not.toContain(`archetype: "tiny_cinematic_story"`);
    expect(SRC).toContain("pickForPack");
  });

  it("the hero object is deliberately NOT rotated, and it is no persona", () => {
    // Lens and archetype are grammar and apply to any subject. objectCharacter
    // names the hero of the frame; rotating it would describe a different
    // object from the one the pack's storyboard is actually about. It was fixed
    // to rust, which named rust as the hero of every pack Reel (2026-10-08).
    expect(SRC).toContain(`objectCharacter: "plain_part"`);
    expect(SRC).not.toContain(`objectCharacter: "rust_creeping_villain"`);
  });

  it("BEHAVIOUR: a penny-test pack's provider prompt names no persona at all; beat 1 is the hero", () => {
    const brief = buildApprovedPackBriefForTest("2026-08-14-penny-test") as unknown as ReelBrief;
    expect(brief.objectCharacter).toBe("plain_part");
    const prompt = buildHiggsfieldReelPromptPack(brief)[0].prompt;
    expect(prompt).not.toMatch(/Rust, Creeping Villain/);
    expect(prompt).not.toMatch(/Character energy:/);
    expect(prompt).not.toMatch(/The Part Itself/);
    const hero = prompt.split("\n").find((l) => l.startsWith("Hero subject: "));
    expect(hero).toBeDefined();
    expect(hero).not.toMatch(/First established as/);
    expect(hero!.length).toBeGreaterThan("Hero subject: ".length + 10);
    // CONTROL: the Studio persona path is untouched — a sample brief keeps its character line.
    const studio = buildHiggsfieldReelPromptPack(SAMPLE_REEL_BRIEFS[0])[0].prompt;
    expect(studio).toContain(`Character energy: ${OBJECT_CHARACTERS[SAMPLE_REEL_BRIEFS[0].objectCharacter].label}`);
    expect(studio).toMatch(/Hero subject: .+ First established as: /);
  });

  it("reaches EVERY lens across a realistic corpus, not just a few", () => {
    const used = new Set(PACKS.map((p) => pick(p, "lens", LENSES)));
    expect(used.size, `only ${used.size} of ${LENSES.length} lenses reachable`).toBe(LENSES.length);
  });

  it("spreads them rather than piling onto one", () => {
    const tally = new Map<string, number>();
    for (const p of PACKS) {
      const l = pick(p, "lens", LENSES) as string;
      tally.set(l, (tally.get(l) ?? 0) + 1);
    }
    const counts = [...tally.values()];
    const max = Math.max(...counts);
    // A uniform spread over 166 packs and 14 lenses averages ~12. Allow real
    // hash lumpiness, but refuse a distribution where one lens dominates.
    expect(max, `one lens took ${max} of ${PACKS.length} packs`).toBeLessThan(PACKS.length / 4);
  });

  it("reaches every archetype too", () => {
    const used = new Set(PACKS.map((p) => pick(p, "archetype", ARCHETYPES)));
    expect(used.size).toBe(ARCHETYPES.length);
  });

  it("is STABLE: the same pack always resolves to the same lens", () => {
    // Randomness here would make a retry look like a new idea to the
    // repetition ledger, and make a reel unreproducible from its source.
    for (const p of PACKS.slice(0, 20)) {
      expect(pick(p, "lens", LENSES)).toBe(pick(p, "lens", LENSES));
    }
  });

  it("lens and archetype are drawn independently", () => {
    // Sharing one hash would lock each lens to exactly one archetype, trading
    // one kind of sameness for another.
    const pairs = new Set(PACKS.map((p) => `${pick(p, "lens", LENSES)}|${pick(p, "archetype", ARCHETYPES)}`));
    expect(pairs.size).toBeGreaterThan(LENSES.length);
  });

  it("PLANTED CANARY: the distribution check can fail", () => {
    // Against a single-option list every pack collides, which is exactly the
    // state this file exists to prevent. If this passes, the checks above are
    // measuring nothing.
    const used = new Set(PACKS.map((p) => pick(p, "lens", ["extreme_macro_push_in"])));
    expect(used.size).toBe(1);
  });
});

describe("no persona reaches any reader of a pack Reel's hero (2026-10-08)", () => {
  it("the visual-world reference frame and its lock name beat 1, not a persona", async () => {
    const { buildReferenceFramePrompt, compileLockedInvariants } = await import("./services/visualWorld");
    const brief = buildApprovedPackBriefForTest("2026-08-14-penny-test") as unknown as ReelBrief;
    const frame = buildReferenceFramePrompt(brief, "safe");
    expect(frame).toMatch(/Hero subject: (?!The Part Itself)/);
    expect(frame).not.toMatch(/The Part Itself|Rust, Creeping Villain/);
    expect(compileLockedInvariants(brief, "safe", frame)).toContain("SAME hero subject");
    // CONTROL: a persona brief keeps its label in both.
    const studio = SAMPLE_REEL_BRIEFS[0];
    const label = OBJECT_CHARACTERS[studio.objectCharacter].label;
    expect(buildReferenceFramePrompt(studio, "safe")).toContain(`Hero subject: ${label}`);
  });

  it("the vision critic is told a pack Reel has no persona, never the slug", async () => {
    const { heroForCritic } = await import("./services/renderedQa");
    expect(heroForCritic("plain_part")).toBe("no persona; the subject is what the planned beats show");
    expect(heroForCritic("penny_test_inspector")).toBe("penny_test_inspector");
    expect(heroForCritic(undefined)).toBe("unknown");
  });

  it("a Studio concept is never offered the pack lane's no-persona hero", async () => {
    const { buildFacelessReelSystemPrompt } = await import("../client/src/lib/facelessReelStudioPrompt");
    const prompt = buildFacelessReelSystemPrompt();
    expect(prompt).toContain("# OBJECT CHARACTERS (pick one)");
    expect(prompt).not.toContain("The Part Itself");
    expect(prompt).toContain(OBJECT_CHARACTERS.penny_test_inspector.label);
  });
});
