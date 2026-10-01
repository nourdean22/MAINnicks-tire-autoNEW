/**
 * Article generator contract (2026-10-01).
 *
 * POSITIVE CONTROLS, measured on main before this change:
 *  - the system/user prompt contained "80-200 words" and "at least one number
 *    anchor (cost range, time, miles)" — the instruction that pressures a model
 *    to invent figures when it has none;
 *  - the hours/phone/warranty facts were typed into the prompt by hand;
 *  - resolveRelatedServiceRoutes did not exist: the raw LLM strings (including
 *    "/brake-repair-cleveland", a 301 since 2026-07-04) were stored and rendered
 *    as links.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const { invokeLLM } = vi.hoisted(() => ({ invokeLLM: vi.fn() }));
vi.mock("./_core/llm", () => ({ invokeLLM }));
vi.mock("./db", () => ({ getDb: async () => null }));
vi.mock("./lib/reviewCopy", () => ({ getReviewCopy: async () => ({ rating: 4.9, countDisplay: "1,710+", source: "test" }) }));

import { generateArticle, resolveRelatedServiceRoutes } from "./content-generator";

afterEach(() => invokeLLM.mockReset());

describe("resolveRelatedServiceRoutes — the registry decides URLs, not the model", () => {
  it("keeps canonical routes, maps topic words, drops redirects and inventions", () => {
    const out = resolveRelatedServiceRoutes(["/tires", "/brake-repair-cleveland", "/made-up-service", "brakes", "Alignment", "/tires", "check engine light"]);
    expect(out).toEqual(["/tires", "/brakes", "/alignment", "/diagnostics"]);
  });
  it("caps at 4 and tolerates garbage input", () => {
    expect(resolveRelatedServiceRoutes(["tires", "brakes", "alignment", "oil change", "emissions"])).toHaveLength(4);
    expect(resolveRelatedServiceRoutes(null)).toEqual([]);
    expect(resolveRelatedServiceRoutes([42, {}, ""])).toEqual([]);
  });
});

describe("generateArticle prompt contract", () => {
  it("no word-count target, no number-anchor pressure, facts come from the compiled SSOT, routes are resolved", async () => {
    invokeLLM.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({
        slug: "steering-wheel-shakes-at-60",
        title: "Why your steering wheel shakes at highway speed",
        metaTitle: "Steering wheel shakes at 60 | Nick's Tire & Auto Cleveland",
        metaDescription: "Cleveland drivers: what a highway-speed shake usually means.",
        category: "Tires",
        readTime: "4 min read",
        excerpt: "A shake that only shows up at 60 is a clue, not a diagnosis.",
        sections: [{ heading: "What you feel", content: "A rhythmic shake through the wheel that starts around 55 and fades off at 70." }],
        relatedServices: ["/brake-repair-cleveland", "tires", "alignment", "/nope"],
        tags: ["tires"],
      }) } }],
    });
    const article = await generateArticle("steering wheel shakes at 60");

    const call = invokeLLM.mock.calls[0][0] as { messages: Array<{ role: string; content: string }> };
    const system = call.messages.find((m) => m.role === "system")!.content;
    const user = call.messages.find((m) => m.role === "user")!.content;
    const all = system + "\n" + user;

    expect(all).not.toMatch(/80-200 words|80–200 words/);
    expect(all).not.toMatch(/at least one number anchor/);
    expect(all).toMatch(/no word count/i);
    expect(all).toMatch(/never invent a cost range, time, or mileage/);
    expect(system).toContain("CLAIM RESTRICTIONS");
    expect(system).toContain("90-day labor");
    expect(system).toContain("7 days — Mon–Sat 8AM–6PM, Sun 9AM–4PM");
    expect(system).not.toMatch(/Mon-Sat 8AM-6PM, Sunday 9AM-4PM/);
    expect(user).not.toMatch(/brake-repair-cleveland/);
    expect(user).toMatch(/do not write URLs/);

    expect(article.relatedServices).toEqual(["/tires", "/alignment"]);
  });
});
