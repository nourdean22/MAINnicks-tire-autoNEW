/**
 * NICKSTIRE-C (2026-09-30): instagramStudio.render threw puppeteer's raw
 * "Could not find Chrome (ver. 148...)" as an unhandled 500. Railway's pnpm 10
 * install skips puppeteer's postinstall, so the bundled-cache lookup is empty
 * on the deploy image. Pins (1) the executable resolver tries explicit env,
 * bundled cache and distro paths, and fails TYPED when none exist; (2) the
 * render route turns that into a recorded PRECONDITION_FAILED, not a 500.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

const { advanceContentRun, renderHtmlToJpeg } = vi.hoisted(() => ({
  advanceContentRun: vi.fn(async () => true),
  renderHtmlToJpeg: vi.fn(),
}));

vi.mock("./services/adStudio/adRender", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./services/adStudio/adRender")>();
  return { ...actual, renderHtmlToJpeg };
});
vi.mock("./services/autonomyControl", () => ({ enforceAtBoundary: vi.fn(async () => undefined) }));
vi.mock("./services/generationLedger", () => ({
  dailySpendUsd: vi.fn(async () => 0),
  COST_ESTIMATES_USD: { gemini_brief: 0.01, gpt_image_2: 0.04 },
}));
vi.mock("./services/contentRun", () => ({
  advanceContentRun,
  RUN_STAGE: { held: "held", qa: "qa" },
  IMPLEMENTATION_STATE: { built: "built" },
}));
vi.mock("./services/igAutopost", () => ({ fetchRecentConceptKeys: async () => [] }));
vi.mock("./storage", () => ({ storagePut: vi.fn(async () => ({ url: "https://cdn.example.com/x.jpg" })) }));

import { resolveChromeExecutable, RendererUnavailableError, SYSTEM_CHROME_CANDIDATES } from "./services/adStudio/adRender";
import { appRouter } from "./routers";
import { INSTAGRAM_STUDIO_VERSION } from "../shared/instagramStudio";
import type { TrpcContext } from "./_core/context";

describe("resolveChromeExecutable", () => {
  it("throws a typed RENDERER_UNAVAILABLE error naming every path it tried when nothing exists", () => {
    let caught: unknown;
    try {
      resolveChromeExecutable({ env: {}, exists: () => false, bundledPath: () => "/root/.cache/puppeteer/chrome" });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(RendererUnavailableError);
    expect((caught as RendererUnavailableError).code).toBe("RENDERER_UNAVAILABLE");
    expect((caught as RendererUnavailableError).tried).toEqual(["/root/.cache/puppeteer/chrome", ...SYSTEM_CHROME_CANDIDATES]);
  });

  it("falls back to the distro chromium when the bundled download is missing (the Railway shape)", () => {
    const path = resolveChromeExecutable({
      env: {},
      exists: (p) => p === "/usr/bin/chromium",
      bundledPath: () => "/root/.cache/puppeteer/chrome",
    });
    expect(path).toBe("/usr/bin/chromium");
  });

  it("prefers an explicit PUPPETEER_EXECUTABLE_PATH, and survives a bundledPath that throws", () => {
    const path = resolveChromeExecutable({
      env: { PUPPETEER_EXECUTABLE_PATH: "/opt/chrome/chrome" },
      exists: () => true,
      bundledPath: () => { throw new Error("no cache dir"); },
    });
    expect(path).toBe("/opt/chrome/chrome");
  });
});

function ctx(): TrpcContext {
  return {
    user: {
      id: 1, openId: "admin-user", email: "admin@nickstire.com", name: "Admin", loginMethod: "manus",
      role: "admin", createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date(),
    },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as TrpcContext["res"],
  } as TrpcContext;
}

const draft = {
  version: INSTAGRAM_STUDIO_VERSION,
  id: "ig_renderer_test",
  source: { type: "manual_idea", detail: "Cleveland potholes and a visible tire bubble", evidenceStatus: "operator_context" },
  format: "post",
  objective: "walk_ins",
  topic: "Tire bubble warning",
  caption: "That bubble in your tire is not decoration. Cleveland potholes can hit hard enough to damage the sidewall. If you spot one, avoid highway speed and have the tire inspected before the next drive. Walk in for a straight answer.",
  hashtags: ["clevelandtires"],
  headline: "A TIRE BUBBLE IS A WARNING",
  subheadline: "Pothole impact can damage the sidewall. Get it looked at first.",
  cta: "Walk in today",
  artDirection: "One close tire sidewall on a dark graphite background with yellow accent lighting.",
  carouselSlides: [],
  imageUrls: [],
  rationale: "Seasonal pothole damage drives walk-ins.",
  conceptKey: "tire-bubble-warning",
  quality: {
    version: INSTAGRAM_STUDIO_VERSION, overall: 82, gate: "pass", dimensions: [], blockers: [], warnings: [],
    evaluatedAt: new Date().toISOString(),
  },
  createdAt: new Date().toISOString(),
  runId: "run_renderer_test",
};

describe("instagramStudio.render with no Chrome on the box", () => {
  beforeEach(() => {
    advanceContentRun.mockClear();
    renderHtmlToJpeg.mockReset();
  });

  it("answers PRECONDITION_FAILED with the renderer message and records the run as held", async () => {
    renderHtmlToJpeg.mockRejectedValue(new RendererUnavailableError(["/usr/bin/chromium"]));
    const caller = appRouter.createCaller(ctx());
    await expect(caller.instagramStudio.render(draft as never)).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message: expect.stringMatching(/renderer unavailable/i),
    });
    expect(advanceContentRun).toHaveBeenCalledWith("run_renderer_test", expect.objectContaining({
      stage: "held",
      failureReason: "renderer_unavailable",
    }));
  });

  it("does not swallow other render failures into the renderer-unavailable lane", async () => {
    renderHtmlToJpeg.mockRejectedValue(new Error("page crashed"));
    const caller = appRouter.createCaller(ctx());
    await expect(caller.instagramStudio.render(draft as never)).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
      message: "page crashed",
    });
    expect(advanceContentRun).not.toHaveBeenCalled();
  });
});
