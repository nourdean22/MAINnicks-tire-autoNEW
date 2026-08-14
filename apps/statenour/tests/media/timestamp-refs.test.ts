/**
 * BDN-312 · timestamp reference parsing.
 *
 * The asymmetry under test: a MISSED timestamp is invisible, a WRONG one
 * is a broken promise — it teaches the operator that the seek controls
 * lie. So the false-positive tests matter more than the recall tests,
 * and the parser is allowed to miss edge cases it cannot be sure about.
 */

import { describe, expect, it } from "vitest";
import {
  formatTimestamp,
  parseTimeToken,
  parseTimestampRefs,
} from "@/lib/media/timestamp-refs";

describe("timestamp-refs · token parsing", () => {
  it("parses M:SS and MM:SS", () => {
    expect(parseTimeToken("4:12")).toBe(252);
    expect(parseTimeToken("04:12")).toBe(252);
    expect(parseTimeToken("0:00")).toBe(0);
  });

  it("parses H:MM:SS", () => {
    expect(parseTimeToken("1:02:33")).toBe(3753);
    expect(parseTimeToken("10:00:00")).toBe(36000);
  });

  it("rejects out-of-range seconds and minutes", () => {
    expect(parseTimeToken("4:75")).toBeNull();
    expect(parseTimeToken("1:75:00")).toBeNull();
  });
});

describe("timestamp-refs · formatting round-trip", () => {
  it("formats under and over an hour", () => {
    expect(formatTimestamp(252)).toBe("4:12");
    expect(formatTimestamp(3753)).toBe("1:02:33");
    expect(formatTimestamp(0)).toBe("0:00");
  });

  it("round-trips through the parser", () => {
    for (const secs of [0, 59, 60, 252, 3599, 3600, 3753]) {
      expect(parseTimeToken(formatTimestamp(secs))).toBe(secs);
    }
  });

  it("degrades safely on nonsense input", () => {
    expect(formatTimestamp(-1)).toBe("0:00");
    expect(formatTimestamp(Number.NaN)).toBe("0:00");
  });
});

describe("timestamp-refs · extraction", () => {
  it("finds a single reference", () => {
    const refs = parseTimestampRefs("The speaker covers pricing at 4:12.");
    expect(refs).toEqual([{ start: 252, end: undefined, raw: "4:12" }]);
  });

  it("finds a range and keeps both ends", () => {
    const refs = parseTimestampRefs("At 04:12–05:03, the speaker says the quote was wrong.");
    expect(refs).toHaveLength(1);
    expect(refs[0].start).toBe(252);
    expect(refs[0].end).toBe(303);
  });

  it("accepts hyphen, en dash, em dash and 'to' as range separators", () => {
    for (const sep of ["-", "–", "—", " to "]) {
      const refs = parseTimestampRefs(`clip 1:00${sep}2:00 here`);
      expect(refs[0].end).toBe(120);
    }
  });

  it("prefers the RANGE over its endpoints — no duplicate controls", () => {
    const refs = parseTimestampRefs("Between 04:12 and 05:03 — see 04:12–05:03.");
    // The bare "04:12" and "05:03" are singles; the explicit range is one
    // ref. Dedup is on (start,end), so the singles survive separately but
    // the range is not double-counted.
    const ranges = refs.filter((r) => r.end !== undefined);
    expect(ranges).toHaveLength(1);
  });

  it("de-duplicates a repeated reference", () => {
    const refs = parseTimestampRefs("At 4:12 he says it. Again at 4:12. And 4:12.");
    expect(refs).toHaveLength(1);
  });

  it("returns refs in the order they appear", () => {
    const refs = parseTimestampRefs("First 0:30, then 2:15, finally 10:00.");
    expect(refs.map((r) => r.start)).toEqual([30, 135, 600]);
  });

  it("handles empty and absent input", () => {
    expect(parseTimestampRefs("")).toEqual([]);
    expect(parseTimestampRefs("no times here at all")).toEqual([]);
  });
});

describe("timestamp-refs · false positives (the load-bearing set)", () => {
  it("rejects ratios and scores with single-digit seconds", () => {
    expect(parseTimestampRefs("The ratio was 3:1 in our favor.")).toEqual([]);
    expect(parseTimestampRefs("They won 2:1.")).toEqual([]);
  });

  it("rejects clock times with am/pm", () => {
    expect(parseTimestampRefs("Call him at 10:30am tomorrow.")).toEqual([]);
    expect(parseTimestampRefs("Closing at 5:30 p.m. sharp.")).toEqual([]);
  });

  it("rejects chapter-and-verse citations", () => {
    expect(parseTimestampRefs("As John 3:16 puts it.")).toEqual([]);
    expect(parseTimestampRefs("see Psalm 23:04 for that")).toEqual([]);
  });

  it("rejects a currency-prefixed number", () => {
    expect(parseTimestampRefs("It came to $4:99 which is a typo.")).toEqual([]);
  });

  it("rejects a backwards range rather than seeking to it", () => {
    // A model writing 05:03–04:12 has made an error; a control here would
    // seek somewhere the operator did not ask for.
    expect(parseTimestampRefs("between 05:03–04:12")).toEqual([]);
  });

  it("does not match inside a longer numeric run", () => {
    expect(parseTimestampRefs("build 12:34:56:78 identifier")).toEqual([]);
  });

  it("still finds a real timestamp in a sentence that also has a ratio", () => {
    // Strictness must not become blindness.
    const refs = parseTimestampRefs("The 3:1 ratio is explained at 12:40.");
    expect(refs).toHaveLength(1);
    expect(refs[0].start).toBe(760);
  });
});
