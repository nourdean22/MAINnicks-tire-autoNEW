/**
 * The claim audit condemned SCRIPTS but keyed its veto to JOB IDS, so copying a
 * condemned script into a new row cleared it.
 *
 * This is not hypothetical. On 2026-08-30 three condemned jobs were regenerated
 * as 1830001-1830003. Measured against production payloads on 2026-09-07, every
 * one reproduced its antecedent verbatim (voiceover and on-screen similarity
 * 1.00), and `auditPublishBlock` returned null for all three because the ids
 * were new. Job 1830003 carried "In Ohio, it's an automatic fail for your
 * E-Check" - false in 81 of Ohio's 88 counties - into a queue whose only
 * remaining guard was an operator reading it.
 *
 * The three real scripts below are the fixtures. They are the actual
 * production payload text, so this suite fails if the gate stops recognising
 * the exact thing it was built for.
 */
import { describe, expect, it } from "vitest";
import {
  CONDEMNED_CONTENT_THRESHOLD,
  REEL_CLAIM_AUDIT,
  auditPublishBlock,
  condemnedContentProblem,
  textCondemnedEntries,
} from "@shared/reelClaimAudit";
import { ORIGINALITY_BLOCK_THRESHOLD } from "@shared/reelOriginality";

/** Verbatim from reel_jobs payloads, read from production 2026-09-07. */
const REGENERATED = {
  /** 1830001, superseding 1770001 - condemned for a BROKEN ASSET, not its claims. */
  treadBars: {
    voiceover:
      "Your tires have a built-in warning you've probably never seen. Little bars inside the grooves. When the tread wears down to them, they sit flush. That's the tire telling you it's time. No penny needed. If you're not sure, stop by and we'll take a look.",
    onScreenText:
      "Your tires have a built-in warning. Little bars inside the grooves. When the tread wears down to them, they sit flush. That's the tire telling you it's time. No penny needed. Send this to someone whose tires are looking smooth.",
  },
  /** 1830002, superseding 1740004 - condemned for "pull you off the road". */
  controlArm: {
    voiceover:
      "That clunk over bumps isn't just a noise. It's your lower control arm telling you the bushing is torn. One bad pothole can start it. Wait, and it'll chew up your tire and pull you off the road. Don't let a clunk become a crisis. DM us the word CLUNK and we'll take a look.",
    onScreenText:
      "This is the sound your car makes before it pulls. One Cleveland pothole. That's all it takes. That clunk is the bushing crying for help. Wait, and it eats your tire. Then your alignment. Then your confidence. Don't wait for the clunk to become a pull. DM 'CLUNK' to stop guessing.",
  },
  /** 1830003, superseding 1770005 - condemned for three false claims. */
  eCheck: {
    voiceover:
      "That little Check Engine light isn't just a suggestion. In Ohio, it's an automatic fail for your E-Check. Many drivers don't realize it, but even a minor sensor issue can keep you off the road. Get it diagnosed early to save yourself the hassle.",
    onScreenText:
      "Check Engine light on? Automatic E-Check FAILED. Ignoring it costs time & money. Get it diagnosed early. Pass your Ohio E-Check.",
  },
} as const;

describe("the defect this gate exists for", () => {
  it("the id-keyed veto does NOT object to any of the three regenerated jobs", () => {
    // The bug, stated as an assertion so it cannot silently come back as the
    // fix. If a later change makes these return a string, the content gate is
    // no longer the thing holding them and this file should be re-read.
    expect(auditPublishBlock(1830001)).toBeNull();
    expect(auditPublishBlock(1830002)).toBeNull();
    expect(auditPublishBlock(1830003)).toBeNull();
  });

  it("blocks the regenerated control-arm script, which repeats a condemned claim", () => {
    const problem = condemnedContentProblem(REGENERATED.controlArm);
    expect(problem).not.toBeNull();
    expect(problem).toContain("1740004");
    expect(problem).toContain("pull you off the road");
  });

  it("blocks the regenerated E-Check script, which repeats three condemned claims", () => {
    const problem = condemnedContentProblem(REGENERATED.eCheck);
    expect(problem).not.toBeNull();
    expect(problem).toContain("1770005");
  });
});

