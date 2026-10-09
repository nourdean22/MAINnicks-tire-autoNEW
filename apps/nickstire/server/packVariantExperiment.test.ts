/**
 * Pack-variant experiment arms (06-EXPERIMENTS #1 and #4), 2026-10-08.
 *
 * An arm is an operator-approved VARIANT of an approved pack, at
 * docs/reel-packs/<slug>/variants/<armId>/brief.json, and the approval is the
 * APPROVED_PACK_VARIANTS list, never the folder. These tests drive the real
 * loader against a temporary packs directory (REEL_PACKS_DIR), so no variant is
 * committed and none is approved: the mechanism ships inert.
 */
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sliceBlock } from "./testUtils/sourceBlock";
import { assignArm, buildExperimentPreset } from "../shared/contentExperiments";
import { mechanicalTruthViolations } from "../shared/mechanicalTruth";
import {
  APPROVED_PACK_VARIANTS,
  approvedVariantSnapshot,
  buildBriefFromApprovedProductionPack,
  eligibleVariantPacks,
  loadApprovedProductionPack,
} from "./services/approvedReelPackRotation";
import { briefEnqueueRefusals } from "./services/reelEnqueueRefusals";
import type { ReelBrief } from "../client/src/lib/facelessReelStudio";

const SLUG = "2026-08-14-penny-test";
const REPO_PACK = path.join(__dirname, "..", "docs", "reel-packs", SLUG);
const ARMS = ["open-reveal", "open-question"];
const EXP = "opening-mechanism-v1";

let dir = "";
const prevEnv = process.env.REEL_PACKS_DIR;

/** A variant = the base brief with beat 1's card (and optionally its shot) rewritten. */
function writeVariant(arm: string, onScreenText: string, visual?: string) {
  const base = JSON.parse(readFileSync(path.join(REPO_PACK, "brief.json"), "utf8"));
  base.storyboardBeats[0].onScreenText = onScreenText;
  if (visual !== undefined) base.storyboardBeats[0].visual = visual;
  const vdir = path.join(dir, SLUG, "variants", arm);
  mkdirSync(vdir, { recursive: true });
  writeFileSync(path.join(vdir, "brief.json"), JSON.stringify(base, null, 2));
}

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "reel-packs-"));
  cpSync(REPO_PACK, path.join(dir, SLUG), { recursive: true });
  process.env.REEL_PACKS_DIR = dir;
});
afterEach(() => {
  if (prevEnv === undefined) delete process.env.REEL_PACKS_DIR;
  else process.env.REEL_PACKS_DIR = prevEnv;
  rmSync(dir, { recursive: true, force: true });
});

describe("the loader reads a variant as its own reviewed bytes under the parent's pack id", () => {
  it("packId stays the slug; sourcePath and contentSha256 describe the variant", () => {
    writeVariant("open-reveal", "WATCH THE COIN");
    const base = loadApprovedProductionPack(SLUG)!;
    const variant = loadApprovedProductionPack(SLUG, "open-reveal")!;
    expect(variant.packId).toBe(SLUG);
    expect(variant.sourcePath).toBe(`apps/nickstire/docs/reel-packs/${SLUG}/variants/open-reveal`);
    expect(variant.contentSha256).not.toBe(base.contentSha256);
    expect((variant.parsed.storyboardBeats as Array<{ onScreenText: string }>)[0].onScreenText).toBe("WATCH THE COIN");
  });

  it("an arm id that could leave the variants folder, or a missing variant, reads nothing", () => {
    expect(loadApprovedProductionPack(SLUG, "../../etc")).toBeNull();
    expect(loadApprovedProductionPack(SLUG, "Open_Reveal")).toBeNull();
    expect(loadApprovedProductionPack(SLUG, "open-reveal")).toBeNull();
  });
});

