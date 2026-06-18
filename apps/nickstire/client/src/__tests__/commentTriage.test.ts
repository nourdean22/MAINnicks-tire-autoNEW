import { describe, expect, it } from "vitest";
import { classifyComment, COMMENT_KIND_BADGE } from "../lib/commentTriage";

describe("classifyComment", () => {
  it("flags complaints as highest priority", () => {
    const r = classifyComment("This was a total ripoff, worst shop ever — I want a refund");
    expect(r.kind).toBe("complaint");
    expect(r.priority).toBe(3);
  });

  it("flags questions (via ? or question keywords)", () => {
    expect(classifyComment("How much for an oil change?").kind).toBe("question");
    expect(classifyComment("do you have 275/55r20 in stock").kind).toBe("question");
    expect(classifyComment("what time do you open").kind).toBe("question");
  });

  it("flags spam (links + follow-bait)", () => {
    expect(classifyComment("follow back f4f check my page").kind).toBe("spam");
    expect(classifyComment("visit www.cheaptires.shop now").kind).toBe("spam");
    expect(classifyComment("https://scam.io free money").priority).toBe(0);
  });

  it("flags praise (and does not mislabel fan emoji as spam)", () => {
    expect(classifyComment("thanks, great job on my brakes!").kind).toBe("praise");
    expect(classifyComment("🔥🔥").kind).toBe("praise");
  });

  it("defaults to neutral for empty / generic text", () => {
    expect(classifyComment("ok").kind).toBe("neutral");
    expect(classifyComment("").kind).toBe("neutral");
  });

  it("orders complaint > question > praise > spam by priority", () => {
    const p = (t: string) => classifyComment(t).priority;
    expect(p("scam refund")).toBeGreaterThan(p("how much?"));
    expect(p("how much?")).toBeGreaterThan(p("thanks!"));
    expect(p("thanks!")).toBeGreaterThan(p("check my page f4f"));
  });

  it("has a badge for non-neutral kinds and none for neutral", () => {
    expect(COMMENT_KIND_BADGE.complaint).toBeTruthy();
    expect(COMMENT_KIND_BADGE.question).toBeTruthy();
    expect(COMMENT_KIND_BADGE.neutral).toBeNull();
  });
});
