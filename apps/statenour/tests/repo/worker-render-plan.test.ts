/**
 * The worker never presents a draft's own text as a customer review
 * (2026-10-08).
 *
 * apps/worker/src/scheduler.ts used to render every non-alert reel draft with
 * the review template, defaulting the reviewer to "Verified Customer" and the
 * rating to 5 stars. These tests drive the pure planner the render loop now
 * calls (apps/worker/src/renderPlan.ts). They live here because the worker has
 * no test suite of its own, as with worker-hygiene.test.ts.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { planRender } from "../../../worker/src/renderPlan";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");

describe("worker render plan", () => {
  it("an ordinary reel draft is refused, not turned into a five-star review", () => {
    const plan = planRender("Winter is coming: check your tread depth before the first snow.", { type: "tip" });
    expect("refuse" in plan).toBe(true);
  });

  it("a draft with no metadata at all is refused the same way", () => {
    expect("refuse" in planRender("Fast, honest service on Euclid Ave.", undefined)).toBe(true);
    expect("refuse" in planRender("Fast, honest service on Euclid Ave.", null)).toBe(true);
  });

  it("a declared review missing its name or rating is refused, never defaulted", () => {
    expect("refuse" in planRender("Great work", { type: "review", stars: 5 })).toBe(true);
    expect("refuse" in planRender("Great work", { type: "review", reviewerName: "Dana R." })).toBe(true);
    for (const stars of [0, 6, 4.5, "five"]) {
      expect("refuse" in planRender("Great work", { type: "review", reviewerName: "Dana R.", stars })).toBe(true);
    }
  });

  it("CONTROL: a declared review with name, rating and text renders exactly as given", () => {
    const plan = planRender("", {
      type: "review",
      reviewerName: "Dana R.",
      stars: "4",
      reviewText: "Patched my tire in twenty minutes.",
    });
    expect(plan).toEqual({
      template: "review",
      data: { reviewerName: "Dana R.", reviewText: "Patched my tire in twenty minutes.", stars: 4, companyName: "Nick's Tire & Auto" },
    });
  });

  it("the alert rule is unchanged: a typed alert, or a draft that mentions a warning", () => {
    const typed = planRender("Ice on Euclid this morning.", { type: "alert", alertTitle: "Road Ice" });
    expect(typed).toMatchObject({ template: "alert", data: { alertTitle: "Road Ice", alertDetails: "Ice on Euclid this morning." } });
    const keyword = planRender("Tire pressure warning lights come on when it gets cold.", {});
    expect(keyword).toMatchObject({ template: "alert", data: { alertTitle: "Service Alert", location: "Local Road Safety" } });
  });

  it("the render loop plans through planRender and keeps no review defaults of its own", () => {
    const worker = readFileSync(resolve(REPO_ROOT, "apps/worker/src/scheduler.ts"), "utf8");
    expect(worker).toContain("planRender(content, sourceMetadata)");
    expect(worker).not.toContain("Verified Customer");
    expect(worker).not.toMatch(/stars\s*\?\?\s*5/);
  });
});