describe("a pack joins only when EVERY arm is approved by name and builds", () => {
  const approved = { [EXP]: { [SLUG]: ARMS } };

  it("both arms approved and present: the drawn arm's variant is built", () => {
    writeVariant("open-reveal", "WATCH THE COIN");
    writeVariant("open-question", "IS YOUR TREAD LEGAL?");
    const snap = approvedVariantSnapshot(EXP, SLUG, "open-question", ARMS, approved)!;
    expect(snap.sourcePath.endsWith("/variants/open-question")).toBe(true);
    expect(approvedVariantSnapshot(EXP, SLUG, "open-reveal", ARMS, approved)!.sourcePath.endsWith("/variants/open-reveal")).toBe(true);
  });

  it("one arm that enqueue would refuse keeps the whole pack out, for both arms", () => {
    // A placeholder shot passes the builder but is held at enqueue (needs_subject);
    // if only that arm were dropped, the arm a day drew would decide whether the
    // pack aired or was skipped past.
    writeVariant("open-reveal", "WATCH THE COIN");
    writeVariant("open-question", "IS YOUR TREAD LEGAL?", "Extreme macro of the physical subject, slow push-in");
    expect(approvedVariantSnapshot(EXP, SLUG, "open-reveal", ARMS, approved)).toBeNull();
    expect(approvedVariantSnapshot(EXP, SLUG, "open-question", ARMS, approved)).toBeNull();
    // CONTROL: the same pair with a shot that names the coin is eligible.
    writeVariant("open-question", "IS YOUR TREAD LEGAL?", "Extreme macro of a copper coin pressed head-first into a tire tread groove");
    expect(approvedVariantSnapshot(EXP, SLUG, "open-reveal", ARMS, approved)).not.toBeNull();
  });

  it("folders without approval, half-approved pairs, a missing file or a foreign arm build the base pack", () => {
    writeVariant("open-reveal", "WATCH THE COIN");
    writeVariant("open-question", "IS YOUR TREAD LEGAL?");
    expect(approvedVariantSnapshot(EXP, SLUG, "open-reveal", ARMS, {})).toBeNull(); // the folder is not the approval
    expect(approvedVariantSnapshot(EXP, SLUG, "open-reveal", ARMS, { [EXP]: { [SLUG]: ["open-reveal"] } })).toBeNull();
    expect(approvedVariantSnapshot(EXP, SLUG, "other", ARMS, approved)).toBeNull();
    rmSync(path.join(dir, SLUG, "variants", "open-question"), { recursive: true });
    expect(approvedVariantSnapshot(EXP, SLUG, "open-reveal", ARMS, approved)).toBeNull();
  });

  it("only a rotation pack counts toward starting the experiment", () => {
    writeVariant("open-reveal", "WATCH THE COIN");
    writeVariant("open-question", "IS YOUR TREAD LEGAL?");
    expect(eligibleVariantPacks(EXP, ARMS, approved)).toEqual([SLUG]);
    // CONTROL: the same reviewed bytes under a slug the daily lane never selects.
    const OFF = "2099-01-01-not-in-rotation";
    cpSync(path.join(dir, SLUG), path.join(dir, OFF), { recursive: true });
    expect(approvedVariantSnapshot(EXP, OFF, "open-reveal", ARMS, { [EXP]: { [OFF]: ARMS } })).not.toBeNull();
    expect(eligibleVariantPacks(EXP, ARMS, { [EXP]: { [OFF]: ARMS } })).toEqual([]);
  });

  it("nothing is approved yet: the committed list is empty, so the mechanism ships inert", () => {
    expect(APPROVED_PACK_VARIANTS).toEqual({});
  });
});

