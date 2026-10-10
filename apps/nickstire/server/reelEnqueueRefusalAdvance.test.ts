/**
 * A pack refused at ENQUEUE preflight must not jam the rotation.
 *
 * This is the 089823177 deadlock returning through a different door, found by
 * review P1 on #2171. The original was: the cursor advanced only on a
 * successful publish, so a pack that could never publish froze the rotation and
 * every day regenerated the same topic. That was fixed by advancing past
 * TERMINALLY REFUSED jobs.
 *
 * The door this reopened: `advancePastRefusedPack` operates on a persisted job
 * row, but `enqueueReelJob` runs `runReelPreflight` and THROWS before persisting
 * anything. So a refusal that happens at enqueue produced no job, moved no
 * cursor, and left the same pack to be re-picked on every later pulse — a
 * throwing cron, forever, on one bad pack.
 *
 * The 35s-ceiling change made it reachable rather than theoretical: the new
 * voiceover-fits-render gate refuses packs that previously enqueued, including
 * one the coverage test records as passing before the gate and failing after.
 *
 * These tests assert the SOURCE contract, because the alternative is booting the
 * whole cron against a mocked DB to observe one branch. Each assertion is
 * bounded to the enqueue block and paired with a positive control, so a moved
 * anchor fails loudly instead of passing vacuously.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ReelPreflightBlockedError } from "./services/reelPipeline";
import { briefEnqueueRefusals } from "./services/reelEnqueueRefusals";
import { SAMPLE_REEL_BRIEFS } from "../client/src/lib/facelessReelStudioSamples";
import type { ReelBrief } from "../client/src/lib/facelessReelStudio";

const CRON = readFileSync(path.join(__dirname, "cron", "jobs", "dailyReelPost.ts"), "utf8");
const PIPELINE = readFileSync(path.join(__dirname, "services", "reelPipeline.ts"), "utf8");
const ROTATION = readFileSync(path.join(__dirname, "services", "approvedReelPackRotation.ts"), "utf8");

/** The enqueue try/catch, bounded to itself. */
function enqueueBlock(): string {
  const i = CRON.indexOf("let jobId: number;");
  expect(i, "enqueue block not found — anchor moved").toBeGreaterThan(-1);
  const rest = CRON.slice(i);
  const end = rest.indexOf("log.info(`Enqueued new dynamic reel job");
  expect(end, "enqueue block end not found").toBeGreaterThan(-1);
  return rest.slice(0, end);
}

describe("the refusal is typed, so the caller can tell it from an outage", () => {
  it("preflight throws a distinguishable error, not a bare Error", () => {
    // Matching on message text would swallow the wrong failure the first time
    // the wording changed.
    expect(PIPELINE).toContain("throw new ReelPreflightBlockedError(");
    expect(PIPELINE).not.toContain("throw new Error(`Reel preflight blocked");
  });

  it("the error carries the blocking reasons, so the skip line can name them", () => {
    const e = new ReelPreflightBlockedError(["voiceover too long", "no mechanic truth"]);
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe("ReelPreflightBlockedError");
    expect(e.blocking).toEqual(["voiceover too long", "no mechanic truth"]);
    expect(e.message).toContain("Reel preflight blocked (2)");
    expect(e.message).toContain("voiceover too long");
  });
});

