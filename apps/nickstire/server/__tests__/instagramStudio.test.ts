import { describe, expect, it } from "vitest";
import { INSTAGRAM_STUDIO_VERSION } from "../../shared/instagramStudio";
import { evaluateInstagramDraft, fitFontSize, renderCardHtml } from "../services/instagramStudio";
import { appRouter } from "../routers";

describe("Instagram Studio V2 quality contract", () => {
  const clean = {
    source: { type: "manual_idea" as const, detail: "Cleveland potholes and a visible tire bubble", evidenceStatus: "operator_context" as const },
    format: "post" as const,
    caption: "That bubble in your tire is not decoration. Cleveland potholes can hit hard enough to damage the sidewall. If you spot one, avoid highway speed and have the tire inspected before the next drive. Walk in for a straight answer.",
    headline: "A TIRE BUBBLE IS A WARNING",
    subheadline: "Pothole impact can damage the sidewall. Get it looked at before highway driving.",
    artDirection: "One close tire sidewall on a dark graphite background with Nick's yellow accent lighting.",
    conceptKey: "tire-bubble-warning",
  };

  it("returns the versioned server quality result for clean bounded copy", () => {
    const result = evaluateInstagramDraft(clean);
    expect(result.version).toBe(INSTAGRAM_STUDIO_VERSION);
    expect(result.gate).not.toBe("block");
    expect(result.overall).toBeGreaterThanOrEqual(70);
    expect(result.blockers).toEqual([]);
  });

  it("blocks an unverified review source", () => {
    const result = evaluateInstagramDraft({
      ...clean,
      source: { type: "review", recordId: "999", evidenceStatus: "unverified" },
    });
    expect(result.gate).toBe("block");
    expect(result.blockers.join(" ")).toMatch(/verified database record/i);
  });

  it("blocks fabricated guarantee language before rendering or publishing", () => {
    const result = evaluateInstagramDraft({
      ...clean,
      caption: "We guarantee the best brake repair in Cleveland.",
    });
    expect(result.gate).toBe("block");
    expect(result.blockers.length).toBeGreaterThan(0);
  });

  it("penalizes visual copy that cannot render cleanly", () => {
    const result = evaluateInstagramDraft({
      ...clean,
      headline: "X".repeat(60),
      subheadline: "Y".repeat(120),
    });
    const visual = result.dimensions.find((item) => item.key === "visual_readiness");
    expect(visual?.status).toBe("block");
  });
});

describe("Instagram Studio V2 poster auto-fit (no silent clipping)", () => {
  const opts = { width: 900, maxLines: 2, max: 108, min: 48, charRatio: 0.6 };

  it("shrinks the font as text gets longer, clamped to [min, max]", () => {
    const short = fitFontSize("STOP", opts);
    const mid = fitFontSize("MICHELIN DEFENDER T2 ALL-SEASON GRIP NOW", opts); // 40 chars
    const huge = fitFontSize("W".repeat(400), opts);
    expect(short).toBe(108); // short copy keeps the max size
    expect(mid).toBeLessThan(short); // longer copy shrinks to fit
    expect(mid).toBeGreaterThanOrEqual(48);
    expect(huge).toBe(48); // never below the floor
    // monotonic: never larger for longer text
    expect(fitFontSize("A".repeat(30), opts)).toBeGreaterThanOrEqual(fitFontSize("A".repeat(40), opts));
  });

  it("renders a long headline smaller than a short one and wraps unbreakable words", () => {
    const base = { body: "Short body copy.", cta: "BOOK NOW", eyebrow: "NICK'S", width: 1080, height: 1080 } as const;
    const size = (html: string) => Number(/\.headline\{font-size:(\d+)px/.exec(html)?.[1] ?? "0");
    const shortHtml = renderCardHtml({ ...base, headline: "STOP." });
    const longHtml = renderCardHtml({ ...base, headline: "MICHELIN DEFENDER T2 ALL-SEASON GRIP NOW" });
    expect(size(shortHtml)).toBe(108);
    expect(size(longHtml)).toBeLessThan(108); // auto-fit engaged (was a fixed 108 that clipped)
    // break-word guarantees a long unbreakable token can never overflow horizontally
    expect(longHtml).toContain("word-break:break-word");
    expect(longHtml).toContain("overflow-wrap:break-word");
  });
});

describe("Instagram Studio V2 router registration", () => {
  it("registers the generate, render, stage, and publish procedures", () => {
    expect(appRouter._def.procedures["instagramStudio.generate"]).toBeDefined();
    expect(appRouter._def.procedures["instagramStudio.render"]).toBeDefined();
    expect(appRouter._def.procedures["instagramStudio.stage"]).toBeDefined();
    expect(appRouter._def.procedures["instagramStudio.publish"]).toBeDefined();
  });
});
