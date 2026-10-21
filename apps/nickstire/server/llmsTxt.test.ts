/**
 * /llms.txt body (server/_core/llmsTxt.ts), 2026-10-21.
 *
 * AI assistants now send customers to the shop (ChatGPT quoted the $89 floor
 * to one on 2026-10-21). The prices they read here were hand-typed literals
 * that had to be kept in step with canon by hand; they are now built from
 * shared/business.ts and shared/pricing.ts, and the file gains a tire-size
 * section and one question phrased the way people ask an assistant.
 *
 * $89 is the site-wide new-tire FLOOR. Nothing prices 205/60R16, so no
 * sentence may put that size next to a dollar amount.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildLlmsTxt } from "./_core/llmsTxt";
import { BUSINESS } from "../shared/business";
import { BRAKE_PRICE, OIL_PRICE } from "../shared/pricing";
import { TIRE_SIZE_PAGES } from "../shared/tireSizes";

const SITE = "https://example.test";
const body = (opts: Partial<Parameters<typeof buildLlmsTxt>[0]> = {}) =>
  buildLlmsTxt({ siteUrl: SITE, reviewRating: "4.9", reviewCountDisplay: "1,710+", ...opts });
const section = (text: string, heading: string) => {
  const start = text.indexOf(`## ${heading}\n`);
  expect(start, `missing section ${heading}`).toBeGreaterThanOrEqual(0);
  const next = text.indexOf("\n## ", start + 3);
  return text.slice(start, next === -1 ? undefined : next);
};

afterEach(() => {
  vi.doUnmock("../shared/pricing");
  vi.resetModules();
});

describe("prices come from canon", () => {
  it("each service price line carries the canon value", () => {
    const services = section(body(), "Services");
    expect(services).toContain(`Pads from $${BRAKE_PRICE.padsStarting}/axle`);
    expect(services).toContain(`pads + rotors from $${BRAKE_PRICE.padsAndRotorsStarting}/axle`);
    expect(services).toContain(`Used ${BUSINESS.usedTires.priceDisplay}`);
    expect(services).toContain(BUSINESS.usedTires.typicalBand);
    expect(services).toContain(`new ${BUSINESS.newTires.priceDisplay}`);
    expect(services).toContain(`Conventional from $${OIL_PRICE.conventional}`);
    expect(services).toContain(`full synthetic from $${OIL_PRICE.fullSynthetic}`);
  });

  it("every dollar amount in the file is a canon value", () => {
    const canon = new Set(
      [
        BRAKE_PRICE.padsStarting, BRAKE_PRICE.padsAndRotorsStarting, OIL_PRICE.conventional, OIL_PRICE.fullSynthetic,
        BUSINESS.newTires.priceDisplay, BUSINESS.usedTires.priceDisplay, BUSINESS.usedTires.typicalBand,
      ].flatMap((v) => String(v).match(/\$?\d+(?:\.\d+)?(?:-\d+)?/g) ?? []).map((v) => v.replace(/^\$/, "")),
    );
    const amounts = body().match(/\$\d+(?:\.\d+)?(?:-\d+)?/g) ?? [];
    expect(amounts.length).toBeGreaterThan(5);
    expect(amounts.filter((a) => !canon.has(a.slice(1)))).toEqual([]);
  });

  it("a changed canon price reaches the file (built, not typed)", async () => {
    vi.resetModules();
    vi.doMock("../shared/pricing", async (importOriginal) => ({
      ...(await importOriginal<typeof import("../shared/pricing")>()),
      OIL_PRICE: { conventional: 51, fullSynthetic: 83 },
      BRAKE_PRICE: { padsStarting: 151, padsMax: 299, padsAndRotorsStarting: 155.99, caliperAndRotorReplacementEstimate: 950 },
    }));
    const fresh = await import("./_core/llmsTxt");
    const text = fresh.buildLlmsTxt({ siteUrl: SITE, reviewRating: "4.9", reviewCountDisplay: "1,710+" });
    expect(text).toContain("Conventional from $51, full synthetic from $83");
    expect(text).toContain("Pads from $151/axle; pads + rotors from $155.99/axle");
    expect(text).not.toContain("$49");
  });

  it("the new-tire line says the price depends on size and brand and how to get an exact quote", () => {
    const tireLine = section(body(), "Services").split("\n").find((l) => l.startsWith("- [Tires"));
    expect(tireLine).toMatch(/depends on (the )?size and brand/i);
    expect(tireLine).toMatch(/call or text .*size.* exact quote/i);
    expect(tireLine).toContain(BUSINESS.phone.display);
  });
});

describe("tire sizes section", () => {
  it("sits after Services and before Common questions", () => {
    const text = body();
    const services = text.indexOf("## Services\n");
    const sizes = text.indexOf("## Tire sizes\n");
    const faq = text.indexOf("## Common questions\n");
    expect(services).toBeGreaterThan(0);
    expect(sizes).toBeGreaterThan(services);
    expect(faq).toBeGreaterThan(sizes);
  });

  it("opens with the canon floor and used band, then links every size page on the site origin", () => {
    const sizes = section(body(), "Tire sizes");
    expect(sizes).toContain(
      `New tires ${BUSINESS.newTires.priceDisplay}; used tires in ${BUSINESS.usedTires.typicalBand}. Size pages:`,
    );
    for (const p of TIRE_SIZE_PAGES) expect(sizes).toContain(`- [${p.size}](${SITE}/tires/${p.slug})`);
    expect(sizes).toContain(`- [205/60R16](${SITE}/tires/205-60r16)`);
    expect(sizes.split("\n").filter((l) => l.startsWith("- [")).length).toBe(TIRE_SIZE_PAGES.length);
  });

  it("uses the configured origin, never a literal host", () => {
    expect(body()).not.toContain("nickstire.org");
  });
});

describe("the assistant-style question", () => {
  const faqLine = () =>
    section(body(), "Common questions").split("\n").find((l) => l.startsWith("- Where can I get cheap 205/60R16 tires in Cleveland?"));

  it("exists and answers with canon floor, used band, free install, 7 days, phone and address", () => {
    const line = faqLine();
    expect(line).toBeDefined();
    expect(line).toContain(BUSINESS.newTires.priceDisplay);
    expect(line).toContain(BUSINESS.usedTires.typicalBand);
    expect(line).toMatch(/free install/i);
    expect(line).toMatch(/7 days/);
    expect(line).toContain(BUSINESS.phone.display);
    expect(line).toContain(BUSINESS.address.full);
  });

  it("no sentence anywhere puts 205/60R16 next to a dollar amount (the floor is not a per-size price)", () => {
    const sentences = body().split(/(?<=[.?!])\s+|\n/);
    expect(sentences.filter((s) => s.includes("205/60R16") && s.includes("$"))).toEqual([]);
  });

  it("the new copy is ASCII", () => {
    const text = body();
    const added = [section(text, "Tire sizes"), faqLine() ?? "", section(text, "Services").split("\n").find((l) => l.startsWith("- [Tires")) ?? ""];
    for (const chunk of added) expect(chunk, chunk).toMatch(/^[\x20-\x7e\n]*$/);
  });
});

describe("rating stays dynamic", () => {
  it("prints the rating and count it is given", () => {
    expect(body({ reviewRating: "4.8", reviewCountDisplay: "2,000+" })).toContain("- Rating: 4.8 stars from 2,000+ Google reviews");
  });
});
