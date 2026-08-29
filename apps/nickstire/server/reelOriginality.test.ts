/**
 * The originality gate, and the location tag's off switch.
 *
 * THE INCIDENT. Reel 1770003 published 2026-08-29 after an audit that checked
 * claims against primary sources, AI disclosure, aspect ratio, burned-in text
 * and destination — and never asked whether the content had run before. It had:
 * job 1620001 published the same script on 2026-08-17, measured similarity
 * 1.00 on the on-screen text AND 1.00 on the caption.
 *
 * The fixtures below are the REAL strings from those two reels, so this suite
 * fails if the gate would not have caught the actual event.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  jaccardSimilarity,
  normalizeForComparison,
  originalityProblem,
  topicOverlap,
  ORIGINALITY_BLOCK_THRESHOLD,
  type PublishedRecord,
} from "@shared/reelOriginality";

/* The genuine 1620001 on-screen text and caption, as published. */
const PUBLISHED_1620001: PublishedRecord = {
  label: "reel job 1620001 (post 18107716936850240)",
  onScreenText:
    "That slow leak might not be a nail. Cleveland salt creeps into the bead seat. It eats the metal where the tire seals. That can cause a slow leak you can't see. If your tire loses air and there's no nail, the wheel might be the problem.",
  caption:
    "That slow leak might not be a nail. Cleveland road salt creeps into the wheel bead and eats the metal where the tire seals.",
  videoUrl: "https://nickstire.org/generated/reels/reel-1620001.mp4",
  topic: "Tires & Wheels",
};

/* A genuinely different reel from the same account — the nearest non-duplicate
 * in the real history scored 0.25. */
const PUBLISHED_1680001: PublishedRecord = {
  label: "reel job 1680001 (post 17953873209228169)",
  onScreenText:
    "That hum that rises with speed. It might not be your tires. A wheel bearing can wear quietly, then start singing on Cleveland roads.",
  caption: "That hum that rises with speed might not be your tires.",
  videoUrl: "https://nickstire.org/generated/reels/reel-1680001.mp4",
  topic: "Wheel bearing noise",
};

const CORPUS = [PUBLISHED_1620001, PUBLISHED_1680001];

describe("the 1770003 repost would have been blocked", () => {
  // A DIFFERENT RENDER of the same script: new video file, same words. This is
  // the actual event, and the reason videoUrl equality alone was never enough.
  it("BLOCKS the re-render that actually shipped", () => {
    const match = originalityProblem(
      {
        onScreenText: PUBLISHED_1620001.onScreenText,
        caption: PUBLISHED_1620001.caption,
        videoUrl: "https://nickstire.org/generated/reels/reel-1770003.mp4",
      },
      CORPUS,
    );
    expect(match).not.toBeNull();
    expect(match!.label).toContain("1620001");
    expect(match!.score).toBeGreaterThanOrEqual(0.99);
    expect(match!.reason).toMatch(/already been published/);
  });

  // POSITIVE CONTROL. Without this every assertion above is satisfied by a gate
  // that refuses everything — which is useless in exactly the same way.
  it("PASSES a genuinely new reel", () => {
    const fresh = {
      onScreenText:
        "Your brake pedal goes soft on a long hill. That is heat in the fluid, not a bad pedal. Moisture boils and the pedal sinks.",
      caption: "Soft pedal on a long hill is usually heat in the fluid.",
      videoUrl: "https://nickstire.org/generated/reels/reel-9999999.mp4",
    };
    expect(originalityProblem(fresh, CORPUS)).toBeNull();
  });

  it("PASSES the nearest real non-duplicate in the account's history", () => {
    expect(
      originalityProblem(
        { onScreenText: PUBLISHED_1680001.onScreenText, caption: PUBLISHED_1680001.caption, videoUrl: "https://x/new.mp4" },
        [PUBLISHED_1620001],
      ),
    ).toBeNull();
  });

  it("BLOCKS a byte-identical video file even when the copy changed", () => {
    const match = originalityProblem(
      { onScreenText: "completely different words here", caption: "and a different caption", videoUrl: PUBLISHED_1620001.videoUrl },
      CORPUS,
    );
    expect(match?.surface).toBe("video_url");
  });

  it("BLOCKS a reused caption even when the beats were reworded", () => {
    const match = originalityProblem(
      { onScreenText: "totally fresh beats about something unrelated entirely", caption: PUBLISHED_1620001.caption, videoUrl: "https://x/new.mp4" },
      CORPUS,
    );
    expect(match?.surface).toBe("caption");
  });

  it("reports the STRONGEST match, not the first row that trips", () => {
    const weak: PublishedRecord = { label: "weak", onScreenText: PUBLISHED_1620001.onScreenText!.slice(0, 90), caption: null };
    const match = originalityProblem(
      { onScreenText: PUBLISHED_1620001.onScreenText, caption: null },
      [weak, PUBLISHED_1620001],
    );
    expect(match!.label).toContain("1620001");
  });

  it("an empty corpus blocks nothing — absence of history is not proof of originality", () => {
    expect(originalityProblem({ onScreenText: "anything", caption: "anything" }, [])).toBeNull();
  });
});