describe("every content verdict inside enqueueReelJob is typed (2026-10-08)", () => {
  // The catch above advances the rotation only for ReelPreflightBlockedError.
  // Four content refusals in enqueueReelJob threw a bare Error — the condemned
  // script, the declared-source / no-subject hold, the episode contract and the
  // over-long caption — so an approved pack refused by any of them would have
  // failed the cron every production hour without moving the cursor. Only an
  // infrastructure fault may throw a bare Error here.
  const INFRA_ONLY = ['"DB not available"', '"REEL_EPISODE_CONTRACT_INVALID: '];
  const bareThrows = (src: string): string[] => {
    const a = src.indexOf("export async function enqueueReelJob");
    const b = src.indexOf("\nexport async function processNextReelJob", a);
    expect(a, "enqueueReelJob not found").toBeGreaterThan(-1);
    expect(b, "enqueueReelJob end not found").toBeGreaterThan(a);
    const body = src.slice(a, b);
    return [...body.matchAll(/throw new Error\(\s*([^\n]{0,60})/g)].map((m) => m[1]);
  };
  const isInfra = (arg: string) => INFRA_ONLY.some((p) => arg.startsWith(p));

  it("only infrastructure faults throw a bare Error", () => {
    const bare = bareThrows(PIPELINE);
    expect(bare.length, "the scan found no throw at all — anchor moved").toBeGreaterThan(0);
    expect(bare.filter((arg) => !isInfra(arg))).toEqual([]);
    for (const reason of ["REEL_SCRIPT_CONDEMNED", "generationHoldReason(blocked, \"enqueue\")", "Episode contract blocked", "over Instagram's"]) {
      expect(PIPELINE, reason).toContain(reason);
    }
  });

  // DRIFT ALARM (2026-10-09): the miner's brief loop and pack-variant
  // eligibility predict these refusals with reelEnqueueRefusals.
  // briefEnqueueRefusals. A new typed refusal here that it does not mirror
  // would cost the miner its day and let one variant arm decide which packs air.
  const typedRefusals = (src: string): string[] => {
    const a = src.indexOf("export async function enqueueReelJob");
    const b = src.indexOf("\nexport async function processNextReelJob", a);
    expect(a, "enqueueReelJob not found").toBeGreaterThan(-1);
    expect(b, "enqueueReelJob end not found").toBeGreaterThan(a);
    return [...src.slice(a, b).matchAll(/throw new ReelPreflightBlockedError\(\s*([^\n]{0,40})/g)].map((m) => m[1].trim());
  };
  // The first 40 characters of each throw's argument.
  const MIRRORED = [
    "pre.blocking.map((f) => f.message));", // runReelPreflight
    "[`REEL_SCRIPT_CONDEMNED: ${condemned}`])", // condemnedContentProblem
    "[generationHoldReason(blocked, \"enqueue\"", // beatsTheGeneratorMustNotRender
    "[", // the caption limit (its message starts on the next line)
    "[`REEL_ASK_INCONSISTENT: ${askMismatch}`", // captionAskMismatch (2026-10-10): the caption's ask vs the declared end card
  ];
  const NEEDS_CONTEXT = [
    "[`Episode contract blocked (${pre.blocks", // needs the day's claim packet
    "[reason]);", // REAL_ASSET_NOT_BINDABLE (2026-10-09): needs the media registry row the beat names — a DB read, not a brief-only verdict
    "[reason]);", // HERO_STILL_NOT_BINDABLE (2026-10-10): needs the media registry row the brief's heroAssetId names — a DB read, not a brief-only verdict
  ];

  it("every typed refusal in enqueueReelJob is mirrored by briefEnqueueRefusals or named as needing the day's context", () => {
    const found = typedRefusals(PIPELINE);
    expect(found.length, "the scan found no typed refusal — anchor moved").toBeGreaterThan(0);
    expect([...found].sort(), "a new typed refusal: add it to server/services/reelEnqueueRefusals.ts, or to NEEDS_CONTEXT with why").toEqual([...MIRRORED, ...NEEDS_CONTEXT].sort());
    const helper = readFileSync(path.join(__dirname, "services", "reelEnqueueRefusals.ts"), "utf8");
    for (const call of ["runReelPreflight(", "condemnedContentProblem(", "beatsTheGeneratorMustNotRender(", "CAPTION_LIMIT", "HASHTAG_CAP", "captionAskMismatch("]) expect(helper, call).toContain(call);
  });

  // Job 2070005 (2026-10-10): generateReelBriefAI declared `profile` and
  // captioned "Send this to someone whose tires look smooth." Enqueue accepted
  // it, five clips were paid for, and assembly refused the mismatch three times
  // in one pulse. The helper must now predict that refusal from the brief alone.
  describe("the caption's ask must be the end card's ask, judged before spend", () => {
    const withCaption = (caption: string, ask: ReelBrief["ask"]): ReelBrief => {
      const b = structuredClone(SAMPLE_REEL_BRIEFS[0]);
      b.selectedCaption = caption;
      b.ask = ask;
      return b;
    };
    const PROD_CAPTION = "Smooth tires in Cleveland snow are a slide waiting to happen. Send this to someone whose tires look smooth. #UsedTiresEuclid";

    it("CATCHES the production shape: profile end card, send-this caption", () => {
      const refusals = briefEnqueueRefusals(withCaption(PROD_CAPTION, { kind: "profile" }));
      expect(refusals.join("\n")).toMatch(/two different asks on two/);
      expect(refusals.join("\n")).toMatch(/send-this-to/);
    });

    it("CONTROL: the same brief with the sentence removed is not refused on the ask", () => {
      const refusals = briefEnqueueRefusals(withCaption("Smooth tires in Cleveland snow are a slide waiting to happen. #UsedTiresEuclid", { kind: "profile" }));
      expect(refusals.filter((r) => /ask/i.test(r))).toEqual([]);
    });

    it("CONTROL: a send caption under a declared `save` end card is the same ask, not refused", () => {
      const refusals = briefEnqueueRefusals(withCaption(PROD_CAPTION, { kind: "save" }));
      expect(refusals.filter((r) => /two different asks/.test(r))).toEqual([]);
    });
  });

  it("CONTROL: a new typed refusal the helper does not know about is reported", () => {
    const planted = PIPELINE.replace(
      "throw new ReelPreflightBlockedError([`REEL_SCRIPT_CONDEMNED: ${condemned}`]);",
      "throw new ReelPreflightBlockedError([`REEL_SCRIPT_CONDEMNED: ${condemned}`]);\n    throw new ReelPreflightBlockedError([`NEW_RULE`]);",
    );
    expect(planted).not.toBe(PIPELINE);
    expect(typedRefusals(planted)).toContain("[`NEW_RULE`]);");
    expect([...typedRefusals(planted)].sort()).not.toEqual([...MIRRORED, ...NEEDS_CONTEXT].sort());
  });

  it("CONTROL: a content refusal written as a bare Error is caught by the scan", () => {
    const planted = PIPELINE.replace(
      "throw new ReelPreflightBlockedError([generationHoldReason(blocked, \"enqueue\")]);",
      "throw new Error(generationHoldReason(blocked, \"enqueue\"));",
    );
    expect(planted).not.toBe(PIPELINE);
    expect(bareThrows(planted).filter((arg) => !isInfra(arg))).toEqual(['generationHoldReason(blocked, "enqueue"));']);
  });
});

describe("an approved pack refused at enqueue advances the rotation", () => {
  it("catches the refusal and moves the cursor past that pack", () => {
    const b = enqueueBlock();
    expect(b).toContain("ReelPreflightBlockedError");
    expect(b).toContain("advanceRotationPastRefusedPack");
    expect(b).toContain("jobPackSlug: approvedPack.slug");
  });

  it("advances WITHOUT a jobId, because no job row exists yet", () => {
    // The whole defect: the existing advance path needs a persisted job, and an
    // enqueue-time refusal never produces one. `jobId` is log-only, so the
    // rotation helper accepts its absence deliberately.
    expect(ROTATION).toContain("jobId?: number | null;");
    const b = enqueueBlock();
    const call = b.slice(b.indexOf("advanceRotationPastRefusedPack"));
    expect(call.slice(0, call.indexOf("})"))).not.toContain("jobId:");
  });

  it("returns a legible skip rather than rethrowing", () => {
    const b = enqueueBlock();
    expect(b).toContain("rotation advanced");
    expect(b).toMatch(/return\s*\{[\s\S]*recordsProcessed: 0/);
  });
});

describe("what must NOT change — the fail-loud half", () => {
  it("rethrows anything that is not a preflight refusal", () => {
    // A provider outage or DB fault is TRANSIENT and must stay loud. This is the
    // load-bearing half: a catch that swallowed everything would turn every
    // real fault into a silent skip, which is the failure mode this repo keeps
    // rediscovering.
    expect(enqueueBlock()).toContain("if (!(err instanceof ReelPreflightBlockedError)) throw err;");
  });

  it("does not catch with a bare `catch (err) { return }` anywhere in the block", () => {
    const b = enqueueBlock();
    expect(b).not.toMatch(/catch\s*\([^)]*\)\s*\{\s*return/);
  });

  it("the MINED lane does not touch the cursor — it has no pack to advance past", () => {
    // Positive control that the two lanes are handled differently rather than
    // one branch accidentally covering both.
    const b = enqueueBlock();
    expect(b).toContain("if (!approvedPack)");
    const mined = b.slice(b.indexOf("if (!approvedPack)"), b.indexOf("advanceRotationPastRefusedPack"));
    expect(mined).not.toContain("advanceRotationPastRefusedPack");
  });

  it("the three PERSISTED terminal-refusal advances still exist", () => {
    // The earlier deadlock fix must survive this one. If these vanished, the
    // rotation would jam again after a job WAS created.
    for (const reason of ["condemned script (content)", "claim audit veto", "disclosure veto"]) {
      expect(CRON, `lost the advance for: ${reason}`).toContain(reason);
    }
  });
});
