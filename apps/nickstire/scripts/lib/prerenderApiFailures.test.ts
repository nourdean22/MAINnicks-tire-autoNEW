/**
 * The probe that would have ended this investigation in a minute.
 *
 * A prerendered route that renders its not-found branch because every API call
 * returned 429 is indistinguishable, from the artifact alone, from one that has
 * no content. That ambiguity produced four wrong root causes in a row. This
 * module is what removes it — so it gets the same treatment as any other
 * instrument here: a positive control, and a test that breaks it.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  summarizeApiFailures,
  formatApiFailure,
  isApiFailureResponse,
} from "./prerenderApiFailures.mjs";
import { sliceBlock } from "../../server/testUtils/sourceBlock";

describe("summarizeApiFailures", () => {
  it("stays SILENT on a healthy route — no line at all", () => {
    // 339 routes run through this. A probe that prints on healthy routes gets
    // filtered out, and then it is not read on the day it matters.
    expect(summarizeApiFailures([])).toBeNull();
    expect(summarizeApiFailures(undefined as never)).toBeNull();
  });

  it("POSITIVE CONTROL: it DOES speak when calls fail", () => {
    // The other half of the arm above. Without this, a function that always
    // returned null would pass "stays silent" and report nothing, forever —
    // which is precisely the defect this module exists to end.
    const out = summarizeApiFailures([
      { status: 429, url: "http://localhost:4173/api/trpc/content.articleBySlug?input=%7B%7D" },
    ]);
    expect(out).not.toBeNull();
    expect(out).toContain("429");
  });

  it("collapses a burst of identical failures into one fact", () => {
    const failures = Array.from({ length: 8 }, () => ({
      status: 429,
      url: "http://localhost:4173/api/trpc/reviews.google",
    }));
    const out = summarizeApiFailures(failures)!;
    expect(out).toContain("8x 429");
    // One line, not eight.
    expect(out.split("\n")).toHaveLength(1);
  });

  it("orders codes by frequency, so the dominant failure leads", () => {
    const out = summarizeApiFailures([
      { status: 500, url: "/api/a" },
      { status: 429, url: "/api/b" },
      { status: 429, url: "/api/c" },
      { status: 429, url: "/api/d" },
    ])!;
    expect(out.indexOf("3x 429")).toBeLessThan(out.indexOf("1x 500"));
  });

  it("records a transport failure that has no status at all", () => {
    const out = summarizeApiFailures([
      { url: "/api/trpc/weather.current", errorText: "net::ERR_CONNECTION_REFUSED" },
    ])!;
    expect(out).toContain("net::ERR_CONNECTION_REFUSED");
  });

  it("strips the origin so the line is about the route, not localhost", () => {
    expect(formatApiFailure({ status: 429, url: "http://localhost:4173/api/trpc/x" })).toBe(
      "429 /api/trpc/x",
    );
  });
});

describe("isApiFailureResponse", () => {
  it("counts 4xx and 5xx on /api/ as failures", () => {
    expect(isApiFailureResponse("/api/trpc/x", 429)).toBe(true);
    expect(isApiFailureResponse("/api/trpc/x", 500)).toBe(true);
    expect(isApiFailureResponse("/api/health", 404)).toBe(true);
  });

  it("does not count success or redirects", () => {
    expect(isApiFailureResponse("/api/trpc/x", 200)).toBe(false);
    expect(isApiFailureResponse("/api/trpc/x", 204)).toBe(false);
    // 3xx is routing, not a failure — counting it would make every run noisy.
    expect(isApiFailureResponse("/api/trpc/x", 304)).toBe(false);
  });

  it("ignores non-API traffic entirely", () => {
    // Otherwise a missing favicon or font would be reported as an API failure
    // on all 339 routes.
    expect(isApiFailureResponse("/assets/index-abc.js", 404)).toBe(false);
    expect(isApiFailureResponse("/favicon.ico", 404)).toBe(false);
  });
});

describe("the probe is WIRED into the prerenderer", () => {
  it("prerender.mjs attaches the listeners and prints the summary", () => {
    // A probe nothing calls is the defect it was written to fix. Bounded with
    // sliceBlock, which throws on a missing anchor rather than silently
    // widening the slice to the end of the file.
    const src = readFileSync(resolve(process.cwd(), "scripts/prerender.mjs"), "utf8");

    expect(src, "must import the real helpers, not restate them").toContain(
      'from "./lib/prerenderApiFailures.mjs"',
    );

    const renderBlock = sliceBlock(src, "page = await browser.newPage();", "let html = await page.content();", {
      label: "prerender.mjs",
    });
    expect(renderBlock, "a response listener must be attached per page").toContain(
      'page.on("response"',
    );
    expect(renderBlock, "transport failures must be caught too").toContain(
      'page.on("requestfailed"',
    );

    // And the summary must actually be printed, not merely computed.
    const afterCapture = src.slice(src.indexOf("let html = await page.content();"));
    expect(afterCapture).toContain("summarizeApiFailures(apiFailures)");
    expect(afterCapture, "the summary must reach the log").toContain("[api-fail]");
  });
});
