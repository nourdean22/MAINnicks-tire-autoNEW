import { describe, it, expect } from "vitest";
import { BUSINESS } from "@shared/business";
import { esc, buildSlideHtml, AD_SLIDE_ORDER, type RenderSlide, type AdCopy } from "./adTemplate";
import { lintAdCopy } from "./adCopyGen";

const COPY: AdCopy = {
  hookYellow: "$10 DOWN.", hookWhite: "DRIVE TODAY.", hookSub: "New tires from $89 installed",
  valueWhite: "NO CREDIT CHECK.", valueYellow: "$10 DOWN.",
  valueTicks: ["Drive home today", "Acima · Snap · Koalafi", "Any tire, any brand"],
  offerYellow: "FREE", offerWhite: "TIRE CHECK.", offerSub: "No appointment. No pressure.",
  caption: "Walk in 7 days a week.",
};
const slide = (role: RenderSlide["role"], copy = COPY): RenderSlide => ({ role, fontCss: "", copy });

describe("adTemplate.esc", () => {
  it("escapes HTML-significant characters", () => {
    expect(esc(`a & b <script> "x"`)).toBe("a &amp; b &lt;script&gt; &quot;x&quot;");
  });
  it("handles null/undefined safely", () => {
    expect(esc(undefined as unknown as string)).toBe("");
  });
});

describe("buildSlideHtml", () => {
  it("renders all 5 roles to a 1080x1080 doc with the headline", () => {
    for (const role of AD_SLIDE_ORDER) {
      const html = buildSlideHtml(slide(role));
      expect(html).toContain("width:1080px;height:1080px");
      expect(html).toContain("<!doctype html>");
    }
    expect(buildSlideHtml(slide("hook"))).toContain("DRIVE TODAY.");
  });

  it("neutralizes injection from copy fields", () => {
    const evil: AdCopy = { ...COPY, hookWhite: `</style><img src=x onerror=alert(1)>` };
    const html = buildSlideHtml(slide("hook", evil));
    expect(html).not.toContain("<img src=x onerror");
    expect(html).toContain("&lt;img src=x onerror");
  });

  it("proof + cta slides use real BUSINESS facts, not copy", () => {
    expect(buildSlideHtml(slide("proof"))).toContain("Google reviews");
    const cta = buildSlideHtml(slide("cta"));
    expect(cta).toContain(esc(BUSINESS.address.full));
    expect(cta).toContain(esc(BUSINESS.phone.display));
  });
});

describe("lintAdCopy", () => {
  it("passes clean claim-safe copy", () => {
    expect(lintAdCopy(COPY)).toEqual([]);
  });
  it("flags banned superlatives", () => {
    const bad = { ...COPY, hookWhite: "BEST TIRES" };
    expect(lintAdCopy(bad).some((i) => i.toLowerCase().includes("best"))).toBe(true);
  });
  it("flags 'free' used outside a free check", () => {
    const bad = { ...COPY, caption: "free tires for everyone" };
    expect(lintAdCopy(bad).some((i) => i.includes("free"))).toBe(true);
  });
  it("allows 'free tire check'", () => {
    const ok = { ...COPY, caption: "Get a free tire check today" };
    expect(lintAdCopy(ok)).toEqual([]);
  });
  it("flags leaked HTML entities", () => {
    const bad = { ...COPY, caption: "Snap &amp; Koalafi" };
    expect(lintAdCopy(bad).some((i) => i.includes("entity"))).toBe(true);
  });
});