describe("what it must NOT block", () => {
  /**
   * The half of this that is easy to get wrong. 1770001 was condemned for an
   * ffmpeg encoder failure while its summary records "claims are accurate and
   * genuinely useful" and its tread-bar claim is cleared against NHTSA
   * TireWise. Re-rendering it is the prescribed cure. A gate that blocked
   * every condemned script would forbid the fix - and would still be green on
   * every "does it block?" test above.
   */
  it("passes the regenerated tread-bar script, condemned only for a broken asset", () => {
    expect(condemnedContentProblem(REGENERATED.treadBars)).toBeNull();
  });

  it("passes an unrelated script", () => {
    expect(
      condemnedContentProblem({
        voiceover: "Winter tires use a softer rubber compound that stays flexible when it gets cold.",
        onScreenText: "Softer compound. Better grip below 45 degrees.",
      }),
    ).toBeNull();
  });

  it("passes empty input rather than treating absence as a violation", () => {
    expect(condemnedContentProblem({})).toBeNull();
    expect(condemnedContentProblem({ voiceover: "", onScreenText: null })).toBeNull();
  });

  /**
   * THE CURE MUST PASS. The prescribed fix for a false claim is to rewrite that
   * claim and keep the rest of the reel, so a corrected script is SUPPOSED to
   * resemble the one it corrects. A threshold tuned to "too alike to post"
   * refuses the repair and leaves the topic permanently unusable.
   *
   * This test is here because the first version of the gate nearly did that.
   * At the originality gate's 0.5 the corrected control-arm rewrite below
   * scored 0.48 - it passed by 0.02, which is luck, not design. Measuring the
   * band (rewrites 0.31-0.48, verbatim copies 1.00) is what moved the
   * threshold to 0.75.
   */
  it("passes a corrected E-Check script - the claim scoped properly", () => {
    expect(
      condemnedContentProblem({
        voiceover:
          "That Check Engine light isn't just a suggestion. If you test in one of the seven E-Check counties, a lit light means a failing result. Get it scanned early and you have time to fix the cause before your test.",
        onScreenText:
          "Check Engine light on? In E-Check counties, that's a failing test. Get it scanned early. Plenty of time to fix it.",
      }),
    ).toBeNull();
  });

  it("passes a corrected control-arm script - the alarmist outcome removed", () => {
    expect(
      condemnedContentProblem({
        voiceover:
          "That clunk over bumps isn't just a noise. It's often a torn lower control arm bushing. One bad pothole can start it, and it wears your tire unevenly. Worth checking before it costs you a tire.",
        onScreenText:
          "That clunk over bumps? Often a torn bushing. It wears your tire unevenly. Worth checking.",
      }),
    ).toBeNull();
  });
});

describe("canary - break the gate and prove it fails", () => {
  /**
   * Per AGENTS.md: no gate ships without a test that breaks it and asserts the
   * break is caught. Both matchers are broken independently, because a single
   * canary would pass while one of them was dead.
   */
  it("with the phrase list emptied, similarity still catches a verbatim copy", () => {
    const entry = REEL_CLAIM_AUDIT[1770005];
    const original = entry.condemnedPhrases;
    Object.assign(entry, { condemnedPhrases: [] });
    try {
      const problem = condemnedContentProblem(REGENERATED.eCheck);
      expect(problem).not.toBeNull();
      expect(problem).toContain("similarity");
    } finally {
      Object.assign(entry, { condemnedPhrases: original });
    }
  });

  it("with the condemned text removed, the phrase list still catches the claim", () => {
    const entry = REEL_CLAIM_AUDIT[1740004];
    const original = entry.condemnedText;
    Object.assign(entry, { condemnedText: undefined });
    try {
      expect(condemnedContentProblem(REGENERATED.controlArm)).toContain("pull you off the road");
    } finally {
      Object.assign(entry, { condemnedText: original });
    }
  });

  it("with BOTH removed the script passes - proving the fixtures are not self-blocking", () => {
    // Without this, a gate that returned a string unconditionally would score
    // green on every assertion above.
    const entry = REEL_CLAIM_AUDIT[1740004];
    const text = entry.condemnedText;
    const phrases = entry.condemnedPhrases;
    Object.assign(entry, { condemnedText: undefined, condemnedPhrases: [] });
    try {
      expect(condemnedContentProblem(REGENERATED.controlArm)).toBeNull();
    } finally {
      Object.assign(entry, { condemnedText: text, condemnedPhrases: phrases });
    }
  });
});

describe("subject coverage - the gate is only as wide as its data", () => {
  /**
   * A gate over a hand-maintained table fails silently when someone adds an
   * entry and forgets the payload. Assert the SUBJECT, not just the verdict:
   * every entry condemned for something in its TEXT must carry the text.
   */
  it("every text-condemned entry carries condemnedText and at least one phrase", () => {
    const entries = textCondemnedEntries();
    expect(entries.length).toBeGreaterThan(0);
    for (const e of entries) {
      expect(e.condemnedText, `job ${e.jobId} is condemned for its text but records none`).toBeDefined();
      expect(e.condemnedText?.voiceover.length ?? 0, `job ${e.jobId} voiceover`).toBeGreaterThan(0);
      expect(e.condemnedPhrases?.length ?? 0, `job ${e.jobId} phrases`).toBeGreaterThan(0);
    }
  });

  it("covers exactly the three text-condemned jobs, and not the asset-only two", () => {
    expect(textCondemnedEntries().map((e) => e.jobId).sort()).toEqual([1740001, 1740004, 1770005]);
  });

  it("an asset-only condemnation records no condemned text", () => {
    // 1710001 and 1770001 are condemned, but for the file - not the words.
    expect(REEL_CLAIM_AUDIT[1710001].condemnedText).toBeUndefined();
    expect(REEL_CLAIM_AUDIT[1770001].condemnedText).toBeUndefined();
  });

  /**
   * Stricter than originality's ON PURPOSE, and this asserts the RELATIONSHIP
   * rather than the literal so the two can be retuned without silently
   * inverting. Originality punishes resemblance to a PUBLISHED reel; this one
   * must tolerate resemblance to a CONDEMNED one, because the fix for a false
   * claim is a script that still looks like the reel it repairs.
   */
  it("sits above the originality threshold, because a rewrite must survive it", () => {
    expect(CONDEMNED_CONTENT_THRESHOLD).toBeGreaterThan(ORIGINALITY_BLOCK_THRESHOLD);
  });
});
