import { describe, expect, it } from "vitest";
import { StreamingSpeechSegmenter } from "./segmenter";

/** Feed `full` in slices of `step` chars, collecting every emitted span. */
function streamThrough(full: string, step: number, opts?: ConstructorParameters<typeof StreamingSpeechSegmenter>[0]): string[] {
  const seg = new StreamingSpeechSegmenter(opts);
  const spans: string[] = [];
  for (let end = step; end < full.length; end += step) {
    spans.push(...seg.feed(full.slice(0, end)));
  }
  spans.push(...seg.flush(full));
  return spans;
}

describe("StreamingSpeechSegmenter", () => {
  it("emits complete sentences while the stream is still growing (TTFA path)", () => {
    const seg = new StreamingSpeechSegmenter({ minChars: 5 });
    // Terminator present but nothing after it yet — NOT proven complete.
    expect(seg.feed("The shop is quiet today.")).toEqual([]);
    // Whitespace + next content arrives — first sentence is now safe.
    const spans = seg.feed("The shop is quiet today. Two estimates are open");
    expect(spans).toEqual(["The shop is quiet today. "]);
  });

  it("INVARIANT: concatenated spans reproduce the input exactly, once (no double-speak across re-feeds)", () => {
    const full =
      "Morning brief. Revenue is up 12% vs. last week.\n\n" +
      "1. Call the supplier back.\n2. Approve the estimate for $3.50 per unit.\n\n" +
      "Check https://example.com/status.html for details. Done.";
    for (const step of [1, 3, 7, 50]) {
      const spans = streamThrough(full, step, { minChars: 5 });
      expect(spans.join("")).toBe(full);
    }
  });

  it("re-feeding the identical accumulated text emits nothing new", () => {
    const seg = new StreamingSpeechSegmenter({ minChars: 5 });
    const text = "First sentence. Second sentence. And";
    const first = seg.feed(text);
    expect(first.length).toBeGreaterThan(0); // positive control
    expect(seg.feed(text)).toEqual([]);
    expect(seg.feed(text)).toEqual([]);
  });

  it("does not split decimals, versions, or abbreviations", () => {
    const spans = streamThrough(
      "The part costs $3.50 vs. the Mr. Smith quote of $4.20 approx. per unit, e.g. in bulk. Next point here.",
      9,
      { minChars: 5 },
    );
    // The first emitted span must contain the whole first sentence —
    // none of the interior periods may have split it.
    expect(spans[0]).toContain("$3.50");
    expect(spans[0]).toContain("Mr. Smith");
    expect(spans[0]).toContain("e.g. in bulk.");
  });

  it("does not treat periods inside a streaming URL as boundaries", () => {
    const spans = streamThrough(
      "See https://api.example.com/v1/status.json?x=1 for the feed. Then act.",
      6,
      { minChars: 5 },
    );
    const urlSpan = spans.find((s) => s.includes("example.com"));
    expect(urlSpan).toBeDefined();
    expect(urlSpan).toContain("https://api.example.com/v1/status.json?x=1");
  });

  it("holds an open code fence across chunks and emits the closed fence atomically", () => {
    const seg = new StreamingSpeechSegmenter({ minChars: 5 });
    expect(seg.feed("Run this:\n")).toEqual(["Run this:\n"]);
    expect(seg.feed("Run this:\n```bash\nnpm ins")).toEqual([]);
    // fence still open — nothing more emits regardless of content
    expect(seg.feed("Run this:\n```bash\nnpm install\necho done. yes. ")).toEqual([]);
    const closed = seg.feed("Run this:\n```bash\nnpm install\necho done. yes. \n```\nAfter the block, act now");
    expect(closed[0]).toBe("```bash\nnpm install\necho done. yes. \n```\n");
    const rest = seg.flush("Run this:\n```bash\nnpm install\necho done. yes. \n```\nAfter the block, act now");
    expect(rest.join("")).toBe("After the block, act now");
  });

  it("flush emits the unterminated tail and an unclosed fence", () => {
    const seg = new StreamingSpeechSegmenter({ minChars: 5 });
    const text = "Summary first. ```js\nlet x = 1";
    seg.feed(text);
    const spans = seg.flush(text);
    expect(spans.join("")).toContain("```js\nlet x = 1");
    // and the invariant still holds
    const all = ["Summary first. ", ...spans.filter((s) => !s.startsWith("Summary"))];
    expect(text.startsWith(all[0])).toBe(true);
  });

  it("merges fragments below minChars instead of speaking five-word confetti", () => {
    const seg = new StreamingSpeechSegmenter({ minChars: 30 });
    const text = "Yes. No. Maybe so. It depends entirely on the margin numbers. And more follows";
    const spans = seg.feed(text);
    for (const s of spans) expect(s.length).toBeGreaterThanOrEqual(30);
    expect(spans[0]).toContain("Yes. No. Maybe so.");
  });

  it("breaks an endless unpunctuated run at maxChars on whitespace", () => {
    const words = Array(120).fill("word").join(" ") + " tail";
    const seg = new StreamingSpeechSegmenter({ minChars: 5, maxChars: 100 });
    const spans = seg.feed(words);
    expect(spans.length).toBeGreaterThan(0); // positive control
    for (const s of spans) expect(s.length).toBeLessThanOrEqual(101);
    expect(spans.join("") + wordsTail(words, spans)).toBe(words);
  });

  it("treats newline (list items, headings) as a boundary", () => {
    const seg = new StreamingSpeechSegmenter({ minChars: 5 });
    const text = "### Recommendation\n- Call them today\n- Then invoice\nAnd finally";
    const spans = seg.feed(text);
    expect(spans[0]).toBe("### Recommendation\n");
    expect(spans[1]).toBe("- Call them today\n");
    expect(spans[2]).toBe("- Then invoice\n");
  });

  it("resets when the accumulated text shrinks (message regenerated)", () => {
    const seg = new StreamingSpeechSegmenter({ minChars: 5 });
    seg.feed("A long first answer that streams for a while. And then some");
    const spans = seg.feed("Short redo. Fresh text");
    expect(spans).toEqual(["Short redo. "]);
  });
});

function wordsTail(full: string, spans: string[]): string {
  return full.slice(spans.join("").length);
}