describe("the threshold sits in the measured empty band", () => {
  it("is 0.5 — above the highest observed non-duplicate (0.35), below a reworded repost", () => {
    expect(ORIGINALITY_BLOCK_THRESHOLD).toBe(0.5);
  });

  it("scores the real duplicate at 1.00 and the nearest real neighbour under 0.35", () => {
    expect(jaccardSimilarity(PUBLISHED_1620001.onScreenText!, PUBLISHED_1620001.onScreenText!)).toBe(1);
    const near = jaccardSimilarity(PUBLISHED_1620001.onScreenText!, PUBLISHED_1680001.onScreenText!);
    expect(near).toBeLessThan(0.35);
  });

  it("normalisation ignores case and punctuation but not words", () => {
    expect(normalizeForComparison("That SLOW leak -- might not be a NAIL!")).toBe("that slow leak might not be a nail");
    expect(jaccardSimilarity("a b c", "x y z")).toBe(0);
    expect(jaccardSimilarity("", "anything")).toBe(0);
  });
});

describe("topic overlap is ADVISORY, never a block", () => {
  // Three same-topic pairs exist in the real history and none of them is a
  // duplicate. Blocking them would refuse legitimate re-coverage.
  it("reports a same-topic prior without blocking it", () => {
    const candidate = { onScreenText: "an entirely different script about wheels", caption: "different", topic: "Tires & Wheels" };
    expect(originalityProblem(candidate, CORPUS)).toBeNull();
    const overlap = topicOverlap(candidate, CORPUS);
    expect(overlap.length).toBeGreaterThan(0);
    expect(overlap[0].label).toContain("1620001");
  });

  it("says nothing when the candidate declares no topic", () => {
    expect(topicOverlap({ topic: null }, CORPUS)).toEqual([]);
  });
});

/* ── the location tag's off switch ──────────────────────────────────────── */

describe("REEL_LOCATION_TAG_ENABLED", () => {
  const prev = { flag: process.env.REEL_LOCATION_TAG_ENABLED, page: process.env.META_PAGE_ID };
  beforeEach(() => { process.env.META_PAGE_ID = "102116346003811"; });
  afterEach(() => {
    if (prev.flag === undefined) delete process.env.REEL_LOCATION_TAG_ENABLED; else process.env.REEL_LOCATION_TAG_ENABLED = prev.flag;
    if (prev.page === undefined) delete process.env.META_PAGE_ID; else process.env.META_PAGE_ID = prev.page;
  });

  // The container body builds `location_id` with this expression; the test
  // pins the DECISION, which is the part an operator flips under pressure.
  const wouldTag = () => process.env.REEL_LOCATION_TAG_ENABLED !== "false" && !!process.env.META_PAGE_ID;

  it("defaults ON when unset", () => {
    delete process.env.REEL_LOCATION_TAG_ENABLED;
    expect(wouldTag()).toBe(true);
  });

  it("turns OFF on exactly \"false\" — the instant switch, no deploy", () => {
    process.env.REEL_LOCATION_TAG_ENABLED = "false";
    expect(wouldTag()).toBe(false);
  });

  // A typo must not silently change behaviour in either direction.
  it("stays ON for any other value", () => {
    for (const v of ["true", "FALSE", "0", "no", ""]) {
      process.env.REEL_LOCATION_TAG_ENABLED = v;
      expect(wouldTag(), `value ${JSON.stringify(v)}`).toBe(true);
    }
  });

  it("does not tag when no page id is configured", () => {
    delete process.env.META_PAGE_ID;
    delete process.env.REEL_LOCATION_TAG_ENABLED;
    expect(wouldTag()).toBe(false);
  });
});
