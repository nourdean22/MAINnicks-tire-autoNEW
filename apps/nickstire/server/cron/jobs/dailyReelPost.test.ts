import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { checkReviewReply } from "@shared/reviewReplyQa";
import {
  MANIFEST,
  runDailyReelPost,
  reelPublishPlatforms,
  facebookLiveWithoutInstagram,
  PARKED_QA_GATES,
  RETRYABLE_QA_GATES,
} from "./dailyReelPost";

describe("dailyReelPost", () => {
  it("covers reels 5-30 in order (26 reels)", () => {
    expect(MANIFEST.length).toBe(26);
    expect(MANIFEST[0].reel).toBe(5);
    expect(MANIFEST.at(-1)!.reel).toBe(30);
    expect(MANIFEST.map((m) => m.reel)).toEqual(Array.from({ length: 26 }, (_, i) => i + 5));
  });

  it("every caption passes the reel claim-safety gate (zero blockers, incl. no-price)", () => {
    // publishToSocial gates reels on checkReviewReply(...).filter(block). A blocked
    // caption would refuse the post and stall the queue — so all 26 must be clean.
    for (const { reel, caption } of MANIFEST) {
      const blockers = checkReviewReply(caption).filter((f) => f.severity === "block");
      expect(blockers, `reel${reel} blocked: ${JSON.stringify(blockers)}`).toEqual([]);
    }
  });

  it("is a hard no-op when REEL_AUTOPOST_ENABLED is not 'true'", async () => {
    const prev = process.env.REEL_AUTOPOST_ENABLED;
    delete process.env.REEL_AUTOPOST_ENABLED;
    const r = await runDailyReelPost();
    expect(r.recordsProcessed).toBe(0);
    expect(r.details).toContain("disabled");
    if (prev !== undefined) process.env.REEL_AUTOPOST_ENABLED = prev;
  });

  // FAIL-CLOSED EVIDENCE FOR THE BACKLOG DRAIN (2026-08-28).
  // The drain lets the job publish an "assembled" reel from a PREVIOUS day, which
  // is new publishing reach: before this change the date-scoped lookup meant an
  // orphaned job could never be selected, so it could never post. The safety
  // property is that the drain sits BEHIND the same authority gate as everything
  // else - it must be unreachable when REEL_AUTOPOST_ENABLED is not "true", even
  // though 10 drainable jobs exist in prod right now. Asserted by ordering: the
  // enable gate is the first statement in runDailyReelPost, so a disabled run
  // returns before the DB is opened and the drain query is never issued.
  it("the backlog drain is UNREACHABLE when autopost is disabled", async () => {
    const prev = process.env.REEL_AUTOPOST_ENABLED;
    for (const bad of [undefined, "false", "1", "TRUE", ""]) {
      if (bad === undefined) delete process.env.REEL_AUTOPOST_ENABLED;
      else process.env.REEL_AUTOPOST_ENABLED = bad;
      const r = await runDailyReelPost();
      expect(r.recordsProcessed).toBe(0);
      // "disabled" proves it returned at the authority gate - not at the hour
      // gate, not after selecting a drainable job.
      expect(r.details).toContain("disabled");
      expect(r.details).not.toContain("DRAINED");
    }
    if (prev !== undefined) process.env.REEL_AUTOPOST_ENABLED = prev;
    else delete process.env.REEL_AUTOPOST_ENABLED;
  });
});

// NT-001 · the shadow-judge input builder must return something judgeable for
// EVERY payload shape — a 70KB brief, a truncated one, or garbage. A throw
// here would look like "judge lane flaky" while actually being a JSON edge.
import { buildReelShadowJudgeInput } from "./dailyReelPost";

describe("buildReelShadowJudgeInput (shadow judge, log-only)", () => {
  const base = { id: 42, briefId: "autopost-2026-08-13", caption: "Hook line\nBody line #tags" };

  it("uses the brief's topic + visual identity when the payload parses", () => {
    const input = buildReelShadowJudgeInput({
      ...base,
      payload: JSON.stringify({ topic: "Brake squeal warning", archetype: "proof", objectCharacter: "CHECK-01" }),
    });
    expect(input.concept.title).toBe("Brake squeal warning");
    expect(input.concept.visualIdea).toBe("proof · CHECK-01");
    expect(input.concept.hook).toBe("Hook line");
    expect(input.campaignAsk).toContain("job 42");
  });

  it("NEVER throws on unparseable payload — judges on the caption alone", () => {
    const input = buildReelShadowJudgeInput({ ...base, payload: "{truncated garbage" });
    expect(input.concept.title).toBe("autopost-2026-08-13");
    expect(input.concept.coreIdea).toContain("Hook line");
  });

  it("survives a null payload and an empty caption (worst assembled row)", () => {
    const input = buildReelShadowJudgeInput({ id: 7, briefId: "autopost-x", payload: null, caption: "" });
    expect(input.concept.title).toBe("autopost-x");
    // Empty caption falls back to the title so the judge always has a text.
    expect(input.concept.coreIdea).toBe("autopost-x");
    expect(input.concept.hook.length).toBeGreaterThan(0);
  });
});

