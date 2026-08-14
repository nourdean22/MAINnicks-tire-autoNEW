/**
 * BDN-316 · saved media moments.
 *
 * The load-bearing property is the ROUND TRIP: a saved moment must
 * reopen at the same media and the same second. A bookmark that lands
 * somewhere else is worse than no bookmark — the operator stops trusting
 * every one of them after a single miss.
 */

import { describe, expect, it } from "vitest";
import {
  MEDIA_MOMENT_CATEGORY,
  momentContent,
  momentKey,
  parseMomentKey,
  reopenTargetFromKey,
  toMemoryCandidate,
  type MediaMoment,
} from "@/lib/media/media-moment";

const moment = (over: Partial<MediaMoment> = {}): MediaMoment => ({
  mediaId: "msg_123-0",
  mediaTitle: "bay5.mp4",
  seconds: 252,
  ...over,
});

describe("media-moment · key round trip (load-bearing)", () => {
  it("round-trips id and seconds", () => {
    const key = momentKey("msg_123-0", 252);
    expect(parseMomentKey(key)).toEqual({ mediaId: "msg_123-0", seconds: 252 });
  });

  it("survives a media id containing colons", () => {
    // Message-part ids are opaque; anchoring the split on the first ':'
    // would truncate the id and reopen the WRONG media.
    const id = "conv:abc:msg:9-2";
    const key = momentKey(id, 90);
    expect(parseMomentKey(key)).toEqual({ mediaId: id, seconds: 90 });
  });

  it("rounds to whole seconds so two near-identical saves are one moment", () => {
    // Without rounding, saves half a second apart mint two memories of
    // the same moment.
    expect(momentKey("a", 12.4)).toBe(momentKey("a", 12.9));
  });

  it("clamps a negative offset rather than encoding it", () => {
    expect(momentKey("a", -5)).toBe("media:a@0");
  });

  it("round-trips zero", () => {
    expect(parseMomentKey(momentKey("a", 0))).toEqual({ mediaId: "a", seconds: 0 });
  });
});

describe("media-moment · key rejection", () => {
  it("returns null for keys that are not ours", () => {
    for (const k of ["", "brain:123", "media:", "media:a", "media:@12", "receipt:x@1"]) {
      expect(parseMomentKey(k)).toBeNull();
    }
  });

  it("rejects a non-numeric offset instead of coercing it", () => {
    expect(parseMomentKey("media:a@abc")).toBeNull();
    expect(parseMomentKey("media:a@12.5")).toBeNull();
  });
});

describe("media-moment · content is legible without its metadata", () => {
  it("leads with the media and the timestamp", () => {
    expect(momentContent(moment())).toContain("bay5.mp4 @ 4:12");
  });

  it("includes the operator's note when there is one", () => {
    const c = momentContent(moment({ note: "the useful part about follow-up" }));
    expect(c).toContain("the useful part about follow-up");
  });

  it("is valid as a bare bookmark with no note", () => {
    // A timestamp alone is a legitimate save; requiring a note would
    // push the operator to type something meaningless.
    expect(momentContent(moment())).toBe("bay5.mp4 @ 4:12");
  });

  it("includes a transcript excerpt when one exists", () => {
    expect(momentContent(moment({ excerpt: "we call them back twice" }))).toContain(
      "we call them back twice",
    );
  });

  it("ignores whitespace-only notes rather than emitting a dangling dash", () => {
    expect(momentContent(moment({ note: "   " }))).toBe("bay5.mp4 @ 4:12");
  });
});

describe("media-moment · memory candidate", () => {
  it("targets the media_moment category with the deterministic key", () => {
    const c = toMemoryCandidate(moment());
    expect(c.category).toBe(MEDIA_MOMENT_CATEGORY);
    expect(c.key).toBe("media:msg_123-0@252");
    expect(c.categoryKnown).toBe(true);
  });

  it("labels the source 'operator' — the moment WAS operator-stated", () => {
    // The gateway maps source → evidence class. Anything else would
    // understate evidence the system genuinely has.
    expect(toMemoryCandidate(moment()).source).toBe("operator");
  });

  it("produces the same key twice, so a re-save reinforces rather than duplicates", () => {
    expect(toMemoryCandidate(moment()).key).toBe(toMemoryCandidate(moment()).key);
  });
});

describe("media-moment · reopen", () => {
  it("returns media id and offset", () => {
    expect(reopenTargetFromKey("media:msg_123-0@252")).toEqual({
      mediaId: "msg_123-0",
      seconds: 252,
    });
  });

  it("returns NO url — a reconstructed one could be dead", () => {
    // blob: URLs die with the session; handing the player one from a
    // memory row would look like a broken bookmark.
    const target = reopenTargetFromKey("media:a@1");
    expect(target).not.toHaveProperty("url");
  });

  it("returns null for a foreign key", () => {
    expect(reopenTargetFromKey("brain:456")).toBeNull();
  });
});