describe("every approved variant passes the gates a pack passes (variants escape the top-level scans)", () => {
  /** Build + what enqueue refuses + a truth-claim scan of the reviewed files + same beat timings as the base. */
  const gateProblems = (slug: string, arm: string): string[] => {
    const base = loadApprovedProductionPack(slug);
    const variant = loadApprovedProductionPack(slug, arm);
    if (!base || !variant) return ["missing"];
    const brief = buildBriefFromApprovedProductionPack({ slug: slug as never, topic: "" }, variant, `gate-${arm}`, true);
    if (!brief) return ["the builder rejects it"];
    const problems: string[] = [];
    if (briefEnqueueRefusals(brief as unknown as ReelBrief).length) problems.push("refused at enqueue");
    const text = [variant.files.briefJson, variant.files.readme ?? ""].join("\n");
    if (mechanicalTruthViolations(text).length) problems.push("truth claim");
    const timings = (p: Record<string, unknown>) => JSON.stringify((p.storyboardBeats as Array<{ startSecond: number; endSecond: number }>).map((b) => [b.startSecond, b.endSecond]));
    if (timings(variant.parsed) !== timings(base.parsed)) problems.push("beat timings differ from the base");
    return problems;
  };

  it("the committed approvals (none yet) and a clean fixture pass", () => {
    process.env.REEL_PACKS_DIR = path.join(__dirname, "..", "docs", "reel-packs");
    for (const [experimentId, packs] of Object.entries(APPROVED_PACK_VARIANTS)) {
      for (const [slug, arms] of Object.entries(packs)) for (const arm of arms) expect(gateProblems(slug, arm), `${slug}/${arm}`).toEqual([]);
      // Every approved pack is one the daily lane can build from.
      for (const [slug, arms] of Object.entries(packs)) expect(eligibleVariantPacks(experimentId, arms), slug).toContain(slug);
    }
    process.env.REEL_PACKS_DIR = dir;
    writeVariant("open-question", "IS YOUR TREAD LEGAL?");
    expect(gateProblems(SLUG, "open-question")).toEqual([]);
  });

  it("CONTROL: a variant with a prohibited truth claim or moved timings is reported", () => {
    const base = JSON.parse(readFileSync(path.join(REPO_PACK, "brief.json"), "utf8"));
    base.storyboardBeats[0].narration = "Clear the codes and you will pass the E-Check.";
    base.storyboardBeats[0].onScreenText = "Clear the codes and you'll pass E-Check";
    base.storyboardBeats[0].endSecond = 3;
    base.storyboardBeats[1].startSecond = 3;
    const vdir = path.join(dir, SLUG, "variants", "open-reveal");
    mkdirSync(vdir, { recursive: true });
    writeFileSync(path.join(vdir, "brief.json"), JSON.stringify(base, null, 2));
    const problems = gateProblems(SLUG, "open-reveal");
    expect(problems).toContain("truth claim");
    expect(problems).toContain("refused at enqueue");
    expect(problems).toContain("beat timings differ from the base");
  });
});

describe("the variant arm is drawn independently of the lens arm", () => {
  const keys = Array.from({ length: 120 }, (_, i) => {
    const d = new Date(Date.UTC(2026, 9, 9) + i * 86_400_000);
    return `autopost-${d.toISOString().slice(0, 10)}`;
  });
  const opening = buildExperimentPreset("opening_mechanism_v1", "x");
  const direction = buildExperimentPreset("visual_direction_v1", "x");

  it("two 2-arm pack experiments do not split the same Reels the same way", () => {
    const agree = keys.filter((k) => opening.arms.indexOf(assignArm(opening, k)) === direction.arms.indexOf(assignArm(direction, k))).length;
    expect(agree).toBeGreaterThan(36);
    expect(agree).toBeLessThan(84);
    // Balanced enough to read: neither variant arm starves.
    const reveal = keys.filter((k) => assignArm(opening, k).armId === "open-reveal").length;
    expect(reveal).toBeGreaterThan(40);
    expect(reveal).toBeLessThan(80);
    // Deterministic: a retry re-derives the same arm.
    expect(assignArm(opening, keys[0])).toEqual(assignArm(opening, keys[0]));
  });

  it("CONTROL: without the mixed hash, two 2-arm experiments agree on every key (the aliasing it removes)", () => {
    const plain = { ...opening, primaryVariable: "visual_direction" as const, experimentId: "plain-copy" };
    const agree = keys.filter((k) => plain.arms.indexOf(assignArm(plain, k)) === direction.arms.indexOf(assignArm(direction, k))).length;
    expect(agree).toBe(120);
  });
});

describe("the daily lane builds the drawn variant and stamps the arms it applied", () => {
  const CRON = readFileSync(path.join(__dirname, "cron", "jobs", "dailyReelPost.ts"), "utf8");

  it("resolves both pack-build arms before the build, builds variant ?? base, and stamps appliedPackArms", () => {
    const b = sliceBlock(CRON, "const baseSnapshot = loadApprovedProductionPack(approvedPack.slug);", "prepared = { brief: packBrief", { label: "dailyReelPost pack branch" });
    const order = [
      "await visualDirectionForEpisode(briefId)",
      "await packVariantForEpisode(briefId)",
      "approvedVariantSnapshot(variantArm.applied.experimentId, approvedPack.slug, variantArm.applied.armId, variantArm.armIds)",
      "const snapshot = variantSnapshot ?? baseSnapshot;",
      "buildBriefFromApprovedProductionPack(approvedPack, snapshot, briefId, false, visual?.direction)",
      "appliedPackArms = appliedPackArms",
    ].map((needle) => b.indexOf(needle));
    for (const i of order) expect(i).toBeGreaterThan(-1);
    expect([...order].sort((x, y) => x - y)).toEqual(order);
    // A variant arm is stamped only when its variant was the one built.
    expect(b).toContain("...(variantSnapshot && variantArm ? [variantArm.applied] : [])");
  });
});