// Facebook cross-post (armed 2026-10-01). The cron used to send ["instagram"]
// only, so a reel never reached the Page as video. Two pure decisions pin it.
describe("reelPublishPlatforms (REEL_FB_CROSSPOST_ENABLED)", () => {
  it("is Instagram-only unless the flag is exactly 'true'", () => {
    for (const bad of [undefined, "false", "1", "TRUE", "yes", ""]) {
      expect(reelPublishPlatforms({ REEL_FB_CROSSPOST_ENABLED: bad } as NodeJS.ProcessEnv)).toEqual(["instagram"]);
    }
  });
  it("adds Facebook AFTER Instagram when armed (positive control)", () => {
    expect(reelPublishPlatforms({ REEL_FB_CROSSPOST_ENABLED: "true" } as NodeJS.ProcessEnv)).toEqual(["instagram", "facebook"]);
  });
});

describe("facebookLiveWithoutInstagram (partial publish must PARK, never retry)", () => {
  it("names the live Facebook post when IG failed cleanly", () => {
    expect(facebookLiveWithoutInstagram([
      { platform: "facebook", success: true, postId: "fb_123" },
      { platform: "instagram", success: false },
    ])).toBe("fb_123");
  });
  it("still parks when FB succeeded without returning an id", () => {
    expect(facebookLiveWithoutInstagram([{ platform: "facebook", success: true }, { platform: "instagram", success: false }])).toBe("(no id returned)");
  });
  it("parks an ambiguous Facebook publish too: the finish call got no answer, so the reel may be live", () => {
    const id = facebookLiveWithoutInstagram([
      { platform: "facebook", success: false, ambiguous: true, postId: "vid_7" },
      { platform: "instagram", success: false },
    ]);
    expect(id).toContain("vid_7");
    expect(id).toContain("may be live");
    // Instagram live is still the authority: nothing to park.
    expect(facebookLiveWithoutInstagram([
      { platform: "facebook", success: false, ambiguous: true, postId: "vid_7" },
      { platform: "instagram", success: true, postId: "ig_1" },
    ])).toBeNull();
  });
  it("is null when IG succeeded, when FB failed, or when FB was not attempted", () => {
    expect(facebookLiveWithoutInstagram([{ platform: "facebook", success: true, postId: "x" }, { platform: "instagram", success: true, postId: "y" }])).toBeNull();
    expect(facebookLiveWithoutInstagram([{ platform: "facebook", success: false }, { platform: "instagram", success: false }])).toBeNull();
    expect(facebookLiveWithoutInstagram([{ platform: "instagram", success: false }])).toBeNull();
  });
});

/**
 * needs_review waits on a human ("operator review required", qualityGate.ts),
 * so it reads identically on every pulse. Before 2026-10-16 it was not parked:
 * job 2070013 (one unrecognised critic code dropped) was selected by the drain
 * on 149 consecutive pulses, 2026-10-13 22:08Z to 2026-10-15 11:10Z, and
 * production never ran on 10-14 (both slots) or 10-15 06:00 ET.
 */
describe("parked QA gates: what the drain skips without re-asking", () => {
  // The exact predicate the drain and today's-job pre-filters apply.
  const skippedByPreFilter = (gate: string) => PARKED_QA_GATES.has(gate) && !RETRYABLE_QA_GATES.has(gate);

  it("skips needs_review, reject and stock_fallback", () => {
    for (const gate of ["needs_review", "reject", "stock_fallback"]) expect(skippedByPreFilter(gate), gate).toBe(true);
  });

  it("keeps needs_review out of the retryable set (no spend path re-asks it)", () => {
    expect(RETRYABLE_QA_GATES.has("needs_review")).toBe(false);
    expect([...RETRYABLE_QA_GATES]).toEqual(["needs_paid_repair"]);
  });

  it("never skips the gates that clear by themselves, nor needs_paid_repair", () => {
    for (const gate of ["auto_repair", "unavailable", "disabled", "needs_paid_repair"]) {
      expect(skippedByPreFilter(gate), gate).toBe(false);
    }
  });
});

/**
 * The funds hold (2026-10-16) is only worth anything if it runs BEFORE the run
 * spends or moves: brief building (LLM calls), the reservation, and the
 * rotation-cursor advance. The helper itself is tested in
 * services/reelProviderFunds.test.ts; this pins where the cron consults it.
 */
describe("the provider funds hold sits before any spend or cursor move", () => {
  const SRC = readFileSync(path.join(__dirname, "dailyReelPost.ts"), "utf8");
  const at = (needle: string) => {
    const i = SRC.indexOf(needle);
    expect(i, needle).toBeGreaterThan(-1);
    return i;
  };
  it("is consulted after the READY-buffer early return and before brief, enqueue and cursor writes", () => {
    const hold = at("const funds = await readProviderFundsHold();");
    expect(hold).toBeGreaterThan(at('if (readyDecision !== "refill")'));
    expect(hold).toBeLessThan(at("prepared = await prepareCleanReelBrief("));
    expect(hold).toBeLessThan(at('await enqueueReelJob(brief, "cron"'));
    // Nothing between the production-hour gate and the hold writes a cursor or KV.
    const before = SRC.slice(at("not production hour"), hold);
    for (const writer of ["setApprovedPackProgress(", "setAutopostProgress(", "advancePastRefusedPack(", "setKv("]) {
      expect(before, writer).not.toContain(writer);
    }
    // A hold returns before anything below it runs.
    const block = SRC.slice(hold, SRC.indexOf("if (funds.unknown)", hold));
    // Holds on a KNOWN shortfall only (an inverted condition would hold every
    // funded run and spend on every dry one).
    expect(block).toMatch(/\n\s*if \(funds\.hold\) \{/);
    expect(block).toContain("return {");
    expect(block).toContain("rotation not advanced");
  });
});
